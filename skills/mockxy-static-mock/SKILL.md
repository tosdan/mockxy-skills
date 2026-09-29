---
name: mockxy-static-mock
description: Write static response variants for a Mockxy endpoint — status, headers, JSON or text body, binary file payloads, simulated delay, request-driven templating and sequences that make the answer change over time. Use when a Mockxy mock must return a fixed payload, when an endpoint needs extra variants such as an empty list or an error case, when a captured or sample response must become a mock, or when a polling endpoint must answer differently on later calls.
---

# Mockxy static mocks

A static mock is a response variant of type `mock`: a JSON file in `<METHOD>.responses/` next to
the endpoint file, describing *how* to answer when that variant is selected. It is the first
choice — reach for a handler (`mockxy-dynamic-mock`) only when the answer genuinely needs logic.

## The two files

An endpoint always needs both. The endpoint file declares the route; the response file declares
the payload.

```
mocks/api/users/{id}/
├── GET.endpoint.json
└── GET.responses/
    ├── 001.response.json
    └── 002.response.json
```

`GET.endpoint.json`:

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

`method` must match the filename, `path` uses `:param` (folders use `{param}`), `enabled` is a
required boolean, and `selectedResponseFile` must be listed in `responseFiles`. Full rules: the
`mockxy-workspace` skill.

## The response file

```json
{
  "type": "mock",
  "title": "User found",
  "status": 200,
  "headers": { "x-example": "true" },
  "delayMs": 150,
  "body": { "id": 1, "name": "Ada", "role": "admin" }
}
```

- `type` — `"mock"`, required.
- `status` — required integer between 100 and 599.
- `body` **or** `file` — exactly one of the two, never both, never neither.
- `title`, `headers`, `delayMs`, `templated` — optional.

A JSON `body` is served as JSON. A **string** `body` is served verbatim **with no implicit
content-type**: declare it yourself in `headers` (`"content-type": "text/plain"`,
`"application/xml"`, …). That is the route for XML, CSV, HTML and any non-JSON text.

Every field, plus binary `file` payloads and how `delayMs` interacts with the global delay:
[references/mock-response.md](references/mock-response.md).

## Multiple variants are the point

Keep the full case, the empty list and the error side by side, and switch between them by changing
`selectedResponseFile` alone. Number the files as the UI does (`001.response.json`,
`002.response.json`, …) and give each a `title` that says what it represents — "Empty list",
"Server error", "Out of service".

When adding a variant to an existing endpoint: write the file, append its name to `responseFiles`,
and only change `selectedResponseFile` if the new variant should answer now.

**From captured traffic.** When the user wants a response captured by a running Mockxy (its
monitor or dump) turned into a mock, let the engine convert it through the admin API — the
`mockxy-workspace` skill, *Creating mocks from traffic*: it applies the rules the UI uses and
flags a truncated or binary body as an incomplete draft instead of inventing it. Write a captured
response by hand only when it comes from elsewhere (a HAR file, a log, a paste): keep the status,
drop transport headers (`content-length`, `content-encoding`, `transfer-encoding`, `connection`,
`keep-alive`, `date`), and never write a masked or truncated value as if it were real.

## Lists answer filters and pagination for free

When a JSON `body` is an **array**, or an object with **exactly one** top-level array property,
the response participates in automatic query filtering and pagination: `?role=admin`,
`?page=0&size=10`, plus an `X-Total-Count` header. Define the full dataset once instead of one
mock per combination — [references/lists.md](references/lists.md).

Do not add a query string to `path` on such an endpoint: a declared query demands exact equality
on the whole request query, so paginated requests would no longer match.

## Templating, when only a value must echo the request

With `"templated": true`, `{{...}}` placeholders in the body and headers are replaced with values
from the request: `{{params.id}}`, `{{query.role}}`, `{{headers.x-tenant}}`, `{{body.name}}`, plus
`{{now}}`, `{{uuid}}`, `{{randomInt 1 100}}`.

```json
{
  "type": "mock",
  "status": 200,
  "templated": true,
  "body": { "id": "{{params.id | number}}", "name": "User {{params.id}}", "createdAt": "{{now}}" }
}
```

There are no conditionals, loops or expressions: when logic is needed, the right step up is a
handler. Templating is not allowed on `file` payloads —
[references/templating.md](references/templating.md).

## Answers that change over time

For a polling client that must see `processing` and then `completed`, add a response variant with
`type: "sequence"` over variants that already exist, then select its filename in the endpoint:

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

Save it as (for example) `003.response.json`, append that filename to `responseFiles`, and set
`selectedResponseFile` to it. There is no sequence `enabled` toggle: selecting an ordinary
response deactivates the scenario while keeping the sequence variant available.

At least 2 steps; each step declares at most one of `times` (number of requests) or `forMs`
(milliseconds since its own first request); only the last step may omit it, unless
`onEnd` is `"loop"`. Steps may reference `mock` and `handler` variants only —
[references/sequences.md](references/sequences.md).

## Before reporting the work done

- A static response has `type: "mock"`, a `status` integer in 100–599, and exactly one of `body`
  and `file`.
- A sequence response has `type: "sequence"`, at least two valid steps, and only `mock` or
  `handler` targets.
- A string mock `body` carries an explicit `content-type` header.
- Mock headers are strings, numbers, booleans or arrays of strings — nothing nested.
- Every file listed in `responseFiles` exists on disk, and `selectedResponseFile` is one of them.
- Validate the workspace with the `mockxy-workspace` skill's
  `scripts/validate-workspace.js` and fix every error.
