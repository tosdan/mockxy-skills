# The admin API

Mockxy's whole UI is built on the admin API under `/_admin/api`: every UI action is a call to
these routes. Anything the UI does can therefore be automated.

**Writing files stays the default.** Reach for the admin API only when a Mockxy server is already
running and one of these applies:

- the user explicitly wants a live change against the running instance;
- the action has no on-disk representation: resetting a sequence cursor, pushing a message into an
  SSE or WebSocket console, reading the monitor, turning captured traffic into mocks, or changing
  the backend, delays or timeouts for the current run only;
- you are importing an OpenAPI specification, which the engine turns into many endpoints at once.

**Never start a server, import a specification or mutate a running instance unless the user asked
for it.** These are outward-facing, hard-to-undo actions: `DELETE` routes erase endpoint files and
their variants for good.

**The contract evolves with the app.** A minor Mockxy release may change the admin API. Before
relying on a newer capability (revisions, inactive variants, the paged monitor, mocks from the
monitor, runtime overrides), read the running version from `GET /info` and its contract from
`GET /openapi.yaml`, and check that the routes you need are declared. Updating these skills does
not update the user's installation: if the running engine lacks `/info` or the spec, say you
cannot verify the contract and stop before any change that depends on the newer behavior, naming
the update needed. To prepare a whole scenario for a test, see [scenario-setup.md](scenario-setup.md).

## When it answers

- **Check which instance answers** before changing anything: `GET /info` reports the
  `workspace` it serves (canonical folders and a stable `id`) and a `runtimeId` that changes at
  every start. Make sure the folders are the user's workspace; a different `runtimeId` from the
  one you saw means the engine restarted. Engines up to Mockxy 1.3.2 lack this route.

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
- **Batches** (`POST /mocks/import/openapi`, `POST /monitoring/requests/create-mocks`,
  `POST /monitoring/dumps/create-mocks`) keep the items that succeeded. Read the per-item outcome
  even with `201`: `items[].writeOutcome` (`created`, `skipped`, `failed`, and `variant_added`
  from traffic), `items[].runtimeOutcome` (`applied`, `not_applied`, `not_applicable`) with the
  reason in `items[].error`, and `runtime.status` (`applied`, or `degraded` when some endpoint
  files fail to load). The counts only describe what was written. **Stop the setup if one of
  your own resources is `not_applied`** and report it. A failed final reload answers
  `500 BATCH_RUNTIME_FAILED`; an item whose restore failed stops the batch with
  `500 ROLLBACK_FAILED`. Both carry the partial result in `details.result`.

## Editing with a precondition

Other clients (the UI, another agent, the user in an editor) may change the same endpoint while
you work. Newer engines let a save fail instead of silently overwriting their change:

1. Read what you are about to change and keep its revision: `descriptionRevision` of
   `GET /mocks/:id` for the description, `revision` of `GET /mocks/:id/responses/:file` for a
   variant (or `responseRevision` of the detail for the selected one).
2. Save with that revision as `expectedRevision`: `PUT /mocks/:id/endpoint` with `description`
   only (no `enabled` in the same call), `PUT /mocks/:id/responses/:file`, or the legacy
   `PUT /mocks/:id` for the selected variant. A raw upload takes it in the
   `X-Mockxy-Expected-Revision` header.
3. On `409` with `details.code: "REVISION_CONFLICT"` nothing was written. **Do not retry
   blindly**: read the resource again, compare the current content with your intended change,
   and either tell the user or save deliberately with the new revision. This is not
   `READ_INCONSISTENT`, which concerns a read and allows one automatic retry.

Revisions describe content, not history: the same content gives the same token, also after a
restart. They differ from the informative `revisions` of `GET /info`. Send `expectedRevision`
whenever you save a description, a variant or an upload on an engine that reports revisions;
engines up to Mockxy 1.3.2 have none. Selecting a variant, toggling `enabled` and resetting a
sequence are immediate actions without a precondition. A present but invalid `expectedRevision`
(`null` or empty included) is a `400`, never a silently disabled check.

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
| `PUT /mocks/:id/endpoint` | updates `description` and/or `enabled`; method and path are immutable. Send **only the field you change**: resending a value read earlier overwrites a change made meanwhile. Protect a description edit with `expectedRevision` ([Editing with a precondition](#editing-with-a-precondition)) |
| `PATCH /mocks/enabled` | enables or disables a list of endpoints — `{ ids, enabled }` with a non-empty `ids`; an unknown id fails the request before anything is written; answers with the refreshed catalog |
| `POST /mocks/:id/copy` | duplicates onto a new method+path — `{ method, path, copyResponses }`; a selected sequence copied alone brings its minimum step closure |
| `POST /mocks/:id/copy?dryRun=true` | read-only copy plan (`200`) with response files, assets, literal shared-state references and warnings; the real copy recalculates and returns `201` |
| `PUT /mocks/:id/collection` | assigns the endpoint to a collection |
| `DELETE /mocks/:id` | deletes endpoint and variants |

## Response variants

| Method and path | What it does |
|---|---|
| `GET /mocks/:id/responses/:file` | one variant by filename, selected or not — definition, direct `source`, asset `fileInfo`, `selected` and `active` (the selected variant or a step of the selected sequence); reading it changes nothing. If the selected variant cannot be read, it answers `400` rather than guess `active` |
| `POST /mocks/:id/responses` | adds and selects a `mock`, `handler`, `middleware`, `sse`, `ws` or `sequence` variant; with `select: false` it is prepared without being activated. The response reports `createdResponseFile` |
| `PUT /mocks/:id/responses/:file` | updates a variant, including sequence fields, `templated`, and SSE/WS scripts, rules and presets; the response reports `updatedResponseFile` |
| `PUT /mocks/:id/responses/:file/file` | uploads the raw bytes of a file-backed variant — `application/octet-stream` up to 12 MB, with `?contentType=…&filename=…` |
| `DELETE /mocks/:id/responses/:file` | deletes a variant; a sequence target is protected with `409` and `details.referencedBy` |

**Prepare, then activate.** When the user wants a variant ready but not yet serving (an error case
to switch on later, a revised step), create it with `select: false`: the current response, the
sequence cursor and the handler memory stay as they are, and the variant is validated like any
write. Before updating a variant by filename, read it and check `active`: changing the selected
variant or a step of the selected sequence changes what is being served. To revise an active step
without touching the running scenario, prepare a separate variant (and a separate sequence if
needed) instead of rewriting it. Engines up to Mockxy 1.3.2 ignore `select` and always select the
new variant.

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
| `GET /monitoring/requests` | captured traffic kept in memory (up to 250 entries): without a query every entry, complete, most recent first; with `view=page` a cursor page ([Reading the monitor](#reading-the-monitor)) |
| `GET /monitoring/requests/:id?runtimeId=…` | one complete entry by id — `409 RUNTIME_CHANGED` after a restart, `404 REQUEST_NOT_AVAILABLE` once evicted or cleared |
| `POST /monitoring/requests/create-mocks` | creates mocks from monitor entries, in the order given — `{ runtimeId, ids, onConflict, selectAddedVariants?, newEndpointEnabled }` ([Creating mocks from traffic](#creating-mocks-from-traffic)) |
| `DELETE /monitoring/requests` | clears the in-memory traffic; dump files on disk are untouched |
| `GET /monitoring/requests/stream` | Server-Sent Events: a `snapshot` of the current entries (in newer engines with the `runtimeId` their ids belong to), then one event per new request and a `clear` event |
| `GET /monitoring/dump` | state of the on-disk dump of captured traffic, with the `maxFileBytes` and `maxTotalBytes` limits in newer engines |
| `PATCH /monitoring/dump` | turns the dump on or off and tunes it at runtime — `{ enabled?, intervalMs?, threshold?, maxFileBytes?, maxTotalBytes? }`, validated as a whole before any field applies; only traffic captured after it is enabled is written. The limits (newer engines; older ones ignore them) apply from the next write, rotation or pruning and last until the engine restarts; `maxTotalBytes: 0` disables pruning |
| `POST /monitoring/dump/flush` | flushes pending monitor entries — body `{}` |
| `GET /monitoring/dumps` | lists the dump files |
| `GET /monitoring/dumps/read?fileIndex&lineIndex&limit` | reads the dumps page by page, oldest first; every item carries a `dumpKey`; keep passing `nextCursor` until `done` |
| `POST /monitoring/dumps/create-mocks` | creates mocks in bulk from captured traffic — `{ file }` for a whole dump file or `{ keys }` with `dumpKey` values, plus the options of the monitor route, optional here with the historical defaults (`skip`, no selection, new endpoints enabled). Read `items` and `runtime` as described in [Creating mocks from traffic](#creating-mocks-from-traffic) |
| `DELETE /monitoring/dumps/:file` | deletes one dump file |
| `GET /runtime/shared-state` | metadata, usage and limits of handler shared state; never values |
| `POST /runtime/shared-state/:name/reset` | idempotently resets one resource — body `{}`; returns `{ name, reset }` |
| `POST /runtime/shared-state/reset` | resets all resources — body `{}`; returns `{ resetCount }` |
| `GET /server`, `PATCH /server` | `{ serverEnabled, proxyAll }` — the three serving modes |
| `GET /info` | who answers and on what — `version`, `runtimeId` (new at every start), `workspace` (`id` and canonical `mocksDir`, `filesDir`, `root`), `listener`, `watcher` and `revisions` (`catalog`, `server`, `dump`, `diagnostics`, `config`) that grow when the resource changes; cheap to poll |
| `GET /config` | startup, effective and overridden configuration — `{ runtimeId, startup, effective, overrides, persisted }` with the nine runtime settings (`backendUrl` is `null` without a backend); no other environment variable |
| `PATCH /config` | overrides the nine settings until the engine restarts — `{ set?, unset? }` ([Runtime configuration](#runtime-configuration)) |
| `GET /runtime/status` | outcome of the last load of the workspace, `200` even when degraded or failed — `lastAttempt` (`reasons` among `startup`, `admin`, `watcher`; `status` `applied`, `degraded` or `failed`), per-file `errors` with `serving: retained` (previous version still served) or `missing`, and `fatalError`; only the last attempt |
| `GET /openapi.yaml` | the OpenAPI contract of the running version, as `application/yaml` |

## Reading the monitor

To check what a test or a browser action produced, read only the traffic after a cursor taken
**before** the action (newer engines; up to Mockxy 1.3.2 the route ignores every query parameter):

1. `GET /monitoring/requests?view=page&since=latest` — no items, and a `cursor`
   `{ runtimeId, generation, since }` pointing at "now". Take one per filter set you will use.
2. Run the action.
3. `GET /monitoring/requests?view=page&since=…&runtimeId=…&generation=…` with the cursor values
   and your filters (`method`, `path` without query string, `status`, `source`; exact match,
   combined with AND). Items come **oldest first**; `fields=summary` (default) has no bodies or
   headers, `fields=full` the complete entry. Keep sending back `cursor` while `hasMore` is
   `true`. Keep the same filters for the whole read; `limit` (1–250, default 50) and `fields`
   may change.

**Check `gap` on every page.** `gap: true` with `gapReason` `runtime_changed` (the engine
restarted), `cleared` (someone emptied the monitor) or `evicted` (entries after your cursor were
pushed out of the 250-entry buffer) means part of the range is lost: an empty `items` then does
**not** mean "no requests". Report it instead of concluding. A `since` beyond the last id
assigned is `400 CURSOR_AHEAD`; any query parameter without `view=page`, or an unknown one, is
`400 INVALID_QUERY` with `details.parameter`. Read one entry in full with
`GET /monitoring/requests/:id?runtimeId=…`. The monitor is a memory buffer, not an archive: use
the dump for durable capture.

## Runtime configuration

Newer engines let you change nine settings for the **current run** with `PATCH /config`; check
that `GET /openapi.yaml` declares `patchRuntimeConfig` first. Nothing is written to disk, and a
restart brings back the startup values: this is how to point Mockxy at another backend or slow it
down for a test, not how to change the user's setup. For a permanent change, edit `.env` or ask
the user to change the desktop workspace settings.

- **`set`** overrides: `backendUrl` (absolute http/https URL, or `null` to disable the backend),
  the booleans `proxyFallbackEnabled`, `corsEnabled`, `delayAllRequests`,
  `caseInsensitiveFilters`, `adaptProxyCookies`, `rewriteProxyRedirects` (real booleans, never
  strings), `globalDelayMs` (integer 0–2147483647) and `requestTimeoutMs` (integer
  1–2147483647).
- **`unset`** removes overrides: the setting goes back to its startup value.
  `unset: ["backendUrl"]` restores the startup backend; `set: { backendUrl: null }` disables it.
  Unsetting a setting with no override succeeds and changes nothing.
- Name at least one setting, none twice. Host, port, folders, the admin API and the watcher are
  fixed at startup: any other name is a `400 MUTATION_REJECTED` with `details.key`.

The whole body is validated before anything applies: a `400` changes nothing. The `200` answer is
the new `GET /config`: `effective` is what serves now, `overrides` only what was patched (an
override equal to its startup value stays listed until unset). Each request keeps the
configuration it had when it entered: a request already waiting on a delay finishes with the old
backend, the next one uses the new; open WebSocket tunnels and streams are not moved.

Overrides left by an earlier session last until a restart, so **read `effective`, never assume
the startup values**, and set explicitly what a test depends on. The user sees overrides under
«Configuration» in the Mockxy status bar and can revert them there; tell them which ones you left.
In the desktop app, saving workspace settings that restart the engine drops every override.

## Creating mocks from traffic

Newer engines turn captured responses into mocks on the server, with the rules the UI uses: from
the monitor with `POST /monitoring/requests/create-mocks`, from the dump with
`POST /monitoring/dumps/create-mocks`. Check that `GET /openapi.yaml` declares the monitor route
before relying on it. Older engines have only the dump route, which accepts `{ file }` or
`{ keys }` alone, skips existing endpoints and enables the new ones.

The monitor body is `{ runtimeId, ids, onConflict, selectAddedVariants?, newEndpointEnabled }`:

- `runtimeId` is the one of the page (`cursor.runtimeId`) or of the stream `snapshot` the `ids`
  come from, because ids restart at every start: another runtime answers `409 RUNTIME_CHANGED`
  and writes nothing. `ids` are 1–250 distinct decimal strings, processed in the order given.
- `onConflict` is required. The conflict is on the destination's exact method and route, against
  the catalog and the earlier items of the same batch. `skip` leaves that endpoint as it is;
  `add-variant` adds the capture as a new variant, selected only with
  `selectAddedVariants: true`, and keeps the endpoint's enabled state.
- `newEndpointEnabled` is required: a capture never activates anything implicitly.

The dump route takes the same options next to `{ file }` or `{ keys }`, all optional there, with
the historical defaults `onConflict: "skip"`, `selectAddedVariants: false`,
`newEndpointEnabled: true`.

**Prepare, check, then activate.** To add traffic without touching what is served, send
`newEndpointEnabled: false`, and `onConflict: "add-variant"` with `selectAddedVariants: false`.
Then read every item, even with `201`:

- `writeOutcome`: `created`, `variant_added`, `skipped` or `failed` with `error`. Several
  endpoints matching the same destination fail the item with `candidates`: choose with the user,
  never at random.
- `captureOutcome`: `complete`, `incomplete`, or `unavailable` for an entry evicted or cleared
  before the batch ran (the other items go on).
- `warnings`: `INCOMPLETE_CAPTURE` with `reason` `truncated` or `binary` means the body became
  `{}` and the draft is marked `[da completare]` (endpoint description or variant title). It is
  **not** a copy of the real response: complete it before serving it. `SUPERSEDED` with `by`
  means a later item of the batch selected another variant on the same endpoint, so this one is
  not served.
- `id` and `responseFile`, to select and enable deliberately afterwards; from the monitor also
  `requestId` and `counts`, from the dump the entry's `key` and the historical counts.

The conversion takes the route that served the request, or the request path (no parametric route
is inferred), the uppercase method, the captured status and `delayMs` 0. A JSON body becomes its
value, other text stays a string. Headers lose `content-length`, `content-encoding`,
`transfer-encoding`, `connection`, `keep-alive`, `date`, empty values and masked `***` values (a
masked value is never restored). Newer engines also drop Mockxy's own `x-mock-source`, which
serving sets by itself; with an older one, a mock created from a backend capture stores
`x-mock-source: backend`, harmless because serving replaces it, and you may remove it. Neither
captures nor dump files are deleted.

**A batch is not idempotent.** If the answer is lost, do not send it again: read the catalog and
stop unless you can tell with certainty which items were written. A batch that fails after
writing (`500 BATCH_RUNTIME_FAILED` or `ROLLBACK_FAILED`) reports what was written in
`details.result`, in the shape of the `201`.

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
