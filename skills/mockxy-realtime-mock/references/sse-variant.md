# The `sse` response variant

When the selected variant is of type `sse`, the endpoint answers with a `text/event-stream` that
stays open: the **script** runs **on every connection, independently for each one** — reconnecting
means starting from the beginning.

```json
{
  "type": "sse",
  "title": "Job progress",
  "retryMs": 3000,
  "script": [
    { "afterMs": 0,    "event": "progress", "data": { "percent": 10 } },
    { "afterMs": 1500, "event": "progress", "data": { "percent": 60 } },
    { "afterMs": 3000, "event": "done",     "data": { "percent": 100 } }
  ],
  "onEnd": "keep-open",
  "presets": [
    { "label": "Error", "event": "error", "data": { "message": "boom" } }
  ]
}
```

## Fields

| Field | Required | Rule |
|---|---|---|
| `type` | yes | `"sse"` |
| `title` | no | label of the variant; string |
| `script` | no | array of messages; may be empty (a mute endpoint fed only by the console) |
| `onEnd` | no | `"keep-open"` (default), `"close"` or `"loop"` |
| `retryMs` | no | non-negative integer; the SSE `retry:` field sent at the head of the connection |
| `presets` | no | ready-made messages (macros) for the endpoint's console |

### Script entries

| Field | Required | Rule |
|---|---|---|
| `afterMs` | yes | integer ≥ 0; delay **from the previous message** |
| `data` | yes | JSON — serialized — or a string, multi-line allowed. The key must be present; `null` is a legal value |
| `event` | no | non-empty string; the SSE `event:` field |
| `id` | no | string; the SSE `id:` field |

### `onEnd`

- **`keep-open`** (default) — once the script is exhausted the connection stays open for
  heartbeats and manual pushes.
- **`close`** — the server closes the stream.
- **`loop`** — it starts over. Requires a non-empty script with **at least one** entry whose
  `afterMs` is greater than zero, otherwise it would be a tight loop.

### Presets

Entries have the same shape as script messages minus `afterMs`, plus an optional `label`:

```json
{ "label": "Error", "event": "error", "data": { "message": "boom" } }
```

They are the console's macros; they never fire on their own.

## Runtime behavior

- In the silences the engine sends a **heartbeat** comment every 15 seconds, invisible to clients.
- Connections are closed on hot reload and on shutdown: the SSE client reconnects on its own and
  the script starts over.
- The **console** in the endpoint's UI tab shows open connections and history, and allows manual
  direction (broadcast to every connection). Via API: `POST /_admin/api/mocks/:id/sse/push` and
  `GET /_admin/api/mocks/:id/sse/connections`. Newer engines target the definition the runtime
  serves, not the selection on disk: `404` if the endpoint is not served, `400` if it is served
  with another type.
- The monitor entry is created when the connection closes.
- An `sse` variant **cannot be a step of a `sequence` response**.
- A proxy middleware never transforms a declared `text/event-stream`: buffering a stream that
  never ends would hang the request.

## Designing a useful stream

- Model the timeline the frontend must react to, not the backend's internal chatter: a few named
  events (`progress`, `done`, `error`) beat a flood of untyped messages.
- Use `event` names the client actually listens for — an `EventSource` with
  `addEventListener("progress")` never sees messages without an `event` field, which arrive as
  `message`.
- Keep the total script short. For a stream that must run for minutes, `onEnd: "loop"` over a few
  entries beats hundreds of hand-written ones.
- Put failure cases in `presets` rather than in the script: the tester triggers them from the
  console when the moment is right.
