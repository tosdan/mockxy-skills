"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { validateWorkspace } = require(
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
