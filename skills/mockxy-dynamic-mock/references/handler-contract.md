# The handler contract

When a static response is not enough — because it must echo a parameter, branch on the received
body, or build the result from a dataset — the variant can be a **handler**: a local JavaScript
script that receives the request and returns the response.

A handler is linked to the endpoint through a response file of type `handler` pointing at a
`*.handler.js` script in the same responses folder. Like any variant, it becomes active when it is
selected: the same endpoint can hold a static variant and a dynamic one and switch between them.

## The shape of the script

```js
module.exports = {
  async resolveResponse({ params, query, requestHeaders, jsonBody, data }) {
    const users = await data("users");
    const user = users.find((u) => String(u.id) === params.id);
    if (!user) {
      return { status: 404, jsonBody: { error: "not_found", id: params.id } };
    }
    return {
      status: 200,
      headers: { "x-source": "handler" },
      jsonBody: user,
    };
  },
};
```

A CommonJS module exporting an object with **`resolveResponse`** (sync or `async`). It may
`require` other local files with relative paths: the engine tracks those dependencies and
recompiles when the source **or one of its dependencies** changes on disk.

It must **not** declare `method`, `path` or `disabled`: routing belongs to the endpoint file, and
their presence in the script is a validation error.

## The context it receives

- **`params`** — path parameters of the route (`/users/:id` → `params.id`), already
  percent-decoded. Always strings — compare with `String(x) === params.id` or `Number(params.id)`.
- **`query`** — query parameters (Express object: string values, arrays for repeated ones).
- **`requestHeaders`** — a copy of the request headers, names lowercase.
- **the body, in three forms** (the request is buffered before the script runs):
  - **`bodyBuffer`** — the raw body as a `Buffer`, always present (empty with no body);
  - **`bodyText`** — the body as a UTF-8 string, only for textual content-types, otherwise
    `undefined`;
  - **`jsonBody`** — the parsed body, when the content-type is JSON or the content has structured
    JSON shape; otherwise `undefined`.
- **`data(name)`** — the accessor to the workspace data files: `await data("users")` returns the
  content of `files/users.json`. See [data-files.md](data-files.md).
- **`sharedState`** — request-scoped access to JSON resources shared by different handlers. Use
  `await sharedState.open(name, { seedKey, initialize })`, then `read()`, `mutate()` or
  `replace()` on the returned handle. See [shared-state.md](shared-state.md).
- **`state`** — a mutable object **persistent across calls** of the same endpoint (and shared
  between its variants): the memory for counters, per-resource state machines
  (`state[params.id] = ...`), outcomes depending on history. It is **ephemeral and local to the
  engine** — not a database: it resets on restart and on sequence reset, but survives hot reload,
  so iterating on the script does not restart the test. The sequence reset
  (`POST /_admin/api/mocks/:id/sequence/reset`) only works while a sequence is selected on that
  endpoint: there is no reset for the memory of an ordinary handler. A test that needs it clean
  either runs on a fresh engine or relies on a reset the workspace documents (for example a
  shared-state resource instead of `state`).
- **`callCount`** — progressive number of invocations of the handler for this endpoint (1 on the
  first), same lifetime as `state`.
- **`firstRequestAt`** — timestamp (epoch ms) of the first invocation: `Date.now() -
  firstRequestAt` is the elapsed time since the run started, without looking at the wall clock.

  ```js
  module.exports = {
    resolveResponse({ firstRequestAt }) {
      if (Date.now() - firstRequestAt < 15000) {
        return { status: 202, jsonBody: { status: "processing" } };
      }
      return { status: 200, jsonBody: { status: "completed" } };
    },
  };
  ```

  For that simple case without writing code there is a `sequence` response — see
  `mockxy-static-mock`.
- **`req`** — the raw Express request, for advanced cases. The body stream has already been
  consumed by the buffering: use the three forms above, do not re-read it.

The request body is buffered **up to 2 MB**: beyond that the engine answers `413` without even
running the script.

## The result

`resolveResponse` returns an object:

- **`status`** — optional, default `200`; integer between 100 and 599.
- **`headers`** — optional. `Content-Length` is always recomputed by the engine, and when the
  response has a body, any declared `Content-Encoding`, `Transfer-Encoding` and `ETag` are dropped
  too: the body is built locally and those metadata would be stale.
- **`removeHeaders`** — optional list of names (case-insensitive) to remove from the declared
  headers. Useful when `headers` is spread from another source and an entry must be excluded.
- **`jsonBody`** *or* **`body`** — at most one:
  - **`jsonBody`** — any serializable value: goes out as JSON with
    `content-type: application/json` set by the engine;
  - **`body`** — a **string or `Buffer`**, served as-is: the content-type is whatever `headers`
    declares. The route for text, XML, or generated binary payloads;
  - **neither** — a response with no body (typical for `204`).
- **`applyListQuery`** — optional boolean, default `false`. With `true`, Mockxy applies its
  automatic list filters and pagination to `jsonBody`, including `X-Total-Count`. It requires
  `jsonBody`; a non-boolean value makes the handler result invalid.

Handler responses go out with no-cache headers and `x-mock-source: handler`, and receive **no
simulated delay**: a script that wants to be slow waits inside itself.

## Errors, timeouts and limits

A handler failure never takes the server down and always produces a JSON service response, with
the full detail (message and stack) in the **server log**:

- **exception in the script or invalid result** (non-object, status out of range, `body` and
  `jsonBody` together, unsupported `body` type) → `500 Handler Execution Failed`;
- **timeout** — the script gets the same timeout as backend requests (`requestTimeoutMs`); beyond
  it the answer is `504 Handler Timeout`. A promise that never resolves does not hang the request;
- **request body over 2 MB** → `413 Payload Too Large`.

Script validation (file exists, `resolveResponse` present) happens instead at endpoint load, with
per-endpoint degradation: a broken handler takes only its own endpoint out of service.

## Style guidance

- Keep the dataset in `files/` and the branching in the script.
- Return explicit status codes for the error cases the client needs to exercise; a mock that only
  ever answers `200` teaches the frontend nothing.
- Do not reach outside the workspace: no network calls, no absolute machine-specific paths, no
  writes to disk. A handler is a fixture, and whoever opens the workspace runs it.
