# The endpoint file

Every mocked endpoint is declared by an endpoint file: a JSON file stating which method and path
it covers, whether it is active, which response variants exist and which one is served right now.
The engine discovers endpoints by walking the mocks folder recursively and collecting every file
whose name ends in `.endpoint.json`.

## Location and name

The filename is `<METHOD>.endpoint.json`, so one folder can host several methods of the same path.
Variants live in the twin folder `<METHOD>.responses/`.

```
mocks/api/users/{id}/
├── GET.endpoint.json        # declares GET /api/users/:id
├── GET.responses/
│   ├── 001.response.json
│   └── 002.response.json
└── DELETE.endpoint.json     # same path, other method
```

The folder position is a **convention, not a constraint**: the served path is the one declared in
`path`, not the one rebuilt from the folders. Mirror the API path anyway — it makes the workspace
navigable — and write path parameters as `{id}` in folder names, because `:` is not allowed in
Windows folder names.

## Fields

```json
{
  "method": "GET",
  "path": "/api/users/:id",
  "description": "User detail",
  "enabled": true,
  "responseFiles": ["001.response.json", "002.response.json"],
  "selectedResponseFile": "001.response.json"
}
```

| Field | Required | Rule |
|---|---|---|
| `method` | yes | one of `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`, uppercase; must equal the method in the filename |
| `path` | yes | non-empty absolute path; see [path-convention.md](path-convention.md) |
| `description` | no | free text, shown in the UI catalog; must be a string when present |
| `enabled` | yes | boolean. `false` unregisters the endpoint: those requests follow the fallback (proxy to the real backend, or `404` in mock-only mode) |
| `responseFiles` | yes | non-empty array of plain filenames ending in `.response.json`; no path separators, no duplicates. The order is the one the UI shows |
| `selectedResponseFile` | yes | the variant currently served; must be listed in `responseFiles` |
| `sequence` | no | variant sequence, see below |

The redundancy between `method` and the filename is deliberate: the file stays self-describing
outside its folder.

## The variant sequence

For endpoints whose answer must **change over time** — the typical case being a polling client
that first receives `processing` and then `completed` — the endpoint file can declare a sequence:
an order of variants with how long each one lasts. It is a selection policy on top of existing
variants; the payloads stay in the normal response files.

```json
{
  "sequence": {
    "enabled": true,
    "steps": [
      { "response": "001.response.json", "times": 3 },
      { "response": "002.response.json" }
    ],
    "onEnd": "stay",
    "resetAfterMs": 30000
  }
}
```

- `enabled` — optional, default `true`. With `false` the definition stays in the file but the
  classic `selectedResponseFile` selection applies. `selectedResponseFile` remains required in
  every case.
- `steps` — **at least 2 entries**. Each step references a variant listed in `responseFiles` and
  declares **at most one** advancement criterion: `times` (answers N requests, integer ≥ 1) or
  `forMs` (answers for N milliseconds **from its own first request**, not from the server clock).
  The last step may omit the criterion: it is the terminal state. The same variant may appear in
  several steps.
- `onEnd` — `"stay"` (default) stops on the last step; `"loop"` restarts from the first, and then
  **the last step must declare a criterion too**.
- `resetAfterMs` — optional positive integer: with no request for that long, the next call
  restarts from the first step.

Steps may reference **`mock` and `handler` variants only**. A `middleware`, `sse` or `ws` variant
in a step is a validation error.

When a sequence is active the engine loads and validates **every step's variant** at load time, so
a broken step takes the endpoint down just like a broken selected variant would.

The cursor is runtime state, not a file: it resets on engine restart, on explicit reset (UI or
admin API), on inactivity (`resetAfterMs`) and when the sequence definition changes. Edits to the
endpoint file that do not touch the sequence — the description, for instance — do not reset it.

## Validation and error handling

The file is validated at load: recognized method consistent with the filename, non-empty
well-formed path, boolean `enabled`, non-empty duplicate-free variant list, selected variant
present in the list. Names in `responseFiles` that try to escape the folder (path separators,
relative references) are rejected.

Two properties worth knowing:

- **degradation is per-endpoint**: a broken file — invalid JSON, missing selected variant, failed
  validation — is skipped and reported without preventing the other endpoints from loading. At
  startup the error is a warning in the log; on hot reload the endpoint keeps its last valid
  version until the file is correct again;
- **duplicates are an error**: two endpoint files declaring the same method+path pair (in
  different folders) conflict — the first one encountered wins, the second is reported and
  ignored.

Variants **not selected** (and not referenced by an active sequence) are not validated until they
become active: an incomplete variant file can sit in the workspace with no effect.

## Editing by hand

Any change to the file — switching the selected variant, disabling the endpoint, adding an entry
to `responseFiles` after creating the variant file — is picked up by hot reload when the watch is
active (the default in development). No restart and no UI round-trip: files and UI are two
equivalent views of the same data.
