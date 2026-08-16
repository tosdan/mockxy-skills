# The admin API

Mockxy's whole UI is built on the admin API under `/_admin/api`: every UI action is a call to
these routes. Anything the UI does can therefore be automated.

**Writing files stays the default.** Reach for the admin API only when a Mockxy server is already
running and one of these applies:

- the user explicitly wants a live change against the running instance;
- the action has no on-disk representation: resetting a sequence cursor, pushing a message into an
  SSE or WebSocket console, reading the monitor;
- you are importing an OpenAPI specification, which the engine turns into many endpoints at once.

**Never start a server, import a specification or mutate a running instance unless the user asked
for it.** These are outward-facing, hard-to-undo actions: `DELETE` routes erase endpoint files and
their variants for good.

## When it answers

- Enabled by `ADMIN_API_ENABLED` (on in development, off in production by default). When off,
  every route answers `404`.
- **No authentication**: it writes files and executes code, so it is meant for loopback use.
- Mutations accept **explicit JSON only** (`content-type: application/json`); the OpenAPI import
  also accepts YAML but rejects `text/plain` with `415`.
- Parameterless POST operations still require an actual JSON body exactly equal to `{}`. This
  applies to sequence reset, monitor dump flush, and both shared-state reset routes. A missing or
  empty body returns `400` after a valid JSON media type; a missing/wrong media type returns `415`.

## Conventions

- An endpoint's **`:id`** is the endpoint file's path, relative to the mocks folder, encoded
  base64url. Read it from the listing and treat it as **opaque** — do not build it yourself.
- Errors are JSON `{ error, message, details? }` with the matching status (`400` invalid input,
  `404` not found, `409` conflict, `415` media type, `500`).
- Catalog mutations **reload the runtime immediately**: the change is served from the next request
  on, with no restart.

## Catalog and endpoints

| Method and path | What it does |
|---|---|
| `GET /mocks` | the whole catalog: endpoints, collections and orderings. Endpoint files that fail to load are reported in `loadErrors` instead of failing the request |
| `GET /mocks/resolve?method&path` | which endpoint would cover a concrete request today, disabled ones included; `{ mock: null }` if none |
| `POST /mocks` | creates an endpoint. If one already exists for method+path it answers `409` with `details.existingMockId`, so you can add a variant to that endpoint instead |
| `GET /mocks/:id` | endpoint detail and variants; when the selected response is a sequence it also exposes `sequence` and `sequenceState` |
| `PUT /mocks/:id` | selects `{ selectedResponseFile }`, or updates the selected ordinary response; legacy `{ sequence }` bodies are rejected |
| `GET /mocks/:id/sequence/state` | selected sequence filename and live cursor; `400` when another response type is selected |
| `POST /mocks/:id/sequence/reset` | resets the selected sequence cursor and handler memory — body `{}`; shared runtime state is unchanged |
| `PUT /mocks/:id/endpoint` | updates `description` and `enabled`; method and path are immutable |
| `POST /mocks/:id/copy` | duplicates onto a new method+path — `{ method, path, copyResponses }`; a selected sequence copied alone brings its minimum step closure |
| `POST /mocks/:id/copy?dryRun=true` | read-only copy plan (`200`) with response files, assets, literal shared-state references and warnings; the real copy recalculates and returns `201` |
| `PUT /mocks/:id/collection` | assigns the endpoint to a collection |
| `DELETE /mocks/:id` | deletes endpoint and variants |

## Response variants

| Method and path | What it does |
|---|---|
| `POST /mocks/:id/responses` | adds and selects a `mock`, `handler`, `middleware`, `sse`, `ws` or `sequence` variant |
| `PUT /mocks/:id/responses/:file` | updates a variant, including sequence fields, `templated`, and SSE/WS scripts, rules and presets |
| `PUT /mocks/:id/responses/:file/file` | uploads the raw bytes of a file-backed variant — `application/octet-stream` up to 12 MB, with `?contentType=…&filename=…` |
| `DELETE /mocks/:id/responses/:file` | deletes a variant; a sequence target is protected with `409` and `details.referencedBy` |

## Streaming consoles

| Method and path | What it does |
|---|---|
| `POST /mocks/:id/sse/push` | broadcasts `{ data, event?, id? }` to every open SSE connection |
| `GET /mocks/:id/sse/connections` | open SSE connections and history |
| `POST /mocks/:id/ws/push` | broadcasts `{ data }` to every open WebSocket connection |
| `GET /mocks/:id/ws/connections` | open WebSocket connections and the bidirectional transcript |

## Collections, data files, monitor, server state

| Method and path | What it does |
|---|---|
| `POST /mocks/collections` | creates a collection, nested too |
| `PATCH /mocks/collections/:id/parent` | moves a collection in the tree |
| `PATCH /mocks/collections/:id/enabled` | enables/disables a whole subtree **in bulk** |
| `DELETE /mocks/collections/:id` | dissolves the subtree; its endpoints go back to Unsorted |
| `DELETE /mocks/collections/:id/contents` | permanently erases the subtree **and its endpoints** |
| `GET /files`, `GET /files/:name` | data files: listing with `usedBy`, and content |
| `PUT /files/:name` | creates (`201`) or replaces (`200`) — raw bytes up to 25 MB, JSON-validated |
| `PATCH /files/:name` | renames — `{ name, rewriteReferences }` |
| `DELETE /files/:name` | deletes a data file |
| `GET /monitoring/requests` | captured traffic, most recent first |
| `POST /monitoring/dump/flush` | flushes pending monitor entries — body `{}` |
| `POST /monitoring/dumps/create-mocks` | creates mocks in bulk from captured traffic |
| `GET /runtime/shared-state` | metadata, usage and limits of handler shared state; never values |
| `POST /runtime/shared-state/:name/reset` | idempotently resets one resource — body `{}`; returns `{ name, reset }` |
| `POST /runtime/shared-state/reset` | resets all resources — body `{}`; returns `{ resetCount }` |
| `GET /server`, `PATCH /server` | `{ serverEnabled, proxyAll }` — the three serving modes |

## OpenAPI import

| Method and path | What it does |
|---|---|
| `POST /mocks/import/openapi` | imports the spec (raw JSON/YAML body, up to 12 MB) |
| `POST /mocks/import/openapi?dryRun=true` | the plan and its counts, writing nothing |
| `POST /mocks/import/openapi?prefix=/be` | prepends `/be` to every imported path |

OpenAPI 3.0/3.1 and Swagger 2.0 are accepted, JSON or YAML. For each path+method the import
generates the path converted to Mockxy's convention (`/users/{id}` → `/users/:id`), the first
declared `2xx` status, and a body taken from the spec's example or sampled deterministically from
the schema. Collections come from the spec tags. Endpoints that already exist for the same
method+path are left untouched.

**Always run the import with `dryRun=true` first** and show the user the plan before writing.
Likewise, run endpoint copy with `?dryRun=true` first. A copied handler keeps literal
`sharedState.open("name", ...)` references unchanged, which may intentionally or accidentally
make the new endpoint share the original's live resource. The preview is best-effort and does
not execute source code; dynamic/helper-based references can be missed.

## Examples

```bash
curl -s http://localhost:3000/_admin/api/mocks

curl -s -X PATCH http://localhost:3000/_admin/api/server \
  -H "content-type: application/json" -d '{"proxyAll": true}'

curl -s -X POST "http://localhost:3000/_admin/api/mocks/import/openapi?dryRun=true" \
  -H "content-type: application/yaml" --data-binary @openapi.yaml

curl -s -X POST http://localhost:3000/_admin/api/runtime/shared-state/items/reset \
  -H "content-type: application/json" -d '{}'
```

For the exact structure of create and update bodies, the most reliable source is the running UI
itself: every action is a call to these routes, observable in the browser's developer tools.
