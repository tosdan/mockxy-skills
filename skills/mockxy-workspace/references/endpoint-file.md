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

The redundancy between `method` and the filename is deliberate: the file stays self-describing
outside its folder.

## Selecting a sequence

A sequence is a regular response file with `"type": "sequence"`, listed in `responseFiles` like
every other variant. `selectedResponseFile` is its only activation switch: select the sequence
filename to run the scenario, or select an ordinary response to stop it. The endpoint file must
never contain `sequence`; the loader rejects that legacy field explicitly.

The sequence response holds its `steps`, `onEnd` and optional `resetAfterMs`. Its steps may target
only `mock` and `handler` files belonging to the same endpoint. Use the `mockxy-static-mock` skill
for the complete response format and cursor semantics.

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

Variants **not selected** (and not referenced by the selected sequence response) are not validated
until they become active: an incomplete variant file can sit in the workspace with no effect.

## Editing by hand

Any change to the file — switching the selected variant, disabling the endpoint, adding an entry
to `responseFiles` after creating the variant file — is picked up by hot reload when the watch is
active (the default in development). No restart and no UI round-trip: files and UI are two
equivalent views of the same data.
