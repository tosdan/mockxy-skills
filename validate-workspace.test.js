"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { validateWorkspace, validateWorkspaceWithEngine } = require(
  "./skills/mockxy-workspace/scripts/validate-workspace.js"
);

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createWorkspace(overrides = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mockxy-skills-sequence-"));
  const endpointDir = path.join(workspace, "mocks", "jobs", "{id}");
  const responseDir = path.join(endpointDir, "GET.responses");
  const responseFiles = [
    "001.response.json",
    "002.response.json",
    "003.response.json",
    ...(overrides.additionalResponseFiles || []),
  ];

  writeJson(path.join(workspace, "mockxy.json"), { formatVersion: 1 });
  writeJson(path.join(endpointDir, "GET.endpoint.json"), {
    method: "GET",
    path: "/api/jobs/:id",
    enabled: true,
    responseFiles,
    selectedResponseFile: "003.response.json",
    ...overrides.endpoint,
  });
  writeJson(path.join(responseDir, "001.response.json"), {
    type: "mock",
    status: 202,
    body: { status: "processing" },
  });
  writeJson(path.join(responseDir, "002.response.json"), overrides.secondResponse || {
    type: "mock",
    status: 200,
    body: { status: "completed" },
  });
  writeJson(path.join(responseDir, "003.response.json"), {
    type: "sequence",
    title: "Processing then completed",
    steps: [
      { response: "001.response.json", times: 2 },
      { response: "002.response.json" },
    ],
    onEnd: "stay",
    ...overrides.sequence,
  });
  for (const [fileName, response] of Object.entries(overrides.additionalResponses || {})) {
    writeJson(path.join(responseDir, fileName), response);
  }

  return workspace;
}

function validate(workspace) {
  const result = validateWorkspace(workspace, { loadScripts: false });
  return { status: result.exitCode, report: result.report };
}

function messages(report) {
  return report.findings.map((finding) => finding.message);
}

test("accepts a selected sequence response and its mock steps", (t) => {
  const workspace = createWorkspace();
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  const result = validate(workspace);

  assert.equal(result.status, 0);
  assert.equal(result.report.errors, 0);
});

test("rejects the legacy endpoint.sequence field", (t) => {
  const workspace = createWorkspace({
    endpoint: {
      selectedResponseFile: "001.response.json",
      sequence: {
        enabled: true,
        steps: [
          { response: "001.response.json", times: 1 },
          { response: "002.response.json" },
        ],
      },
    },
  });
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  const result = validate(workspace);

  assert.equal(result.status, 1);
  assert(messages(result.report).includes(
    "endpoint.sequence is no longer supported; migrate it to a response with type sequence"
  ));
});

test("rejects enabled on a sequence response", (t) => {
  const workspace = createWorkspace({ sequence: { enabled: false } });
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  const result = validate(workspace);

  assert.equal(result.status, 1);
  assert(messages(result.report).includes(
    "sequence.enabled is not supported; select the sequence response to activate it"
  ));
});

test("an ordinary selection leaves a broken sequence target non-critical", (t) => {
  const workspace = createWorkspace({
    endpoint: { selectedResponseFile: "001.response.json" },
    secondResponse: { type: "unknown" },
  });
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  const result = validate(workspace);
  const invalidTypeFinding = result.report.findings.find(
    (finding) => finding.message === "type must be mock, handler, middleware, sse, ws or sequence"
  );

  assert.equal(result.status, 0);
  assert.equal(result.report.errors, 0);
  assert.equal(invalidTypeFinding.level, "warning");
});

test("rejects a nested sequence in the selected sequence graph", (t) => {
  const workspace = createWorkspace({
    additionalResponseFiles: ["004.response.json"],
    secondResponse: {
      type: "sequence",
      steps: [
        { response: "001.response.json", times: 1 },
        { response: "004.response.json" },
      ],
    },
    additionalResponses: {
      "004.response.json": { type: "mock", status: 200, body: { status: "fallback" } },
    },
  });
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  const result = validate(workspace);

  assert.equal(result.status, 1);
  assert(messages(result.report).includes(
    "sequence steps must reference mock or handler variants (002.response.json is a sequence)"
  ));
});

test("reports an invalid selected target type without a redundant allowlist error", (t) => {
  const workspace = createWorkspace({ secondResponse: { type: "unknown" } });
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  const result = validate(workspace);

  assert.equal(result.status, 1);
  assert(messages(result.report).includes(
    "type must be mock, handler, middleware, sse, ws or sequence"
  ));
  assert(!messages(result.report).some((message) => message.includes("is a null")));
});

const STANDARD_PACKAGE = { private: true, type: "commonjs", imports: { "#shared/*": "./_shared/*" } };

// A workspace whose handlers import the same shared helper, each with its own specifier.
// `packageJson: null` leaves mocks/package.json out.
function createScriptWorkspace(handlers, { packageJson = STANDARD_PACKAGE } = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mockxy-skills-scripts-"));
  const mocksDir = path.join(workspace, "mocks");
  writeJson(path.join(workspace, "mockxy.json"), { formatVersion: 1 });
  if (packageJson != null) {
    writeJson(path.join(mocksDir, "package.json"), packageJson);
  }
  fs.mkdirSync(path.join(mocksDir, "_shared"), { recursive: true });
  fs.writeFileSync(path.join(mocksDir, "_shared", "data.js"), "module.exports = { value: 1 };\n");
  fs.writeFileSync(
    path.join(mocksDir, "_shared", "flow.js"),
    "const data = require(\"#shared/data.js\");\nmodule.exports = { read: () => data.value };\n"
  );
  for (const { folder, routePath, specifier, source } of handlers) {
    const endpointDir = path.join(mocksDir, ...folder.split("/"));
    writeJson(path.join(endpointDir, "GET.endpoint.json"), {
      method: "GET",
      path: routePath,
      enabled: true,
      responseFiles: ["001.response.json"],
      selectedResponseFile: "001.response.json",
    });
    writeJson(path.join(endpointDir, "GET.responses", "001.response.json"), {
      type: "handler",
      sourceFile: "001.handler.js",
    });
    fs.writeFileSync(
      path.join(endpointDir, "GET.responses", "001.handler.js"),
      source
        || `const flow = require(${JSON.stringify(specifier)});\n` +
          "module.exports = { async resolveResponse() { return { jsonBody: { value: flow.read() } }; } };\n"
    );
  }
  return workspace;
}

function removeAfter(t, workspace) {
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
}

test("loads handlers importing a shared helper through the #shared alias at any depth", (t) => {
  const workspace = createScriptWorkspace([
    { folder: "a", routePath: "/a", specifier: "#shared/flow.js" },
    { folder: "a/b/c", routePath: "/a/b/c", specifier: "#shared/flow.js" },
    { folder: "rel", routePath: "/rel", specifier: "../../_shared/flow.js" },
  ]);
  removeAfter(t, workspace);

  const result = validateWorkspace(workspace);

  assert.equal(result.exitCode, 0, messages(result.report).join("\n"));
  assert.equal(result.report.warnings, 0, messages(result.report).join("\n"));
  assert.equal(result.report.scriptsLoaded, true);
  assert.equal(result.report.scripts, 3);
});

test("reports a relative require that does not resolve at the handler's depth", (t) => {
  const workspace = createScriptWorkspace([
    { folder: "a/b/c", routePath: "/a/b/c", specifier: "../../_shared/flow.js" },
  ]);
  removeAfter(t, workspace);

  const result = validateWorkspace(workspace);

  assert.equal(result.exitCode, 1);
  assert(messages(result.report).some(
    (message) => message.startsWith("001.handler.js could not be loaded: Cannot find module '../../_shared/flow.js'")
  ));
});

test("explains an alias import when mocks/package.json is missing, without creating the file", (t) => {
  const workspace = createScriptWorkspace(
    [{ folder: "a", routePath: "/a", specifier: "#shared/flow.js" }],
    { packageJson: null }
  );
  removeAfter(t, workspace);

  const result = validateWorkspace(workspace);

  assert.equal(result.exitCode, 1);
  assert(messages(result.report).some((message) =>
    message.startsWith("001.handler.js could not be loaded: package.json is missing from the mocks folder")
  ));
  assert(result.report.findings.some((finding) =>
    finding.level === "warning" && finding.file === "mocks/package.json" && finding.message.startsWith("package.json is missing")
  ));
  assert.equal(fs.existsSync(path.join(workspace, "mocks", "package.json")), false);
});

test("a missing mocks/package.json is only a warning for scripts that do not use the alias", (t) => {
  const workspace = createScriptWorkspace(
    [{ folder: "rel", routePath: "/rel", source: "module.exports = { resolveResponse() { return {}; } };\n" }],
    { packageJson: null }
  );
  removeAfter(t, workspace);

  const result = validateWorkspace(workspace);

  assert.equal(result.exitCode, 0, messages(result.report).join("\n"));
  assert.equal(result.report.warnings, 1);
});

test("explains the withdrawn mocks-root import of Mockxy 1.5.0", (t) => {
  const workspace = createScriptWorkspace([{ folder: "a", routePath: "/a", specifier: "_shared/flow" }]);
  removeAfter(t, workspace);

  const result = validateWorkspace(workspace);

  assert.equal(result.exitCode, 1);
  assert(messages(result.report).some((message) =>
    message.includes('require("_shared/flow") is the mocks-root import of Mockxy 1.5.0, which was removed: write require("#shared/flow.js")')
  ), messages(result.report).join("\n"));
});

test("explains an alias import without the extension", (t) => {
  const workspace = createScriptWorkspace([{ folder: "a", routePath: "/a", specifier: "#shared/flow" }]);
  removeAfter(t, workspace);

  const result = validateWorkspace(workspace);

  assert.equal(result.exitCode, 1);
  assert(messages(result.report).some((message) =>
    message.includes("#shared/flow has no extension: aliases do not add one, write #shared/flow.js")
  ), messages(result.report).join("\n"));
});

test("rejects a mocks/package.json that does not define the standard alias", (t) => {
  const handlers = [{ folder: "rel", routePath: "/rel", source: "module.exports = { resolveResponse() { return {}; } };\n" }];
  const cases = [
    [{ private: true }, '"imports" must contain "#shared/*": "./_shared/*"'],
    [{ ...STANDARD_PACKAGE, type: "module" }, '"type" is "module": set it to "commonjs" or remove it'],
    [
      { ...STANDARD_PACKAGE, imports: { ...STANDARD_PACKAGE.imports, "#shared/flow.js": "./other.js" } },
      '"imports" redefines the reserved #shared namespace (#shared/flow.js): remove those keys',
    ],
  ];
  for (const [packageJson, expected] of cases) {
    const workspace = createScriptWorkspace(handlers, { packageJson });
    removeAfter(t, workspace);

    const result = validateWorkspace(workspace, { loadScripts: false });
    const finding = result.report.findings.find((item) => item.message === expected);

    assert.equal(finding?.level, "error", messages(result.report).join("\n"));
    assert.equal(finding.file, "mocks/package.json");
  }
});

test("an alias outside the contract is a warning, a nested package.json an error", (t) => {
  const workspace = createScriptWorkspace(
    [{ folder: "a", routePath: "/a", specifier: "#shared/flow.js" }],
    { packageJson: { ...STANDARD_PACKAGE, imports: { ...STANDARD_PACKAGE.imports, "#other/*": "./other/*" } } }
  );
  removeAfter(t, workspace);
  writeJson(path.join(workspace, "mocks", "a", "package.json"), { private: true });

  const result = validateWorkspace(workspace, { loadScripts: false });
  const byFile = (file) => result.report.findings.filter((finding) => finding.file === file);

  assert.deepEqual(byFile("mocks/package.json").map((finding) => finding.level), ["warning"]);
  assert.match(byFile("mocks/package.json")[0].message, /^aliases outside the script contract \(#other\/\*\)/);
  assert.deepEqual(byFile("mocks/a/package.json").map((finding) => finding.level), ["error"]);
});

// ---------------------------------------------------------------------------
// The script contract: checked by the engine, or declared as not checked
// ---------------------------------------------------------------------------

const LATE_REQUIRE_HANDLER =
  "module.exports = { resolveResponse() { return { jsonBody: require(\"#shared/data.js\") }; } };\n";

test("without an engine it declares that the script contract was not checked", (t) => {
  const workspace = createScriptWorkspace([{ folder: "late", routePath: "/late", source: LATE_REQUIRE_HANDLER }]);
  removeAfter(t, workspace);

  const result = validateWorkspace(workspace);

  // The late require loads and exports correctly: only the engine's parser can see it.
  assert.equal(result.exitCode, 0, messages(result.report).join("\n"));
  assert.equal(result.report.scriptContract.status, "not-checked");
  assert.match(result.report.scriptContract.reason, /--server-url .* --engine-dir/);
});

test("a workspace without scripts needs no contract check", (t) => {
  const workspace = createWorkspace();
  removeAfter(t, workspace);

  const result = validateWorkspace(workspace);

  assert.deepEqual(result.report.scriptContract, { status: "not-needed" });
  assert.equal(result.report.scripts, 0);
});

test("--no-scripts leaves the contract unchecked even when an engine is given", (t) => {
  const workspace = createScriptWorkspace([{ folder: "late", routePath: "/late", source: LATE_REQUIRE_HANDLER }]);
  removeAfter(t, workspace);

  const result = validateWorkspace(workspace, { loadScripts: false, engineDir: path.join(workspace, "no-engine") });

  assert.equal(result.report.scriptsLoaded, false);
  assert.equal(result.report.scriptContract.status, "not-checked");
  assert.match(result.report.scriptContract.reason, /^--no-scripts/);
});

function createFakeEngine(t, { version = "1.6.0", withCommand = true, script }) {
  const engineDir = fs.mkdtempSync(path.join(os.tmpdir(), "mockxy-skills-engine-"));
  removeAfter(t, engineDir);
  writeJson(path.join(engineDir, "package.json"), { name: "mockxy", version });
  fs.writeFileSync(path.join(engineDir, "index.js"), script);
  if (withCommand) {
    fs.mkdirSync(path.join(engineDir, "src"));
    fs.writeFileSync(path.join(engineDir, "src", "cli-validate.js"), "");
  }
  return engineDir;
}

const ENGINE_REPORT = {
  ok: false,
  scripts: 1,
  errors: [{
    code: "SCRIPT_LATE_REQUIRE",
    filePath: "late/GET.responses/001.handler.js",
    line: 1,
    column: 55,
    message: "require(\"#shared/data.js\") runs inside a function",
  }],
  warnings: [{ code: "SCRIPT_PACKAGE_EXTRA_ALIAS", filePath: "package.json", message: "package.json: extra alias." }],
};

test("--engine-dir takes the findings of the engine's validate command", (t) => {
  const workspace = createScriptWorkspace([{ folder: "late", routePath: "/late", source: LATE_REQUIRE_HANDLER }]);
  removeAfter(t, workspace);
  const marker = path.join(workspace, "loaded-here.txt");
  fs.appendFileSync(
    path.join(workspace, "mocks", "late", "GET.responses", "001.handler.js"),
    `require("fs").writeFileSync(${JSON.stringify(marker)}, "x");\n`
  );
  // Prints noise first, as the top level of a script could, then the report of the real command.
  const engineDir = createFakeEngine(t, {
    script:
      "const [command, mocksDir, flag] = process.argv.slice(2);\n" +
      "console.log('{');\nconsole.log('noise from a script');\n" +
      `const report = ${JSON.stringify(ENGINE_REPORT)};\n` +
      "console.log(JSON.stringify({ ...report, mocksDir, command, flag }, null, 2));\n" +
      "process.exitCode = 1;\n",
  });

  const result = validateWorkspace(workspace, { engineDir });

  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.report.scriptContract, {
    status: "checked",
    via: "engine-dir",
    source: engineDir,
    engineVersion: "1.6.0",
  });
  assert.deepEqual(result.report.findings, [
    {
      level: "error",
      file: "mocks/late/GET.responses/001.handler.js",
      code: "SCRIPT_LATE_REQUIRE",
      line: 1,
      column: 55,
      message: "require(\"#shared/data.js\") runs inside a function",
    },
    { level: "warning", file: "mocks/package.json", code: "SCRIPT_PACKAGE_EXTRA_ALIAS", message: "package.json: extra alias." },
  ]);
  // The engine loaded the scripts: this process must not run them a second time.
  assert.equal(fs.existsSync(marker), false);
  assert.equal(result.report.scriptsLoaded, true);
});

test("--engine-dir never runs an engine without the validate command", (t) => {
  const workspace = createScriptWorkspace([{ folder: "a", routePath: "/a", specifier: "#shared/flow.js" }]);
  removeAfter(t, workspace);
  const started = path.join(workspace, "server-started.txt");
  const engineDir = createFakeEngine(t, {
    version: "1.5.0",
    withCommand: false,
    script: `require("fs").writeFileSync(${JSON.stringify(started)}, "x");\n`,
  });

  const result = validateWorkspace(workspace, { engineDir });

  assert.equal(fs.existsSync(started), false);
  assert.equal(result.report.scriptContract.status, "not-checked");
  assert.match(result.report.scriptContract.reason, /has no validate command: it needs Mockxy 1\.6\.0 or later$/);
  // The fallback is the local load: the scripts are still loaded and their exports checked.
  assert.equal(result.report.scriptsLoaded, true);
  assert.equal(result.exitCode, 0, messages(result.report).join("\n"));
});

test("--engine-dir rejects a folder that is not Mockxy", (t) => {
  const workspace = createScriptWorkspace([{ folder: "a", routePath: "/a", specifier: "#shared/flow.js" }]);
  removeAfter(t, workspace);

  const result = validateWorkspace(workspace, { engineDir: workspace });

  assert.equal(result.report.scriptContract.status, "not-checked");
  assert.match(result.report.scriptContract.reason, /is not a Mockxy folder/);
});

// A stand-in for the admin API: /info names the mocks folder it serves, /scripts/validate answers
// only the request the engine accepts (JSON media type, body exactly {}).
async function startFakeServer(t, { mocksDir, validate = true }) {
  const calls = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      calls.push(`${request.method} ${request.url}`);
      const send = (status, payload) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(payload));
      };
      if (request.method === "GET" && request.url === "/_admin/api/info") {
        send(200, { version: "1.6.0", workspace: { mocksDir } });
      } else if (validate && request.method === "POST" && request.url === "/_admin/api/scripts/validate") {
        const accepted = request.headers["content-type"] === "application/json" && body === "{}";
        send(accepted ? 200 : 415, accepted ? ENGINE_REPORT : { error: "Unsupported Media Type" });
      } else {
        send(404, { error: "Not Found", details: { code: "ADMIN_ROUTE_NOT_FOUND" } });
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}`, calls };
}

test("--server-url takes the findings of the server that serves this workspace", async (t) => {
  const workspace = createScriptWorkspace([{ folder: "late", routePath: "/late", source: LATE_REQUIRE_HANDLER }]);
  removeAfter(t, workspace);
  const server = await startFakeServer(t, { mocksDir: fs.realpathSync(path.join(workspace, "mocks")) });

  const result = await validateWorkspaceWithEngine(workspace, { serverUrl: `${server.url}/` });

  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.report.scriptContract, {
    status: "checked",
    via: "server",
    source: `${server.url}/_admin/api`,
    engineVersion: "1.6.0",
  });
  assert.deepEqual(result.report.findings.map((finding) => finding.code), [
    "SCRIPT_LATE_REQUIRE",
    "SCRIPT_PACKAGE_EXTRA_ALIAS",
  ]);
});

test("--server-url does not ask a server that serves another workspace", async (t) => {
  const workspace = createScriptWorkspace([{ folder: "a", routePath: "/a", specifier: "#shared/flow.js" }]);
  const other = createScriptWorkspace([]);
  removeAfter(t, workspace);
  removeAfter(t, other);
  const server = await startFakeServer(t, { mocksDir: fs.realpathSync(path.join(other, "mocks")) });

  const result = await validateWorkspaceWithEngine(workspace, { serverUrl: server.url });

  assert.deepEqual(server.calls, ["GET /_admin/api/info"]);
  assert.equal(result.report.scriptContract.status, "not-checked");
  assert.match(result.report.scriptContract.reason, /serves another mocks folder/);
  assert.equal(result.report.scriptsLoaded, true);
});

test("--server-url says when the engine is too old or does not answer", async (t) => {
  const workspace = createScriptWorkspace([{ folder: "a", routePath: "/a", specifier: "#shared/flow.js" }]);
  removeAfter(t, workspace);
  const server = await startFakeServer(t, {
    mocksDir: fs.realpathSync(path.join(workspace, "mocks")),
    validate: false,
  });

  const old = await validateWorkspaceWithEngine(workspace, { serverUrl: server.url });
  assert.match(old.report.scriptContract.reason, /has no POST \/scripts\/validate: it needs Mockxy 1\.6\.0 or later$/);

  const silent = await validateWorkspaceWithEngine(workspace, { serverUrl: "http://127.0.0.1:1" });
  assert.equal(silent.report.scriptContract.status, "not-checked");
  assert.match(silent.report.scriptContract.reason, /^no usable answer from http:\/\/127\.0\.0\.1:1\/_admin\/api\/info/);
});

// Against the real engine, when its checkout sits next to this repository (or MOCKXY_ENGINE_DIR
// points at one): the fakes above cannot tell whether the two projects still agree.
const realEngineDir = process.env.MOCKXY_ENGINE_DIR || path.join(__dirname, "..", "mockxy");
const realEngineAvailable = fs.existsSync(path.join(realEngineDir, "src", "cli-validate.js"));

test("the real engine reports a late require as an error", { skip: !realEngineAvailable }, (t) => {
  const workspace = createScriptWorkspace([
    { folder: "ok", routePath: "/ok", specifier: "#shared/flow.js" },
    { folder: "late", routePath: "/late", source: LATE_REQUIRE_HANDLER },
  ]);
  removeAfter(t, workspace);

  const result = validateWorkspace(workspace, { engineDir: realEngineDir });

  assert.equal(result.report.scriptContract.status, "checked", JSON.stringify(result.report.scriptContract));
  assert.equal(result.exitCode, 1);
  assert.deepEqual(
    result.report.findings.map((finding) => [finding.level, finding.file, finding.code]),
    [["error", "mocks/late/GET.responses/001.handler.js", "SCRIPT_LATE_REQUIRE"]]
  );
});
