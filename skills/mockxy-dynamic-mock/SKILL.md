---
name: mockxy-dynamic-mock
description: Write Mockxy handler and middleware scripts, and the JSON data files they read. Use when a mocked endpoint must compute its answer instead of returning a fixed payload — echoing the request, branching on a path parameter or body, serving a record looked up in a dataset, counting calls or changing outcome over the run — or when the real backend's response must be transformed on the way back (masking fields, forcing a case, enriching a payload).
---

# Mockxy handlers and middleware

Two ways to answer with code, both attached to an endpoint through a response variant:

- **handler** (`type: "handler"`) — a local JavaScript script computes the whole response. The
  step above a static mock, before needing a real backend.
- **middleware** (`type: "middleware"`) — the request **really reaches the backend** through the
  proxy, and the script may modify the response before it reaches the client.

Reach for a handler only when a static mock cannot do the job. Templating covers "echo a value
back" and sequences cover "first this, then that" without any code — see `mockxy-static-mock`.

## The three files

```
mocks/api/users/{id}/
├── GET.endpoint.json
└── GET.responses/
    ├── 001.response.json      # the link
    └── 001.handler.js         # the logic
```

`GET.endpoint.json` — same as any endpoint (`method` matching the filename, `path` with `:param`,
boolean `enabled`, `selectedResponseFile` listed in `responseFiles`; see `mockxy-workspace`):

```json
{
  "method": "GET",
  "path": "/api/users/:id",
  "enabled": true,
  "responseFiles": ["001.response.json"],
  "selectedResponseFile": "001.response.json"
}
```

`001.response.json` — the response file is only the link:

```json
{
  "type": "handler",
  "title": "Detail from the dataset",
  "sourceFile": "001.handler.js"
}
```

`sourceFile` is a **plain filename** in the same responses folder, ending in `.handler.js` (or
`.middleware.js` for `type: "middleware"`).

## The handler script

```js
module.exports = {
  async resolveResponse({ params, query, requestHeaders, jsonBody, data }) {
    const users = await data("users");
    const user = users.find((u) => String(u.id) === params.id);
    if (!user) {
      return { status: 404, jsonBody: { error: "not_found", id: params.id } };
    }
    return { status: 200, headers: { "x-source": "handler" }, jsonBody: user };
  },
};
```

A CommonJS module exporting an object with **`resolveResponse`** (sync or `async`).

- The context gives `params`, `query`, `requestHeaders`, the body in three forms (`bodyBuffer`,
  `bodyText`, `jsonBody`), the `data(name)` accessor, and `state` / `callCount` /
  `firstRequestAt` for behavior that depends on the history of the run.
- The result is `{ status?, headers?, removeHeaders?, jsonBody | body }` — at most one of
  `jsonBody` and `body`; neither means no body.
- The script must **not** declare `method`, `path` or `disabled`: routing belongs to the endpoint
  file, and declaring them is a validation error.

Full contract, error handling, timeouts and limits:
[references/handler-contract.md](references/handler-contract.md).

## The middleware script

```js
module.exports = {
  async transformResponse({ status, headers, jsonBody }) {
    return {
      status,
      headers: { ...headers, "x-environment": "mockxy" },
      jsonBody: { ...jsonBody, availableBalance: 0 },
    };
  },
};
```

Same shape, function **`transformResponse`**. It requires a configured backend, since it works on
the proxied response. Returning `undefined` lets the backend response pass through untouched.
Headers **merge on top of the backend's**, unlike a handler's — and a failing middleware
fails open: the original response is forwarded —
[references/middleware-contract.md](references/middleware-contract.md).

## Data files: keep the dataset out of the code

`await data("users")` reads `files/users.json` from the workspace. The folder is **flat**, names
are **lowercase** and match `[a-z0-9._-]+.json`, and the name without the extension is what you
pass to `data()`. Every call re-reads from disk and each caller gets its own copy —
[references/data-files.md](references/data-files.md).

Prefer a data file over a large array inlined in the script: the script stays readable, the
dataset is editable without touching code, and both travel in git.

## Before reporting the work done

- `sourceFile` matches the variant type: `.handler.js` for `handler`, `.middleware.js` for
  `middleware`, and the file exists in the same responses folder.
- The script exports `resolveResponse` (handler) or `transformResponse` (middleware).
- The script declares no `method`, `path` or `disabled`.
- At most one of `jsonBody` and `body` is returned, and `status` — when given — is 100–599.
- Every `data("name")` in the script has a matching `files/name.json`, lowercase.
- Validate the workspace with the `mockxy-workspace` skill's `scripts/validate-workspace.js`,
  which loads the scripts and checks their exports, and fix every error.
