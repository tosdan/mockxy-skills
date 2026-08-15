---
name: mockxy-realtime-mock
description: Write Mockxy streaming response variants — Server-Sent Events (`sse`) and mocked WebSocket channels (`ws`) — with their message scripts, reply rules, end behavior and console presets. Use when a mocked endpoint must push events to the client instead of answering once — progress streams, notification feeds, live updates, chat-like channels — or when a frontend opens an EventSource or a WebSocket and needs something on the other end.
---

# Mockxy realtime mocks

Two response variant types keep a connection open instead of answering once:

- **`sse`** — the endpoint answers with a `text/event-stream` that stays open and emits events
  following a script.
- **`ws`** — the WebSocket upgrade is accepted locally; messages go out from a script, answer
  declarative rules, or are pushed from the console.

Both are ordinary variants: same endpoint file, same `<METHOD>.responses/` folder, selected through
`selectedResponseFile`. Neither may be a step of a `sequence` response.

## The endpoint file is unchanged

```json
{
  "method": "GET",
  "path": "/api/events",
  "description": "Job progress stream",
  "enabled": true,
  "responseFiles": ["001.response.json"],
  "selectedResponseFile": "001.response.json"
}
```

`method` must match the filename, `path` uses `:param`, `enabled` is a required boolean. For a
WebSocket channel declare the method the client uses for the upgrade — `GET`. Full rules: the
`mockxy-workspace` skill.

## Server-Sent Events

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

- `script` — the running order, possibly empty. Each entry: **`afterMs`** (delay from the previous
  message, integer ≥ 0, **required**), **`data`** (JSON or string, **required**), optional `event`
  and `id`.
- `onEnd` — `"keep-open"` (default), `"close"` or `"loop"`.
- `retryMs` — optional; the SSE `retry:` field sent at the head of the connection.
- `presets` — optional ready-made messages for the endpoint's console.

The script runs **on every connection, independently for each one**: reconnecting starts over.
A plain HTTP request on the endpoint gets the stream too — that is the point.
[references/sse-variant.md](references/sse-variant.md).

## WebSocket

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

- `script` — outgoing messages, possibly empty. Each entry: **`afterMs`** (≥ 0, required) and
  **`data`** (required). No `event` or `id`: those are SSE concepts.
- `rules` — declarative rules on incoming messages, evaluated in order, **first match wins**.
  `match` declares **exactly one** of `equals`, `contains` or `json`; `reply` is a non-empty
  running order sent **only to the connection that spoke**.
- `onEnd` — `"keep-open"` (default), `"close"` (with optional `closeCode` / `closeReason`) or
  `"loop"`.

A message matching no rule is only recorded in the transcript: no default echo. A normal HTTP
request on a `ws` endpoint answers **`426 Upgrade Required`** —
[references/ws-variant.md](references/ws-variant.md).

## Rules that catch most mistakes

- `afterMs` is a delay **from the previous message**, not an absolute offset from the connection
  start. A script of three entries at `afterMs: 1000` fires at 1s, 2s and 3s.
- `afterMs` and `data` are required on every script entry; `data` is required on every preset and
  reply too. `data: null` is a valid value — the key must simply be present.
- `onEnd: "loop"` needs a non-empty script with **at least one** entry whose `afterMs` is greater
  than zero, or the loop would spin.
- `closeCode` and `closeReason` only make sense with `onEnd: "close"`, and `closeCode` must be
  `1000` or an integer in 3000–4999.
- Neither variant may be referenced by a `sequence` step.

## Before reporting the work done

- `type` is `"sse"` or `"ws"`, and every script entry has `afterMs` and `data`.
- With `onEnd: "loop"`, the script is non-empty and not all delays are zero.
- WebSocket rules declare exactly one match kind and a non-empty `reply`.
- The variant is listed in `responseFiles` and, if it should answer now, in
  `selectedResponseFile`.
- Validate the workspace with the `mockxy-workspace` skill's `scripts/validate-workspace.js` and
  fix every error.
