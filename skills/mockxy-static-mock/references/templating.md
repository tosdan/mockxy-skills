# Templating

With `"templated": true` on a `mock` variant, `{{...}}` placeholders in the body (JSON or text)
and in the headers are replaced with values from the request. It covers the "give me back the id I
asked for" case without writing a handler.

```json
{
  "type": "mock",
  "status": 200,
  "templated": true,
  "headers": { "location": "/api/users/{{params.id}}" },
  "body": {
    "id": "{{params.id | number}}",
    "name": "User {{params.id}}",
    "role": "{{query.role}}",
    "requestedAt": "{{now}}"
  }
}
```

## Sources

| Placeholder | Value |
|---|---|
| `{{params.<name>}}` | path parameters of the route (`/users/:id` → `params.id`) |
| `{{query.<name>}}` | query parameters; the first value when repeated |
| `{{headers.<name>}}` | request headers, names lowercase |
| `{{body.<dotted.path>}}` | the request's JSON body, read only when actually referenced |

Nested paths work for `body` (`{{body.user.address.city}}`). A source without a path
(`{{params}}`) does not resolve.

## Generated helpers

| Placeholder | Value |
|---|---|
| `{{now}}` | current timestamp, ISO 8601 |
| `{{nowMs}}` | current timestamp, epoch milliseconds |
| `{{uuid}}` | a fresh UUID |
| `{{randomInt min max}}` | random integer in the inclusive range, e.g. `{{randomInt 1 100}}` |

## The type filter

When the **entire** string value is a single placeholder, a filter produces a typed JSON value
instead of a string:

| Written | Result |
|---|---|
| `"{{params.id \| number}}"` | the number without quotes (`null` if not numeric) |
| `"{{query.active \| boolean}}"` | `true` / `false` (`null` if neither) |
| `"{{body.address \| json}}"` | the referenced sub-tree as-is |

A filter inside a longer string has no effect: the result is always text there.

## Behavior and limits

- **Unresolved placeholder**: the response still goes out — empty string, or `null` when a filter
  was used — and the engine logs a warning naming the placeholder. A typo does not break the run.
- **Escape**: `\{{` produces a literal `{{`.
- The template is applied **before** automatic pagination and filters: a templated array body
  takes part in them exactly like a static one.
- **No conditionals, loops or expressions.** Templating substitutes values; it is not a language.
  When logic is needed, the right step up is a handler (`mockxy-dynamic-mock`).
- `templated` is **not allowed on `file` payloads**: those are streamed from disk untouched.
