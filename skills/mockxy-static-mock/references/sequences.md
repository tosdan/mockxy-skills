# Variant sequences

A sequence makes an endpoint's answer **evolve over time**: the typical case is a polling client
that must first receive `processing` and later `completed`. It is declared in the **endpoint
file**, not in a response file, because it is a selection policy on top of variants that already
exist — the payloads stay in the normal response files.

```json
{
  "method": "GET",
  "path": "/api/jobs/:id",
  "enabled": true,
  "responseFiles": ["001.response.json", "002.response.json"],
  "selectedResponseFile": "001.response.json",
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

`GET.responses/001.response.json` answers `202 processing`, `002.response.json` answers
`200 completed`. The first three calls get the first, every later call gets the second.

## Fields

| Field | Required | Rule |
|---|---|---|
| `enabled` | no | default `true`. With `false` the definition stays in the file but the classic `selectedResponseFile` selection applies |
| `steps` | yes | **at least 2** entries |
| `onEnd` | no | `"stay"` (default) or `"loop"` |
| `resetAfterMs` | no | positive integer |

`selectedResponseFile` stays **required even with an active sequence**: it is the anchor of the
classic behavior when the sequence is turned off.

### Steps

Each step references a variant listed in `responseFiles` and declares **at most one** advancement
criterion:

- **`times`** — answers N requests; integer ≥ 1.
- **`forMs`** — answers for N milliseconds **from its own first request**, not from the server
  clock; integer ≥ 1.

The last step may omit the criterion: it is the terminal state. The same variant may appear in
several steps.

Steps may reference **`mock` and `handler` variants only**. A `middleware`, `sse` or `ws` variant
in a step is a validation error that takes the endpoint down.

### `onEnd`

- `"stay"` — once the last step is exhausted, it keeps answering.
- `"loop"` — it restarts from the first step. Then **every** step must declare a criterion,
  including the last one, or the cycle would never restart.

### `resetAfterMs`

With no request for that long, the next call restarts from the first step. Useful for repeated
test runs: polling stops when the client sees the final outcome, and the next run starts over with
no manual intervention.

## The cursor

Where the sequence currently sits is **runtime state, not a file**. It resets:

- when the engine restarts;
- on explicit reset (UI button, or `POST /_admin/api/mocks/:id/sequence/reset`);
- after `resetAfterMs` of inactivity;
- when the sequence definition changes.

Edits to the endpoint file that do **not** touch the sequence — the description, for instance — do
not reset it.

## What the sequence does and does not decide

The sequence decides *which* variant answers, not *how*. Responses served by steps follow the
rules of their own nature: delays, automatic pagination and filters, handler timeouts.

An active sequence makes the engine load and validate **every step's variant** at load time, so a
broken step takes the whole endpoint down — unlike an unselected variant, which is inert until
selected.

## When not to use one

If the answer depends on the *content* of requests rather than on their order, a handler with its
`state` and `callCount` is the right tool (`mockxy-dynamic-mock`). A sequence expresses "first
this, then that", nothing else.
