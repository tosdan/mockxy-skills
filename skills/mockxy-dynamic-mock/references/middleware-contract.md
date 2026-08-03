# The middleware contract

Middleware is the third way to respond, halfway between the mock and the real backend: the request
**really reaches the backend** through the proxy, but the response goes through a local script
that can modify it before it reaches the client. It is for when the backend exists and should be
used, but its response needs touching up: masking sensitive data, forcing a field to trigger a
specific frontend case, enriching a payload that is not complete yet.

A middleware is attached to the endpoint through a response file of type `middleware` pointing at
a `*.middleware.js` script. Everything that holds for handler scripts holds here too: CommonJS
module, relative `require` with recompilation on change, no `method` / `path` / `disabled` in the
script.

**It only works with a backend configured** (`BACKEND_URL`, or the workspace's backend setting):
with no backend there is nothing to transform.

## The shape of the script

```js
module.exports = {
  async transformResponse({ status, headers, jsonBody }) {
    return {
      status,
      headers: { ...headers, "x-environment": "mockxy" },
      jsonBody: { ...jsonBody, availableBalance: 0 },
    };
  },
};
```

When the middleware variant is selected, the engine forwards the request to the backend (asking
for the response **uncompressed**, so it is inspectable), buffers it in full and calls
**`transformResponse`**.

## The context it receives

- **`status`** — the status of the backend response.
- **`headers`** — a copy of the backend response headers.
- **the backend body, in three forms** — `bodyBuffer` (raw, always present), `bodyText` (for
  textual content-types) and `jsonBody` (parsed when possible), with the same semantics as the
  handler context. If the backend answered compressed anyway, the body is decompressed for
  inspection (gzip, deflate, brotli) with a safety cap of 50 MB decompressed: beyond that, or with
  an unsupported compression, `bodyText` and `jsonBody` are absent and `bodyBuffer` stays
  compressed.
- **`req`** — the incoming Express request.
- **`targetUrl`** — the full URL the request was forwarded to.
- **`data(name)`** — the data files accessor, identical to the handlers' one.

## The result

- **`undefined`** (or no `return`) — the backend response passes through **untouched**: useful for
  conditional middleware that only transforms certain cases.
- An **object** with:
  - **`status`** — optional; default: the backend's status.
  - **`headers`** — optional; unlike handlers, these headers **merge on top of the backend's**
    (the response starts from what the backend sent): declared keys override, keys with an
    `undefined` value are ignored, the rest passes through.
  - **`removeHeaders`** — a list of names (case-insensitive) removed from the merged result: the
    way to **remove** a header set by the backend.
  - **`jsonBody`** *or* **`body`** (string or `Buffer`) — same rules as handlers, including the
    forced `content-type: application/json` for `jsonBody` and the dropping of body-dependent
    headers (`Content-Length`, `Content-Encoding`, `Transfer-Encoding`, `ETag`).
  - **neither `body` nor `jsonBody`** — the backend body stays as it was; only status and headers
    change. The "touch up the headers without touching the payload" case.

Transformed responses go out with `x-mock-source: middleware`.

## When the middleware is bypassed

The transformation requires buffering the response in RAM, so the engine skips it — with a warning
in the log and intact passthrough forwarding — when it is not feasible or would not make sense:

- **declared streams** (`text/event-stream`, typical of SSE): they never end, and buffering them
  would leave the request hanging;
- **responses over 10 MB** — both when the backend declares it upfront (`Content-Length`) and when
  the limit is exceeded while reading: the prefix already read is forwarded and the rest continues
  streaming.

In these cases the response reaches the client **intact but untransformed**, marked
`x-mock-source: backend`.

## Errors and timeouts: fail-open

A middleware that fails **does not break the response**: if the script throws, returns an invalid
result or exceeds the timeout (`requestTimeoutMs`, the same as the proxy's), the engine forwards
the **original backend response** and records the error in the log with a reference to the script.
A broken touch-up must not deny the frontend a response the backend already produced.

`502` stays reserved for genuine communication problems with the backend.

Middleware works on proxied requests, so a global delay extended to the proxy applies to it too.

## Limits worth knowing before choosing middleware

- A middleware variant **cannot be a step of a variant sequence**.
- It needs a reachable backend; in mock-only mode it has nothing to transform.
- If the goal is a fully synthetic response, a handler is simpler and does not depend on the
  backend being up.
