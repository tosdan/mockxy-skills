---
name: mockxy-dynamic-mock
description: Write Mockxy handler and middleware scripts, the JSON data files they read, and shared runtime state used across handlers. Use when a mocked endpoint must compute its answer instead of returning a fixed payload — echoing the request, branching on a path parameter or body, serving or mutating a dataset, making a POST affect a later GET, counting calls or changing outcome over the run — or when the real backend's response must be transformed on the way back (masking fields, forcing a case, enriching a payload).
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
  async resolveResponse({ params, query, requestHeaders, jsonBody, data, sharedState }) {
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
  `bodyText`, `jsonBody`), `data(name)`, `sharedState`, and `state` / `callCount` /
  `firstRequestAt` for behavior that depends on the history of the run.
- The result is `{ status?, headers?, removeHeaders?, applyListQuery?, jsonBody | body }` — at
  most one of `jsonBody` and `body`; neither means no body.
- The script must **not** declare `method`, `path` or `disabled`: routing belongs to the endpoint
  file, and declaring them is a validation error.
- Code shared by several scripts lives in `<mocks>/_shared/` and is imported with the `#shared/`
  alias, never with a depth-dependent `../../` path — see
  [Shared helpers and the script contract](#shared-helpers-and-the-script-contract).

Full contract, error handling, timeouts and limits:
[references/handler-contract.md](references/handler-contract.md).

## Shared helpers and the script contract

```js
const flow = require("#shared/payments/flow.js");

module.exports = { resolveResponse: flow.cancel };
```

`#shared/` is Node's native alias for `<mocks>/_shared/`, defined by **`<mocks>/package.json`**.
Before writing the first script of a workspace, check that file: when it is missing, create it as
an exact copy of [assets/mocks-package.json](assets/mocks-package.json); when it exists, leave it
as it is. The alias works the same in handlers, middleware and helpers, at any folder depth.

Newer engines only: up to Mockxy 1.5.0 there is no alias, so use a relative path with its
extension, which every version resolves. The `require("_shared/<helper>")` form of Mockxy 1.5.0
was withdrawn: replace it wherever you find it.

The engine recompiles the scripts at every reload. Every script — handler, middleware or helper —
follows these rules, so that a request in flight ends with the code it started with:

- **Local `require` at the top of the module**, with a literal path that includes the extension
  (`./data.js`, `#shared/flow.js`). Never inside a function, in an instance field of a class,
  after an `await` or with a computed path.
- **Handler and middleware files are entry points**: no script imports them. Logic that two
  endpoints need goes into a helper.
- **CommonJS only**: no local `.mjs` file and no `import()` of local code.
- **State lives in `state` and `sharedState`**, never in module variables: a counter or a cache
  kept in a module is lost at the next reload.
- **Loading a module has no effects**: no timers, listeners, servers or writes at the top level.
- **Local code stays under `<mocks>/`.**

A script that breaks a rule still loads: the engine reports it as a warning and its full
validation as an error. Reasons, the package file and the diagnostics:
[references/handler-contract.md](references/handler-contract.md#helpers-shared-across-endpoints).

## Shared state across handlers

Use `sharedState` when different endpoint handlers must observe the same evolving JSON, for
example when `POST /items` adds an item that `GET /items` must return later. Open the same name
and `seedKey` in every participating handler, usually seeding it from a literal `data()` call:

```js
const items = await sharedState.open("items", {
  seedKey: "items@v1",
  initialize: () => data("items"),
});

const snapshot = items.read();
const created = items.mutate((draft) => {
  const item = { ...jsonBody };
  draft.push(item);
  return item;
});
items.replace([]);
```

This state is in memory, shared globally inside one Mockxy process, survives handler hot reload,
and disappears on restart or reset. It never writes back to the data file. `seedKey` is a
required, author-controlled compatibility signature: bump it when the logical shape changes,
then reset the resource. Read the concurrency, lifecycle, quota, error and authoring rules before
using it: [references/shared-state.md](references/shared-state.md).

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
- Every local `require` is at the top of its module, with a literal path and the extension;
  shared helpers are imported with `#shared/…`, and `<mocks>/package.json` exists.
- No script imports a handler or middleware file, and no module variable holds state.
- At most one of `jsonBody` and `body` is returned, and `status` — when given — is 100–599.
- Every `data("name")` in the script has a matching `files/name.json`, lowercase.
- Every shared resource is opened with the same canonical name and `seedKey` in all participating
  handlers; its initializer depends on a stable literal data file or constant, not request input.
- Shared-state mutators are synchronous and do not call any shared-state operation from inside
  initializer or mutator callbacks.
- Validate the workspace with the `mockxy-workspace` skill's `scripts/validate-workspace.js`,
  which loads the scripts and checks their exports, and fix every error. The script contract is
  checked by the engine: pass `--server-url` or `--engine-dir` when a Mockxy that has the full
  validation is at hand, and otherwise tell the user that the contract was not verified.
