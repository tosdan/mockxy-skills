# Shared runtime state

Use shared runtime state when two or more **handler** endpoints must observe the same evolving
JSON. The canonical case is a frontend calling `POST /items` and then seeing the created item in
`GET /items`, before the real backend exists.

This API is handler-only. Middleware does not receive `sharedState` because middleware is
fail-open around an already-received backend response and needs different effect semantics.

## Open a resource

Repeat a small opener in every participating handler:

```js
function openItems({ sharedState, data }) {
  return sharedState.open("items", {
    seedKey: "items@v1",
    initialize: () => data("items"),
  });
}
```

Always use `await` inside the handler's `try/catch` when errors need translation:

```js
const items = await openItems(context);
```

`open()` validates everything already knowable synchronously, invokes a winning initializer in
the same stack, and returns a Promise carrying initialization/waiting failures. Multiple
concurrent opens of a missing name share one initializer; only the first factory is used.

### Names and `seedKey`

- The name is trimmed and lowercased, has 1–128 characters, accepts only `a-z`, `0-9`, `.`, `_`,
  `-`, and cannot be `.` or `..`.
- `seedKey` is required, case-sensitive, 1–256 characters, with no surrounding whitespace or
  control characters. It is metadata, not a secret.
- The name identifies the resource. `seedKey` declares its expected **logical shape and
  initialization strategy**. All handlers opening one name must use the same key.
- Bump `items@v1` to `items@v2` when the shape changes, stop traffic, reset the resource, then
  exercise the new handlers. A live resource opened with another key fails explicitly instead of
  silently giving new code old-shaped data.
- `seedKey` is an author declaration, not a factory hash or schema validator. Keep the initializer
  deterministic for that key: use a literal `data("items")` call or a constant, never request
  body/query/headers, time or randomness unless first-request-wins behavior is deliberate.

## Read and write

```js
const snapshot = items.read();

const created = items.mutate((draft) => {
  if (!Array.isArray(draft)) throw new Error("items must be an array");
  const item = { ...context.jsonBody };
  draft.push(item);
  return item;
});

items.replace([]);
```

- `read()` returns a detached JSON snapshot. Mutating it cannot change the store.
- `mutate(callback)` parses a private draft, runs the callback synchronously, validates and
  commits atomically. A throw, async/thenable result, invalid JSON or quota failure commits
  nothing. The callback's return value is returned to the handler but never replaces the root.
- `replace(value)` atomically replaces the root and returns `undefined`.
- Initializers and mutators must not call `open`, `read`, `mutate` or `replace` on any shared
  resource. This prevents dependency cycles, hidden cross-resource ordering and partial commits.

For a GET list, opt in to the same filtering/pagination behavior as a static mock:

```js
return {
  status: 200,
  jsonBody: items.read(),
  applyListQuery: true,
};
```

## JSON and quotas

The stored value is strict, detached JSON. Cycles, `undefined`, functions, symbols, `BigInt`,
non-finite numbers, class instances, accessors, non-enumerable properties, sparse/extended arrays,
Proxy objects and depth over 100 are rejected. `-0` is canonicalized to its JSON-equivalent `0`.

Default limits are 256 resources, 3 MiB per resource and 25 MiB in total. JSON parsing,
validation and serialization are O(n), so this is scenario state, not an embedded database.

## Lifetime and reset

- The resource is global to one Mockxy process: different browsers and tests share it.
- It survives handler hot reload, but restart, crash and workspace/runtime replacement lose it.
- Editing or deleting a seed file does not affect an already-open resource. After reset, the next
  open reads the current file and can fail if it no longer exists.
- Return, throw, timeout or client disconnect closes that handler invocation's facade; delayed
  work cannot mutate shared state afterward.
- Reset invalidates open handles and initialization of the old generation. It does not pause
  traffic, so stop clients/polling first when test setup must be deterministic.
- Shared reset does not alter sequence cursors or endpoint-local `state`, `callCount` and
  `firstRequestAt`; sequence reset does not alter shared state.

Use **Data → Runtime state** in the UI, or the Admin API:

```sh
curl -s http://localhost:3000/_admin/api/runtime/shared-state
curl -s -X POST http://localhost:3000/_admin/api/runtime/shared-state/items/reset \
  -H 'content-type: application/json' -d '{}'
curl -s -X POST http://localhost:3000/_admin/api/runtime/shared-state/reset \
  -H 'content-type: application/json' -d '{}'
```

The listing exposes metadata and limits, never live values.

## Errors and diagnostics

Catch only errors you can translate into a deliberate domain response, and rethrow everything
else:

```js
try {
  items.replace(nextItems);
} catch (error) {
  if (error.code === "SHARED_STATE_ENTRY_TOO_LARGE") {
    return { status: 422, jsonBody: { error: "scenario_capacity_exceeded" } };
  }
  throw error;
}
```

Unhandled generation conflicts return sanitized `409`, shutdown returns `503`, and other
shared-state errors return sanitized `500`. Public bodies never include names, keys, values,
sizes, causes or stacks. Full metadata is in the server log and, when available, the Monitor
entry, whose **Open shared state** action links to the runtime row. Do not add generic retries:
the handler may already have produced effects and only the scenario author knows its idempotency.

## Copying endpoints

Copy preserves handler source, so a copied endpoint deliberately keeps sharing every literal
`sharedState.open("name", ...)` resource. The copy dialog performs a dry run and warns with the
detected names. Detection is best-effort: dynamic names or helpers can be missed, and comments or
strings can produce conservative warnings. To make the copy independent, change both the name and
`seedKey` in its source after copying.
