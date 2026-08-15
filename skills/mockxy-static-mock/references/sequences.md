# Sequence responses

A sequence makes an endpoint's answer **evolve over time**: the typical case is a polling client
that must first receive `processing` and later `completed`. It is a regular response variant with
`type: "sequence"`; selecting that response is the only way to activate the scenario.

For example, keep `001.response.json` (`202 processing`) and `002.response.json`
(`200 completed`), then add `GET.responses/003.response.json`:

```json
{
  "type": "sequence",
  "title": "Processing then completed",
  "steps": [
    { "response": "001.response.json", "times": 3 },
    { "response": "002.response.json" }
  ],
  "onEnd": "stay",
  "resetAfterMs": 30000
}
```

List and select it in `GET.endpoint.json`:

```json
{
  "method": "GET",
  "path": "/api/jobs/:id",
  "enabled": true,
  "responseFiles": ["001.response.json", "002.response.json", "003.response.json"],
  "selectedResponseFile": "003.response.json"
}
```

The first three calls get the first step, and every later call gets the second. To stop the
scenario without deleting it, select `001.response.json` or `002.response.json`. There is no
sequence `enabled` field, and the legacy `endpoint.sequence` shape is rejected.

## Fields

| Field | Required | Rule |
|---|---|---|
| `type` | yes | exactly `"sequence"` |
| `title` | no | UI label; string |
| `steps` | yes | at least 2 entries |
| `onEnd` | no | `"stay"` (default) or `"loop"` |
| `resetAfterMs` | no | positive integer; omit it for no inactivity reset |

### Steps

Each step references a filename listed in the same endpoint's `responseFiles` and declares at
most one advancement criterion:

- **`times`** — answer N requests; integer ≥ 1.
- **`forMs`** — answer for N milliseconds **from that step's first request**, not from the server
  clock; integer ≥ 1.

The last step may omit the criterion: it is the terminal state. The same variant may appear in
several steps.

Steps may reference **`mock` and `handler` variants only**. Nested `sequence` responses and
`middleware`, `sse` or `ws` variants are validation errors that take the endpoint down.

### `onEnd`

- `"stay"` — once the last step is exhausted, keep answering with it.
- `"loop"` — restart from the first step. Then **every** step must declare a criterion, including
  the last one, or the cycle would never restart.

### `resetAfterMs`

With no request for that long, the next call restarts from the first step. This is useful for
repeatable tests where polling stops as soon as it sees the final outcome.

## Cursor identity and reset

The cursor is runtime state, not a file. Its identity includes the endpoint and the selected
sequence filename, so two sequence variants on the same endpoint never share progress. It resets:

- when the engine restarts;
- on explicit reset through the UI or `POST /_admin/api/mocks/:id/sequence/reset`;
- after `resetAfterMs` of inactivity;
- when selecting a different response, including another sequence;
- when `steps`, `onEnd` or `resetAfterMs` changes.

Changing only the sequence `title`, or editing unrelated endpoint metadata such as `description`,
preserves the cursor. Reset and scenario transitions also clear the endpoint's handler memory so
a handler step cannot resume with state from a previous run.

Read the lightweight live state with `GET /_admin/api/mocks/:id/sequence/state`. Both state and
reset routes return the selected `sequenceFile` plus `sequenceState`; they answer `400` when the
selected response is not a sequence.

## Validation, deletion and copying

When the selected response is a sequence, the engine loads and validates its **whole step graph**
before installing the route. A missing or invalid target therefore takes the endpoint down, unlike
an unrelated unselected variant.

The admin API applies the same full validation before create, update, selection and copy. It
rejects deletion of a referenced target with `409` and `details.referencedBy`. Copying an endpoint
with `copyResponses: false` still copies the selected sequence plus the minimum set of step
responses and their assets, so the result remains executable.

## When not to use one

If the answer depends on request content rather than order, use a handler with `state` and
`callCount` (`mockxy-dynamic-mock`). A sequence expresses "first this, then that", nothing else.
