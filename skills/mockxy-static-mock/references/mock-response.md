# The `mock` response file

Every response variant of an endpoint is a JSON file inside `<METHOD>.responses/`, next to the
endpoint file, describing *how* to answer when that variant is selected. The `type` field
distinguishes six natures of response — `mock`, `handler`, `middleware`, `sse`, `ws`, `sequence`.
This page documents `mock`: a static response described in the file itself.

The UI creates files with progressive names (`001.response.json`, `002.response.json`, …), but any
name ending in `.response.json` is valid, as long as it is a plain filename (no paths) and is
listed in the endpoint file's `responseFiles`.

## Fields

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

| Field | Required | Rule |
|---|---|---|
| `type` | yes | `"mock"` |
| `status` | yes | integer between 100 and 599 |
| `title` | no | label of the variant, shown by the UI; string |
| `headers` | no | object whose values are strings, numbers, booleans or arrays of strings (arrays produce repeated headers). No nested objects |
| `delayMs` | no | non-negative integer; delay before answering |
| `templated` | no | default `false`; enables `{{...}}` placeholders in body and headers. Not allowed with `file` |
| `body` **or** `file` | yes | exactly one of the two |

### `delayMs`

When greater than zero it **wins over the server's global delay**; at zero or absent, the global
delay (if any) applies.

### `body`

- **JSON body** (object, array, number, boolean) — served as JSON. If it is an array, or an object
  with a single top-level array, the response takes part in automatic pagination and query
  filtering (see [lists.md](lists.md)).
- **String body** — served **verbatim, with no implicit content-type**: declare it yourself in
  `headers`. This is the route for XML, CSV, HTML or any textual non-JSON payload.

```json
{
  "type": "mock",
  "status": 200,
  "headers": { "content-type": "application/xml" },
  "body": "<?xml version=\"1.0\"?><user><id>1</id></user>"
}
```

### `file`

The path of a file inside the `<METHOD>.responses/` folder — a subfolder is allowed, e.g.
`assets/img.png` — served **streamed on every request**: the content is never loaded into memory,
so payloads of hundreds of megabytes (downloads, images, PDFs) do not weigh on the server.

```json
{
  "type": "mock",
  "title": "Invoice PDF",
  "status": 200,
  "headers": { "content-type": "application/pdf" },
  "file": "assets/invoice.pdf"
}
```

Without a declared `content-type` the response goes out as `application/octet-stream`. The file
must exist on disk at load time, and must stay inside the responses folder. `templated` is
rejected on file payloads.

## No-body responses

A `204` still needs a `body` or `file` — the loader requires exactly one of them. Use
`"body": ""` with the status you want when the client must see an empty payload.

## Validation and error handling

The **selected** variant is validated when the endpoint loads: recognized `type`, valid status,
`body`/`file` mutually exclusive with one of them present, `file` payload existing on disk. An
error here does not take the server down: the endpoint is skipped with a warning, and on hot
reload the last valid version stays in force.

Variants that are **not selected** are not validated until they become active: an incomplete
variant file can live in the workspace with no effect until someone selects it. The exception is a
variant referenced by the **selected sequence response**: those are all loaded and validated
eagerly.
