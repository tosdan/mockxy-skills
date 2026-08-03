# The path convention

How Mockxy decides, request by request, **which endpoint answers**: the format of the paths
declared in endpoint files, the precedence rules when several routes could match, and the role of
the HTTP method.

## The choice happens in two steps

1. **The path first**: among the registered routes, the most specific one whose pattern matches
   the request path and query wins.
2. **Then the method**: within the chosen route, the request's HTTP method is looked up.

The consequence is that **the path choice is final**: if the chosen route does not define the
requested method, the request goes to the fallback (proxy to the backend, or `404` in mock-only
mode) — a less specific route that might have had that method is *not* searched. With
`/api/users/:id` defining only `GET`, a `POST /api/users/42` ends at the fallback even if a more
generic route with that `POST` existed.

The outcome is observable: the `x-mock-source` response header says who answered, and the body of
the mock-only `404` reports the reason — `method_not_mocked` (route found, method missing) or
`path_not_mocked` (no route matches).

## The path format

`path` declares an **absolute** path (it starts with `/`), with optional **named parameters** and
an optional **required query string**:

```
/api/users                  exact path
/api/users/:id              named parameter
/api/users/:id/orders/:num  multiple parameters
/api/users?active=true      exact path + required query
```

- **`:name`** captures one path segment; the value reaches handlers already percent-decoded.
  A parameter covers *one* segment: `/api/:id` matches `/api/42` but not `/api/42/extra`.
- The pattern covers **the whole path**, never a prefix: `/api/users` does not match
  `/api/users/extra`.
- The **`^` character is forbidden**: it is reserved for encoding the query part in derived folder
  names on disk.
- A **bare `*` is not supported** and is rejected on load: the endpoint is discarded with a
  warning.
- `{id}` is **not** path syntax. It is the folder-name convention only, because `:` is illegal in
  Windows folder names. An OpenAPI-style `/api/users/{id}` in `path` will not match what you
  expect — write `/api/users/:id`.

## The declared query

If `path` includes a query string, that query becomes a **requirement of exact equality on the
request's entire query**:

- parameter order does not matter: `?a=1&b=2` and `?b=2&a=1` are equivalent;
- names and values are compared **case-sensitively** (`?active=true` ≠ `?ACTIVE=true`);
- **no extra and no missing parameters**: `/api/users?active=true` does *not* match
  `?active=true&page=0` — the request with the extra parameter slides to the query-less twin (if
  one exists) or to the fallback.

The last point is the trickiest in combination with automatic pagination: a variant with a
declared query will never receive paginated requests, because `page` and `size` are extra
parameters. A declared query distinguishes *specific cases*, it does not constrain families of
requests.

For the same path, the route **with** a declared query is more specific than its twin without: it
is tried first, and the twin (which accepts any query) catches everything else.

## Specificity

When several routes could match, the trial order is:

1. **exact paths** (no parameters) before those **with parameters**;
2. among parameterized paths, the one with **more static segments** wins
   (`/api/users/:id` beats `/api/:resource/:id`);
3. for the same path, the variant **with a declared query** before its twin without;
4. remaining ties are resolved deterministically (stable file order), so behavior does not change
   between restarts.

## One path, multiple methods

All the endpoint files declaring the same `path` — even from different folders — flow into the
**same route**, each with its own method: that is how the `GET` and the `DELETE` of
`/api/users/:id` coexist. Two files declaring the same method+path pair are instead a conflict:
the first wins, the second is reported and ignored.
