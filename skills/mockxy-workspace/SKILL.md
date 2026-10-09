---
name: mockxy-workspace
description: Create, inspect and validate a Mockxy mock workspace and its endpoint files. Use when the user points at a Mockxy workspace folder and asks to add, change or organize mocked HTTP endpoints; when a workspace must be initialized from scratch; when endpoints must be enabled, disabled, renamed, grouped into collections or configured with a sequence response; or when a workspace must be checked for format errors before being handed back or committed.
---

# Mockxy workspace

A **Mockxy workspace** is a folder that fully describes a mock environment. Everything is plain
files on disk: writing them correctly is the whole job, and the engine hot-reloads them without a
restart.

This skill owns the workspace layout and the **endpoint file**. The content of a response variant
belongs to the sibling skills:

| To write | Use |
|---|---|
| static responses, templating, sequence responses | `mockxy-static-mock` |
| handler and middleware scripts, data files | `mockxy-dynamic-mock` |
| Server-Sent Events and WebSocket variants | `mockxy-realtime-mock` |

## Start here

1. **Locate the workspace.** Ask the user for the path if it was not given. A folder is a
   workspace when it contains `mockxy.json`.
2. **Read before writing.** List the existing endpoints (`mocks/**/*.endpoint.json`) and open two
   or three of them. Match the conventions already in the workspace — folder shape, response
   filenames, description style — instead of imposing new ones.
3. **Write the files** (see below). Do not run the Mockxy server yourself unless the user asks.
4. **Validate** before reporting the work done:

   ```sh
   node <path-to-this-skill>/scripts/validate-workspace.js <workspace-path>
   ```

   Pass the **workspace root**, the folder holding `mockxy.json` and `mocks/`. To validate a
   mocks folder that has no workspace root around it, name it with `--mocks-dir <folder>` instead.
   A folder that could be either one is refused, never guessed: follow the message.

   Fix every `ERROR` and re-run. Read `WARN` lines and decide: most of them mean the engine will
   silently ignore something you wrote. The script loads handler and middleware sources to check
   their exports, exactly as the engine does; pass `--no-scripts` to skip that.

   When the workspace has scripts, read the `Scripts:` line too. The **script contract** (where
   and how a script may `require` local code — see `mockxy-dynamic-mock`) is checked by the engine,
   not by this script. Say where an engine with the full validation is, when there is one:

   ```sh
   # a running Mockxy: used only if GET /info says it serves this very workspace
   node <path-to-this-skill>/scripts/validate-workspace.js <workspace-path> --server-url http://127.0.0.1:3000
   # a Mockxy folder (the one holding index.js), with no server
   node <path-to-this-skill>/scripts/validate-workspace.js <workspace-path> --engine-dir <mockxy-folder>
   ```

   Both run the top level of every script of the workspace once, change nothing that is served,
   and need a newer engine (after Mockxy 1.5.0). Like the engine at its first load, `--engine-dir`
   creates `mocks/package.json` when the workspace has scripts and the file is missing; the
   report says so. Without one the report ends with
   `Script contract NOT checked`: repeat that to the user instead of calling the scripts verified.
   Never guess a port: use `--server-url` only with an address the user gave you or that you
   started yourself at their request.

## Layout

```
my-workspace/
├── mockxy.json              # marker: { "formatVersion": 1 }        (shared, in git)
├── .gitignore               # must ignore .mockxy/                  (shared)
├── mocks/                   # endpoint definitions                  (shared)
│   ├── .collections.json    # optional catalog grouping for the UI
│   ├── package.json         # only with scripts: defines the #shared/ alias
│   ├── _shared/             # only with scripts: helpers used by several endpoints
│   └── api/users/{id}/
│       ├── GET.endpoint.json
│       └── GET.responses/
│           ├── 001.response.json
│           └── 002.response.json
├── files/                   # flat folder of JSON datasets          (shared)
└── .mockxy/                 # local settings and captured traffic   (never in git)
```

Only touch the shared part. `.mockxy/` holds machine-local settings and captured traffic: never
create, edit or commit it.

To initialize a new workspace: create `mockxy.json` with `{ "formatVersion": 1 }`, the empty
`mocks/` and `files/` folders, and add `.mockxy/` to `.gitignore`.

`mocks/package.json` and `mocks/_shared/` belong to handler and middleware scripts: the
`mockxy-dynamic-mock` skill says when to create them. Never edit an existing `mocks/package.json`
and never add another `package.json` below `mocks/`: Node reads it once per process, so a change
needs a restart of Mockxy, and a nested one breaks the alias for the scripts under it.

## The endpoint file

One file per HTTP method, named `<METHOD>.endpoint.json`, with its variants in the twin folder
`<METHOD>.responses/`.

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

The rules the engine enforces:

- `method` — `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD` or `OPTIONS`, uppercase, and it
  **must match the filename**.
- `path` — absolute, starting with `/`, with `:name` parameters. `{id}` belongs to *folder* names
  only, never to `path`.
- `enabled` — required boolean. `false` sends those requests to the fallback (proxy or 404).
- `responseFiles` — at least one plain filename ending in `.response.json`, no path separators, no
  duplicates.
- `selectedResponseFile` — required, and must be one of `responseFiles`.
- `sequence` is **not** an endpoint field. A sequence is a response variant; selecting its filename
  is the only way to activate it.

The folder tree mirrors the API path by convention only: what is served is the `path` field.
Use `{id}` in folder names because `:` is not a legal Windows path character.

Two endpoint files declaring the same method+path are a conflict: the first wins and the second is
ignored with a warning. A broken endpoint file does not take the server down — only that endpoint
is skipped.

Details: [references/endpoint-file.md](references/endpoint-file.md) for every field including
sequence selection, [references/path-convention.md](references/path-convention.md) for how Mockxy
decides which endpoint answers a request.

## Adding a variant to an existing endpoint

1. Write the new file in `<METHOD>.responses/`, numbering it after the last one.
2. Append its name to `responseFiles`.
3. Change `selectedResponseFile` only if the new variant is the one that should answer now.

Switching which response is served means changing `selectedResponseFile` — nothing else.

## Organizing the catalog

`mocks/.collections.json` groups endpoints in the UI. It is optional metadata: it never affects
routing. Only write it when the user asks for grouping, and keep its `memberships` keys aligned
with the real relative paths of the endpoint files —
[references/collections.md](references/collections.md).

## Files or admin API

**Writing files is the default**: it works with the server stopped, it is what git versions, and
hot reload picks it up. Use it unless there is a reason not to.

The **admin API** under `/_admin/api` is the alternative when a Mockxy server is already running
and the user wants a live change, a runtime action files cannot express (resetting a sequence
cursor or handler shared state, pushing an SSE/WS message, reading captured traffic or turning it
into mocks, changing the backend, delays or timeouts for the current run) or an OpenAPI import —
[references/admin-api.md](references/admin-api.md). Never start a server, import a spec
or mutate a running instance without the user asking.

Working live:

1. **Identify the instance.** `GET /info` must report the user's `workspace`; keep its
   `runtimeId` (a new one means the engine restarted). The admin API evolves with the app and a
   minor release may change it: read `GET /openapi.yaml` before relying on a newer capability. If
   `/info` or the spec is missing, or a route you need is not declared, stop before any change and
   say which update is needed — never probe with a write.
2. **Read, prepare, then activate.** Resolve endpoints by method and path and variants by file
   name, not by title or the current selection. Create with `select: false`, save with the
   revision you read as `expectedRevision`, check `active` (a step of the selected sequence is
   served even when not selected), and only then select, enable and reset —
   [Editing with a precondition](references/admin-api.md#editing-with-a-precondition).
3. **Confirm the outcome.** A `2xx` means the change is served; on a failure branch on
   `details.code`, and after a batch read the per-item outcomes even with `201` —
   [Outcome of a mutation](references/admin-api.md#outcome-of-a-mutation). Never retry a create
   or a `409 REVISION_CONFLICT` blindly: read first.
4. **Verify with traffic** taken after a monitor cursor you read before the action —
   [Reading the monitor](references/admin-api.md#reading-the-monitor).

To put an instance into a known state for a test, from whatever state it is in and without
restoring anything afterwards, follow [references/scenario-setup.md](references/scenario-setup.md),
which includes a Playwright example.

## Before reporting the work done

- Every endpoint file has a matching `<METHOD>.responses/` folder containing every file listed in
  `responseFiles`.
- `selectedResponseFile` is listed in `responseFiles`.
- No two endpoints declare the same method+path.
- `path` uses `:param`, folders use `{param}`.
- The validator exits 0, and each remaining warning is either fixed or explained to the user.
- With scripts in the workspace: the `Scripts:` line says the engine checked them, or the user has
  been told that the script contract was not verified.
