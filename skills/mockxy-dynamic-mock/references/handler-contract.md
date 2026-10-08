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
`require` other local files, following [the script contract](#the-script-contract). Newer engines
recompile every selected script, with its helpers, **at each reload**: a change to a helper is
served from the next request, whatever its size or modification time.

It must **not** declare `method`, `path` or `disabled`: routing belongs to the endpoint file, and
their presence in the script is a validation error.

### Helpers shared across endpoints

Code used by several scripts lives in **`<mocks>/_shared/`**, organized in subfolders as needed,
and is imported with the **`#shared/`** alias:

```js
const flow = require("#shared/payments/flow.js");

module.exports = { resolveResponse: flow.cancel };
```

The string is the same at any folder depth, so copying the endpoint to a route of a different
depth keeps the reference valid. It works in handlers, in middleware and inside the helpers
themselves. A relative path such as `"../../../_shared/payments/flow.js"` stays valid but depends
on the depth: it breaks when the endpoint changes level, and can silently resolve a different
file with the same name.

The alias is Node's native one, defined by the **`<mocks>/package.json`** file:

```json
{
  "private": true,
  "type": "commonjs",
  "imports": {
    "#shared/*": "./_shared/*"
  }
}
```

A copy is in [`assets/mocks-package.json`](../assets/mocks-package.json).

- **Write the file with the first script and commit it with the mocks.** The engine creates it at
  the first script when it is missing, but only if the mocks folder is writable: on a read-only
  workspace (a mounted volume, a container image) the scripts still load and only the `#shared/`
  imports fail, with a message that says so.
- **Never rewrite an existing file.** The engine uses it as it is. It must contain that `imports`
  entry, no other key starting with `#shared`, and `type` absent or `"commonjs"`. Other aliases
  are outside the contract.
- **The extension is mandatory**: `#shared/flow.js`, not `#shared/flow`. An alias looks for
  neither an extension nor an `index.js`.
- **Node reads the file once per process, before the first script.** Adding it, or changing its
  `imports` or `type`, while Mockxy has already loaded scripts of that workspace has no effect
  until the process restarts — in the desktop app the whole app, not only the workspace. The
  engine reports it as `SCRIPT_PACKAGE_RESTART_REQUIRED`: tell the user, do not work around it.
- **A single `package.json` under `<mocks>/`.** One in a subfolder changes the scope of the alias
  for the scripts below it.

**Engine versions.** The alias needs a newer engine. Up to Mockxy 1.5.0 it does not exist: use
relative paths, with the extension, which every version resolves. Mockxy 1.5.0 alone resolved
`require("_shared/payments/flow")` from the mocks root; that form was withdrawn because it worked
only in a script the engine loaded directly. Replace it with `require("#shared/payments/flow.js")`.

### The script contract

Because scripts are recompiled at every reload, a few rules keep that safe. They apply to
handlers, middleware and helpers alike:

| Aspect | Rule |
|---|---|
| Entry points | `*.handler.js` and `*.middleware.js` files are not imported by other scripts. Reusable logic is extracted into a helper. |
| Local dependencies | `require` at the top of the module, with a literal path including the extension (`./data.js`, `#shared/flow.js`). No `require` inside a function, in an instance field of a class, after an `await` or with a computed path. |
| Format | Scripts and helpers are CommonJS. A local ES module (`.mjs`) and `import()` of local code are outside the contract: Node never reloads them. |
| State | `state` for the endpoint, `sharedState` across endpoints. Module variables hold functions, constants and configuration that does not change: a counter or a cache in a module does not survive a reload. |
| Loading | Loading a module starts no timers, listeners or servers and writes nothing: it runs again at every reload. |
| Boundary | Local code lives under `<mocks>/`. Node built-ins and npm packages are used normally, but are not reloaded. |

The reason is the reload. A response function keeps the references it took when its module was
loaded, so a request in flight ends with the code it started with. A `require` that runs during a
request returns, after a reload, the new code in the middle of that request.

A script that breaks a rule is **not blocked**: it still loads. Violations surface in three
places:

- **when saving through the admin API**, as `warnings` in the response — the script is saved;
- **in `GET /runtime/status`**, as `warnings`, for what the engine sees while loading: a handler
  imported by another script (`SCRIPT_ENTRYPOINT_IMPORTED`) or a problem with
  `<mocks>/package.json` (`SCRIPT_PACKAGE_*`);
- **in the full validation**, where they are errors. It loads every script, including those of
  disabled endpoints and unselected variants, which a reload never loads:
  `POST /_admin/api/scripts/validate` on a running engine, or `node index.js validate <workspace>`
  in a Mockxy folder, with no server. The `mockxy-workspace` skill's validator calls either one
  when told where the engine is.

| Code | Meaning |
|---|---|
| `SCRIPT_LATE_REQUIRE` | a local `require` inside a function or an instance field |
| `SCRIPT_DYNAMIC_REQUIRE` | `require` with a computed path |
| `SCRIPT_REQUIRE_WITHOUT_EXTENSION` | a relative `require` without the file extension |
| `SCRIPT_ESM_DEPENDENCY`, `SCRIPT_LOCAL_DYNAMIC_IMPORT` | a local ES module, or `import()` of local code |
| `SCRIPT_ENTRYPOINT_IMPORTED` | a handler or middleware file imported by another script |
| `SCRIPT_DEPENDENCY_OUTSIDE_WORKSPACE` | a local dependency outside the mocks folder |
| `SCRIPT_PACKAGE_NESTED` | a `package.json` below the mocks root |
| `SCRIPT_CONTRACT_NOT_ANALYZED` | the parser rejected the file: it is not certified as compliant |
| `SCRIPT_LOAD_FAILED`, `SCRIPT_INVALID_EXPORT` | the script does not load, or exports the wrong shape |

The parser reads the syntax, not the behavior: state kept in a module variable and effects at
load time are rules it cannot see. Keeping them is up to whoever writes the script.

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
  writes to disk. A handler is a fixture, and whoever opens the workspace runs it — and the engine
  runs the top level of every script again at each reload and in the full validation.
