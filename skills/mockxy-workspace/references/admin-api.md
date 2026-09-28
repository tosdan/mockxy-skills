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
  every route answers `404` with `Admin API disabled`. Up to Mockxy 1.3.2 a missing flag left it
  off even in development: if that is the answer you get, the server must be restarted with
  `ADMIN_API_ENABLED=true`.
- The namespace is **reserved** in newer engines: a method or path that is not listed here
  answers `404` with `details.code: "ADMIN_ROUTE_NOT_FOUND"`. Older engines forwarded unknown
  admin paths to mock serving and, with proxy fallback on, to the real backend — so check the
  method and path before retrying a call that failed.
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
  `403` unexpected `Host` header, `404` not found, `409` conflict, `415` media type, `500`).
  Newer errors carry a stable `details.code`: branch on it rather than on the message text.
- Catalog mutations **reload the runtime immediately**: the change is served from the next request
  on, with no restart.

## Outcome of a mutation

Newer engines (after Mockxy 1.3.2) verify every mutation against the runtime they have just
reloaded, and run the mutations of one workspace **one at a time**; reads, traffic and console
pushes do not wait for them.

- A `2xx` means the files are written **and** the runtime serves the requested effect on the
  endpoints involved. Load errors on unrelated endpoints do not fail a valid mutation.
- A failure carries `details.code` and `details.rollback` (`not_needed`, `restored` or `failed`):

  | Status and code | Meaning | What to do |
  |---|---|---|
  | `400 MUTATION_REJECTED` | invalid input (`not_needed`), or a change the runtime cannot load (`restored`: files put back) | fix the input or the file content and try again |
  | `500 RUNTIME_APPLY_FAILED` | the runtime reload failed as a whole; files restored | report it; retry only once the cause is fixed |
  | `500 MUTATION_FAILED` | unexpected write error; files restored | report it |
  | `500 ROLLBACK_FAILED` | the restore failed too, or an endpoint involved is not served as it was before; `details.cause` and `details.recoveryError` explain | **stop**: the workspace state is not consistent. Report both errors, then read `GET /runtime/status` and the catalog back before any further change |

- **A lost response does not authorize a blind retry.** If a create timed out or the connection
  dropped, read the catalog (or `GET /mocks/resolve`) first: repeating it may answer `409` with
  `details.existingMockId` because the first attempt succeeded.
- **Batches** (`POST /mocks/import/openapi`, `POST /monitoring/dumps/create-mocks`) keep the items
  that succeeded. Read the per-item outcome even with `201`: `items[].writeOutcome`
  (`created`, `skipped`, `failed`), `items[].runtimeOutcome` (`applied`, `not_applied`,
  `not_applicable`) with the reason in `items[].error`, and `runtime.status` (`applied`, or
  `degraded` when some endpoint files fail to load). The counts only describe what was written.
  **Stop the setup if one of your own resources is `not_applied`** and report it. A failed final
  reload answers `500 BATCH_RUNTIME_FAILED`; an item whose restore failed stops the batch with
  `500 ROLLBACK_FAILED`. Both carry the partial result in `details.result`.

## Catalog and endpoints

| Method and path | What it does |
|---|---|
| `GET /mocks` | the whole catalog: endpoints, collections and orderings. Endpoint files that fail to load are reported in `loadErrors` instead of failing the request |
| `GET /mocks/resolve?method&path` | which endpoint would cover a concrete request today, disabled ones included; `{ mock: null }` if none |
| `POST /mocks` | creates an endpoint. If one already exists for method+path it answers `409` with `details.existingMockId`, so you can add a variant to that endpoint instead |
| `GET /mocks/:id` | endpoint detail and variants; when the selected response is a sequence it also exposes `sequence` and `sequenceState`. `409` with `details: { code: "READ_INCONSISTENT", retryable: true }` means a file was missing while the endpoint was read: repeat the read **once**; if it fails again, report the detail as unreadable and write nothing based on it |
| `PUT /mocks/:id` | selects `{ selectedResponseFile }`, or updates the selected ordinary response; legacy `{ sequence }` bodies are rejected |
| `GET /mocks/:id/sequence/state` | selected sequence filename and live cursor; `400` when another response type is selected |
| `POST /mocks/:id/sequence/reset` | resets the selected sequence cursor and handler memory — body `{}`; shared runtime state is unchanged |
| `PUT /mocks/:id/endpoint` | updates `description` and/or `enabled`; method and path are immutable. Send **only the field you change**: resending a value read earlier overwrites a change made meanwhile |
| `PATCH /mocks/enabled` | enables or disables a list of endpoints — `{ ids, enabled }` with a non-empty `ids`; an unknown id fails the request before anything is written; answers with the refreshed catalog |
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

The consoles act on the definition the **running** engine serves, not on the selection on disk:
after a new selection that fails to load, they keep working on the previous route. They answer
`404` when the runtime does not serve the endpoint (disabled, or never loaded) and `400` when it
serves it with another type, middleware included. They do not wait for queued mutations.

## Collections, data files, monitor, server state

| Method and path | What it does |
|---|---|
| `POST /mocks/collections` | creates a collection, nested too |
| `PATCH /mocks/collections/order` | reorders sibling collections — `{ collectionIds, parentId? }`, each sibling exactly once |
| `PATCH /mocks/collections/:id/items/order` | reorders the endpoints of a collection — `{ itemIds }`, each endpoint exactly once |
| `PATCH /mocks/collections/:parentKey/children/order` | reorders everything directly under a parent (`root`, `unsorted` or a collection id), endpoints and sub-collections interleaved — `{ childRefs }`, each child exactly once |
| `PATCH /mocks/collections/:id/parent` | moves a collection in the tree |
| `PATCH /mocks/collections/:id/enabled` | enables/disables a whole subtree **in bulk** |
| `DELETE /mocks/collections/:id` | dissolves the subtree; its endpoints go back to Unsorted |
| `DELETE /mocks/collections/:id/contents` | permanently erases the subtree **and its endpoints** |
| `GET /files`, `GET /files/:name` | data files: listing with `usedBy`, and content |
| `PUT /files/:name` | creates (`201`) or replaces (`200`) — raw bytes up to 25 MB, JSON-validated |
| `PATCH /files/:name` | renames — `{ name, rewriteReferences }` |
| `DELETE /files/:name` | deletes a data file |
| `GET /monitoring/requests` | captured traffic kept in memory (up to 250 entries), most recent first |
| `DELETE /monitoring/requests` | clears the in-memory traffic; dump files on disk are untouched |
| `GET /monitoring/requests/stream` | Server-Sent Events: a `snapshot` of the current entries, then one event per new request and a `clear` event |
| `GET /monitoring/dump` | state of the on-disk dump of captured traffic |
| `PATCH /monitoring/dump` | turns the dump on or off and tunes it at runtime — `{ enabled?, intervalMs?, threshold? }`; only traffic captured after it is enabled is written |
| `POST /monitoring/dump/flush` | flushes pending monitor entries — body `{}` |
| `GET /monitoring/dumps` | lists the dump files |
| `GET /monitoring/dumps/read?fileIndex&lineIndex&limit` | reads the dumps page by page, oldest first; every item carries a `dumpKey`; keep passing `nextCursor` until `done` |
| `POST /monitoring/dumps/create-mocks` | creates mocks in bulk from captured traffic — `{ file }` for a whole dump file or `{ keys }` with `dumpKey` values; existing endpoints are skipped. Read `items` and `runtime` as described in [Outcome of a mutation](#outcome-of-a-mutation) |
| `DELETE /monitoring/dumps/:file` | deletes one dump file |
| `GET /runtime/shared-state` | metadata, usage and limits of handler shared state; never values |
| `POST /runtime/shared-state/:name/reset` | idempotently resets one resource — body `{}`; returns `{ name, reset }` |
| `POST /runtime/shared-state/reset` | resets all resources — body `{}`; returns `{ resetCount }` |
| `GET /server`, `PATCH /server` | `{ serverEnabled, proxyAll }` — the three serving modes |
| `GET /config` | effective configuration, read-only — `{ runtimeId, startup, effective, overrides, persisted }` with the nine runtime settings (`backendUrl` is `null` without a backend); no other environment variable |
| `GET /runtime/status` | outcome of the last load of the workspace, `200` even when degraded or failed — `lastAttempt` (`reasons` among `startup`, `admin`, `watcher`; `status` `applied`, `degraded` or `failed`), per-file `errors` with `serving: retained` (previous version still served) or `missing`, and `fatalError`; only the last attempt |
| `GET /openapi.yaml` | the OpenAPI contract of the running version, as `application/yaml` |

## OpenAPI import

| Method and path | What it does |
|---|---|
| `POST /mocks/import/openapi` | imports the spec (raw JSON/YAML body, up to 12 MB); read `items` and `runtime` as described in [Outcome of a mutation](#outcome-of-a-mutation) |
| `POST /mocks/import/openapi?dryRun=true` | the plan and its counts, writing nothing |
| `POST /mocks/import/openapi?prefix=/be` | prepends `/be` to every imported path |

OpenAPI 3.0/3.1 and Swagger 2.0 are accepted, JSON or YAML. For each path+method the import
generates the path converted to Mockxy's convention (`/users/{id}` → `/users/:id`), the first
declared `2xx` status, and a body taken from the spec's example or sampled deterministically from
the schema. Collections come from the spec tags. Endpoints that already exist for the same
method+path are left untouched. A collection that cannot be assigned does not undo the endpoint:
it shows up in that item's `error`.

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

For the exact structure of every request and response body, read the machine-readable OpenAPI
3.1 description of this API. Newer engines serve the contract of the running version from
`GET /_admin/api/openapi.yaml`, the desktop app included: prefer it, because it always matches
the engine that answers. In the Mockxy repository the source is
`src/admin/admin-api.openapi.yaml` (`docs/admin-api.openapi.yaml` up to Mockxy 1.3.2). It
documents each route's schemas, status codes and payload variants. Prefer it to guessing from
this summary.
