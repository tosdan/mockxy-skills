# Collections: `mocks/.collections.json`

Collections group endpoints in the Mockxy UI catalog. They are **UI metadata**: they touch neither
the served paths nor the position of the folders on disk. Endpoints with no membership live in the
virtual *Unsorted* collection.

The file lives at the root of the mocks folder and is shared in git like the rest. It is
**optional**: a workspace without it is perfectly valid, and the engine ignores the file
completely. Write it only when the user asks for grouping.

## Shape

```json
{
  "collections": [
    { "id": "collection-core", "label": "Core API" },
    { "id": "collection-admin", "label": "Admin", "parentId": "collection-core" },
    { "id": "collection-dynamic", "label": "Dynamic" }
  ],
  "memberships": {
    "api/users/GET.endpoint.json": "collection-core",
    "api/users/{id}/GET.endpoint.json": "collection-core",
    "api/admin/config/GET.endpoint.json": "collection-admin",
    "api/echo/POST.endpoint.json": "collection-dynamic"
  },
  "childOrder": {
    "root": ["collection-core", "collection-dynamic"],
    "collection-core": ["api/users/GET.endpoint.json", "api/users/{id}/GET.endpoint.json", "collection-admin"],
    "collection-admin": ["api/admin/config/GET.endpoint.json"],
    "collection-dynamic": ["api/echo/POST.endpoint.json"],
    "unsorted": ["api/health/GET.endpoint.json"]
  }
}
```

- **`collections`** — the flat list. Each entry needs a non-empty unique `id` and a non-empty
  `label`; `parentId` nests it under another collection. A `parentId` pointing at an unknown
  collection, or forming a cycle, is dropped on read (the collection becomes a root).
- **`memberships`** — endpoint file → collection id. Keys are paths **relative to the mocks
  folder**, always with forward slashes, including the `{param}` folder segments verbatim. An
  entry whose collection id is unknown is dropped and the endpoint stays unsorted.
- **`childOrder`** — display order. Keys are `"root"`, `"unsorted"` or a collection id; values mix
  endpoint keys and sub-collection ids. Entries the reader cannot resolve are ignored, and
  anything missing is appended in a deterministic order — an incomplete `childOrder` degrades
  gracefully.

The UI derives collection ids from the label (`Core API` → `collection-core-api`), but any unique
string works.

## Writing it safely

- Add the endpoint files first, then the memberships: a membership key that matches no file is
  dead weight.
- When you move or rename an endpoint folder, update its membership and `childOrder` keys too.
- Do not invent memberships the user did not ask for. Leaving endpoints unsorted is normal.
- If the workspace already has a `.collections.json`, read it and merge; never overwrite it with a
  freshly generated one, or you will discard the user's manual ordering.

## Semantics worth knowing

Three UI actions have consequences visible on disk:

- **Dissolve collection** removes the grouping without deleting mocks: the subtree disappears and
  its endpoints go back to Unsorted.
- **Erase collection** permanently erases the whole subtree, its endpoints and all their variants.
- **The collection-level enable switch is a bulk action**: it writes the same `enabled` value into
  *every* endpoint file of the subtree. Re-enabling the collection re-enables everything,
  including endpoints that had been individually disabled.
