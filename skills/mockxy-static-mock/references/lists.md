# Lists: automatic filters and pagination

When the body of a `mock` is a list, Mockxy gives it real-API behavior: requests can **filter** the
items with query parameters and **paginate** the result, with nothing declared in the mock. Define
the full dataset once and the combinations come for free — the alternative would be one mock per
combination of filters and pages.

The filter applies **before** the page.

## When they kick in

Automatically on **JSON bodies of type `mock`**, and explicitly on a handler result that opts in
with `applyListQuery: true`, when the body is:

- an **array** (`[ ... ]`), or
- an **object with exactly one top-level array property** — for example
  `{ "items": [...], "meta": {...} }`. The shape is preserved: the page or the filtered result
  replaces the array, the other properties pass through intact. With two or more array properties
  the automatism does not kick in, since there would be no criterion to choose.

Left out: textual bodies, `file` payloads, middleware responses, proxied responses and handlers
without opt-in. Handler opt-in requires `jsonBody`; a non-boolean `applyListQuery` or `true`
without `jsonBody` makes the handler result invalid. See `mockxy-dynamic-mock` for the handler
contract.

## Filters

Every query parameter **whose name matches a top-level key of at least one item** becomes an
equality filter; all other parameters are ignored, so an existing mock keeps answering requests
carrying extraneous parameters.

```
GET /users?role=admin             → only items with "role": "admin"
GET /users?role=admin&active=true → AND between different parameters
GET /users?role=admin&role=editor → OR between values of the same parameter
```

- The comparison happens on the **value converted to string**: `?id=3` finds both `"id": 3` and
  `"id": "3"`.
- By default it is **case-insensitive** on the value; it becomes exact with the "Case-insensitive
  filters" workspace setting off, or `CASE_INSENSITIVE_FILTERS=false` headless. The parameter
  *name* must always match the key exactly, case included.
- Only top-level keys with **scalar values** (strings, numbers, booleans) take part: `null`,
  objects and arrays never match, so a filter on a nested key cannot be expressed.
- With at least one filter active, items that are not objects are excluded from the result.
- `page` and `size` are **reserved** for pagination and never become filters.

## Pagination

It kicks in **only when `page` and `size` are both present and valid**: `page` an integer from `0`
up (zero-based), `size` an integer from `1` up. A single parameter, or invalid values, disable
pagination — the response comes back whole (possibly filtered), with no error.

```
GET /users?page=0&size=10            → first 10 items
GET /users?role=admin&page=1&size=5  → second page of admins only
```

A page beyond the end of the dataset returns an empty list with the status unchanged: what
frontend pagination components expect.

## `X-Total-Count`

When filtering or pagination is active, the response carries **`X-Total-Count`** with the number of
items **after the filter and before the page** — the value a frontend needs to compute the number
of pages. A mock declaring its own `x-total-count` loses to the computed value while the
automatisms are active; with no automatism active, the declared header passes through unchanged.

## Interaction with a query declared in the path

A mock whose `path` declares a query string demands **exact equality of the whole request query**,
and filter/pagination parameters are extra parameters — so those requests never reach that
variant. Automatic filters and pagination work on mocks **without** a query in the path, which
accept any query.

## Practical consequence when authoring

Prefer one mock holding the **complete dataset** over several mocks pre-filtered by hand. The
client gets `?role=admin`, `?page=1&size=20` and their combinations without another file.
