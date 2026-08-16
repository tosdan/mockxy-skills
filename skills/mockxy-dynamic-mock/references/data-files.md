# Data files and `data()`

Data files are reusable JSON datasets stored in the workspace's `files/` folder and read at runtime
by handlers and middleware through the **`data(name)`** accessor. They separate *data* from
*logic*: the script stays short and readable, the dataset is edited without touching code, and it
travels in git together with the mocks.

## The on-disk contract

- The folder is **flat**: no subfolders. Together with the constraint on names this makes path
  traversal impossible by construction.
- Allowed names are made of **lowercase letters, digits, `.`, `_`, `-`**, with the `.json`
  extension. The name without the extension is the identifier passed to `data()`.
- The canonical form is **lowercase**: a workspace cannot hold both `Users.json` and `users.json`,
  which would be the same file on Windows/macOS and two different ones on Linux.
- The content must be valid JSON.

```
files/
├── users.json
├── orders.json
└── product-catalog.json
```

## `data()` at runtime

`await data("users")` returns the parsed content of `users.json`. The properties to know:

- **lazy reading**: a file that is never referenced is never opened;
- **re-read on every call**: no cache — a change to the file is visible from the next request on,
  with no restart;
- **a copy per call**: every handler receives its own instance; mutating it does not pollute other
  requests or later ones;
- **explicit errors**: an invalid name, a non-existent file, malformed JSON or an unconfigured
  folder raise exceptions with meaningful messages, which become the script's standard failure —
  the handler's `500` with the detail in the log, or the middleware's fail-open.

`data()` also accepts names with uppercase letters or a stray extension (`data("Users.json")`) and
normalizes them to the canonical form. Write the canonical form anyway: it is what the workspace
holds.

## Referencing them so the UI can find them

The Data page lists, for every file, the endpoints referencing it, by scanning handler and
middleware sources for `data("name")` calls written as **string literals**. A reference built at
runtime — from a variable, by concatenation — is not detectable, and the file will look unused.

```js
const users = await data("users");           // detected
const users = await data(datasetName);       // not detected
```

Prefer the literal form unless the dynamic one is genuinely needed.

## Sizes

Every `data()` call re-reads and re-parses the file from disk: up to a megabyte it is unnoticeable,
but a file of several megabytes on a busy endpoint is paid on every request. The UI flags files
over **5 MB**; the upload limit is **25 MB** per file.

## Choosing between a data file and an inline array

Use a **data file** when the dataset is shared by several endpoints, when it is long enough to
drown the logic, or when the user will want to edit it without reading code. Keep it **inline**
when it is a handful of entries used by one handler only: a one-file mock is easier to read than
two.

## Using a data file as a shared-state seed

`data()` is always a fresh per-call copy. To make a POST affect a later GET, use the file only as
the initializer for a named [`sharedState`](shared-state.md) resource:

```js
const items = await sharedState.open("items", {
  seedKey: "items@v1",
  initialize: () => data("items"),
});
```

The first open after restart/reset reads `files/items.json` and stores a detached runtime copy.
Editing the file after that does **not** alter the live resource; reset it to use the new seed.
Runtime mutations likewise never write the file.
