# Preparing a scenario explicitly

Use this when a test (or you, for the user) must put a **running** Mockxy instance into a known
state before exercising a feature: the right variants served, the endpoints enabled, a sequence
restarted. The setup starts from **whatever state the previous session left** and never restores
it afterwards — there is no "undo" in Mockxy, and none is needed.

It is a composition of ordinary admin API calls ([admin-api.md](admin-api.md)), not a scenario
API. Work on a test workspace or a dedicated test engine, never on the user's development
workspace unless they asked for it.

## The steps

1. **Check the instance before changing anything.**
   - `GET /_admin/api/info`: the `workspace` must be the one the test expects (compare the
     canonical `mocksDir`). Keep `runtimeId`: if it changes later, the engine restarted.
   - `GET /_admin/api/openapi.yaml`: the admin API evolves with the app and a minor release may
     change its contract, so check that the routes you are about to use are declared.
   - `GET /_admin/api/config`: the settings the test depends on (backend, proxy fallback,
     delays), read in `effective`. Overrides left by an earlier session last until the engine
     restarts, so never assume the startup values. Newer engines let you set them in step 3;
     older ones need the test environment to prepare them.
   - If `/info` or the spec is missing (engines up to Mockxy 1.3.2), or anything does not match,
     **stop before any change** and say which update or configuration is needed. Never discover
     a capability by trying a write.
2. **Prepare the content.** Resolve every endpoint from `GET /mocks` by exact method and path,
   and every variant by file name — never by title, never from the current selection. For each
   variant: `GET /mocks/:id/responses/:file`, then `PUT` the content with the `revision` you read
   as `expectedRevision`. **State every field the test depends on**: an update keeps the fields it
   omits, so a `delayMs` or `templated` left by an earlier run would survive. Create missing
   variants with `select: false`. Check `active` first: a
   variant that is not selected may be a step of the selected sequence, and rewriting it changes
   the running scenario — fine when the setup reactivates and resets it anyway, otherwise prepare
   a separate variant. If a create's outcome is uncertain (timeout, dropped connection), read the
   catalog again before retrying.
3. **Activate**, only after preparing succeeded: the runtime settings the test depends on with
   `PATCH /config` and `set` (newer engines, see
   [Runtime configuration](admin-api.md#runtime-configuration)), `PATCH /server` with
   `{ "serverEnabled": true, "proxyAll": false }` when the test needs the mocks, select the
   intended variants (`PUT /mocks/:id` with `selectedResponseFile`), enable the endpoints
   (`PATCH /mocks/enabled`).
4. **Reset.** For a sequence: select it and call `POST /mocks/:id/sequence/reset` with `{}` **even
   if it was already selected** — it may be half consumed. For shared state, reset only the
   resources the test uses. Admin reads do not consume sequence steps; a request to the mocked
   route does.
5. **No sleeps.** A `2xx` mutation is already served (see
   [Outcome of a mutation](admin-api.md#outcome-of-a-mutation)); on a failure branch on
   `details.code`. A `409 REVISION_CONFLICT` means someone else changed the variant: read it
   again and decide, never overwrite blindly.
6. **Check the traffic.** Take a monitor cursor with `since=latest` (with the filters you will use)
   **before** the browser action, then read the entries after it
   ([Reading the monitor](admin-api.md#reading-the-monitor)). With `gap: true` the check cannot
   conclude. Filter on method and path instead of expecting only your requests: favicons and
   other side traffic are normal.

## Limits

- Changes made by an editor, the watcher or another process do not go through the admin API's
  mutation queue: the one-at-a-time guarantee and the revision checks cover API calls only.
- Sequence cursors, handler memory, shared state, the monitor and runtime overrides live in
  memory and start over when the engine restarts. The sequence reset also clears that endpoint's handler memory but
  needs a selected sequence; the memory of an ordinary handler has no reset. A test that needs it
  clean runs on a fresh engine.

## Playwright example

A self-contained sketch. `MOCKXY` is the engine the app under test talks to; the endpoint
`GET /api/orders` has a variant `001.response.json` the test turns into its expected answer.

```js
// tests/orders.spec.js
const fs = require("fs");
const { test, expect } = require("@playwright/test");

const MOCKXY = "http://localhost:3000";
const EXPECTED_MOCKS_DIR = fs.realpathSync("test-workspace/mocks");

async function admin(method, path, body) {
  const res = await fetch(`${MOCKXY}/_admin/api${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`${method} ${path}: ${res.status} ${data?.details?.code ?? ""} ${data?.message ?? ""}`);
  }
  return data;
}

async function setUpOrders() {
  // 1. The instance and its contract, before any change.
  const info = await admin("GET", "/info");
  if (info.workspace.mocksDir !== EXPECTED_MOCKS_DIR) {
    throw new Error(`Wrong workspace: ${info.workspace.mocksDir}`);
  }
  const spec = await (await fetch(`${MOCKXY}/_admin/api/openapi.yaml`)).text();
  for (const route of ["/mocks/{id}/responses/{responseFileName}:", "/monitoring/requests/{id}:"]) {
    if (!spec.includes(route)) throw new Error(`Update Mockxy: ${route} is not available`);
  }
  if (!spec.includes("operationId: patchRuntimeConfig")) {
    throw new Error("Update Mockxy: PATCH /config is not available");
  }

  // 2. Resolve by method and path; prepare with the revision just read.
  const { items } = await admin("GET", "/mocks");
  const orders = items.find((item) => item.method === "GET" && item.path === "/api/orders");
  if (!orders) throw new Error("GET /api/orders is missing from the catalog");
  const variant = await admin("GET", `/mocks/${orders.id}/responses/001.response.json`);
  await admin("PUT", `/mocks/${orders.id}/responses/001.response.json`, {
    type: "mock",
    status: 200,
    headers: { "content-type": "application/json" },
    delayMs: 0, // an update keeps omitted fields: a delay left by an earlier run would survive
    templated: false,
    body: { orders: [{ id: "o-1" }] },
    expectedRevision: variant.revision,
  });

  // 3. Activate. Overrides left by an earlier run last until a restart: state the settings too.
  await admin("PATCH", "/config", { set: { proxyFallbackEnabled: false, globalDelayMs: 0 } });
  await admin("PATCH", "/server", { serverEnabled: true, proxyAll: false });
  await admin("PUT", `/mocks/${orders.id}`, { selectedResponseFile: "001.response.json" });
  await admin("PATCH", "/mocks/enabled", { ids: [orders.id], enabled: true });
  // 4. A sequence would be selected here and reset with POST /mocks/:id/sequence/reset and {}.
}

test("the orders page shows the prepared order", async ({ page }) => {
  await setUpOrders();
  const filters = "method=GET&path=/api/orders";
  const { cursor } = await admin("GET", `/monitoring/requests?view=page&since=latest&${filters}`);

  await page.goto("http://localhost:4200/orders"); // the app under test, pointed at Mockxy
  await expect(page.getByText("o-1")).toBeVisible();

  const after = await admin(
    "GET",
    `/monitoring/requests?view=page&${filters}&since=${cursor.since}&runtimeId=${cursor.runtimeId}&generation=${cursor.generation}`,
  );
  expect(after.gap).toBe(false);
  expect(after.items.map((item) => item.status)).toContain(200);
});
```

Run it as often as you like, in any order with other tests: it never depends on what the previous
run left, and it restores nothing. When a check reads the monitor right after the page settles,
poll with an explicit deadline rather than a fixed sleep.
