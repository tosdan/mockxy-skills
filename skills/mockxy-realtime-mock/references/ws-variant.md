# The `ws` response variant

When the selected variant is of type `ws`, the WebSocket **upgrade** request on that endpoint is
handled locally — `101`, handshake accepted — instead of being forwarded to the backend. Upgrades
that match no `ws` endpoint follow the usual passthrough. A normal HTTP request on the endpoint
answers **`426 Upgrade Required`**.

```json
{
  "type": "ws",
  "title": "Notifications channel",
  "script": [
    { "afterMs": 0,    "data": { "type": "welcome" } },
    { "afterMs": 2000, "data": { "type": "promo", "discount": 20 } }
  ],
  "onEnd": "keep-open",
  "rules": [
    { "match": { "equals": "ping" }, "reply": [{ "afterMs": 0, "data": "pong" }] },
    { "match": { "json": { "action": "subscribe" } },
      "reply": [{ "afterMs": 100, "data": { "result": "subscribed" } }] }
  ],
  "presets": [{ "label": "Error", "data": { "type": "error" } }]
}
```

## Fields

| Field | Required | Rule |
|---|---|---|
| `type` | yes | `"ws"` |
| `title` | no | label of the variant; string |
| `script` | no | outgoing messages; may be empty (a mute endpoint: rules and console only) |
| `onEnd` | no | `"keep-open"` (default), `"close"` or `"loop"` |
| `closeCode` | no | `1000` or an integer in 3000–4999; **requires `onEnd: "close"`** |
| `closeReason` | no | string of at most 123 characters; **requires `onEnd: "close"`** |
| `rules` | no | declarative rules on incoming messages |
| `presets` | no | ready-made messages (macros) for the console |

### Script entries

| Field | Required | Rule |
|---|---|---|
| `afterMs` | yes | integer ≥ 0; delay **from the previous message** |
| `data` | yes | JSON — serialized on the wire — or a string. The key must be present; `null` is legal |

No `event` and no `id`: those are SSE concepts.

The script runs **on every connection, independently for each one**: reconnecting starts over.

### `onEnd`

- **`keep-open`** (default) — the connection stays open once the script is exhausted.
- **`close`** — the server closes it, optionally with `closeCode` and `closeReason`.
- **`loop`** — it starts over. Requires a non-empty script with at least one `afterMs` greater
  than zero.

### Rules

Evaluated in order on every incoming message, **the first match wins**.

```json
{ "match": { "contains": "subscribe" }, "reply": [{ "afterMs": 0, "data": { "ok": true } }] }
```

- `match` declares **exactly one** of:
  - **`equals`** — non-empty string; the message text must be exactly it;
  - **`contains`** — non-empty string; substring of the message text;
  - **`json`** — object; the message parses as JSON and **contains the given pairs** (a top-level
    subset, compared by value).
- `reply` — a **non-empty** running order with the same shape as `script`, sent **only to the
  connection that spoke**.

A message matching no rule is only recorded in the transcript: **no default echo, no logic**. When
more is needed, the right step up is a handler (`mockxy-dynamic-mock`).

### Presets

Same shape as script entries minus `afterMs`, plus an optional `label`. They are console macros
and never fire on their own.

## Runtime behavior

- In the silences the engine sends a protocol **ping** every 30 seconds, permissively: a missed
  pong does not close the connection.
- Connections are closed on hot reload and on shutdown: the client reconnects and the script
  starts over.
- The **console** in the endpoint's UI tab shows connections and the **bidirectional transcript**
  (outgoing from script, rules or manual direction; incoming from clients), with one-click resend.
  Via API: `POST /_admin/api/mocks/:id/ws/push` and `GET /_admin/api/mocks/:id/ws/connections`.
- A `ws` variant **cannot be a step of a `sequence` response**.

## Passthrough, for context

Everything that is not a `ws` mock is tunneled to the real backend: the handshake is forwarded
as-is and, if the backend accepts, the two sockets are glued together with no inactivity timeout.
Three cases are rejected locally without contacting anyone: no backend configured → `501`; proxy
fallback disabled (mock-only mode) → `404`; `/_admin/...` paths → `404`.

That is why mocking a channel is opt-in: an app that mocks its HTTP APIs keeps its live backend
connection working until a `ws` variant deliberately takes it over.

## Designing a useful channel

- Model the handshake the frontend expects first — the welcome message, the subscription ack —
  then the steady-state traffic.
- Use `rules` for the request/response pairs the client drives (`ping`/`pong`, subscribe/ack) and
  `script` for what the server pushes on its own.
- Keep `presets` for the events a tester wants to fire on demand: errors, disconnect notices,
  rare updates.
