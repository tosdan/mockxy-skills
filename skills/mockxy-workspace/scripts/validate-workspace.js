#!/usr/bin/env node
"use strict";

// Mockxy workspace validator.
//
// Mirrors the checks the Mockxy engine performs while loading a workspace
// (src/mocks/endpoint-loader.js and the modules it uses: route-groups, sequence-config,
// sse-config, ws-config), so a workspace written by an agent fails here instead of failing
// silently at serving time.
//
// Usage:
//   node validate-workspace.js [path] [options]
//
//   path            workspace root (the folder holding mockxy.json) or a mocks folder.
//                   Defaults to the current directory.
//   --json          machine-readable report on stdout.
//   --no-scripts    do not require() handler/middleware sources (skips the export check).
//   --quiet         print only the summary line and the findings, no headers.
//
// Exit code is 1 when at least one error is found, 0 otherwise.
//
// Severity follows the engine: a broken *selected* variant (or a variant referenced by an active
// sequence) takes the endpoint down, so it is an error; a broken variant nobody selected is
// inert until someone selects it, so it is a warning.

const fs = require("fs");
const path = require("path");

const ENDPOINT_SUFFIX = ".endpoint.json";
const RESPONSE_SUFFIX = ".response.json";
const RESPONSES_DIR_SUFFIX = ".responses";
const HTTP_METHOD_PATTERN = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/;
const DATA_FILE_NAME_PATTERN = /^[a-z0-9._-]+\.json$/;
const RESERVED_QUERY_FOLDER_CHAR = "^";
const SEQUENCE_ON_END_VALUES = new Set(["stay", "loop"]);
const STREAM_ON_END_VALUES = new Set(["keep-open", "close", "loop"]);
const RESPONSE_TYPES = new Set(["mock", "handler", "middleware", "sse", "ws"]);

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

const findings = [];
let workspaceRoot = process.cwd();

function toRelative(filePath) {
  const relative = path.relative(workspaceRoot, filePath);
  if (relative === "") {
    return ".";
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return filePath;
  }
  return relative.split(path.sep).join("/");
}

function report(level, filePath, message) {
  findings.push({ level, file: filePath == null ? null : toRelative(filePath), message });
}

function error(filePath, message) {
  report("error", filePath, message);
}

function warn(filePath, message) {
  report("warning", filePath, message);
}

// ---------------------------------------------------------------------------
// Small helpers, kept aligned with the engine's own predicates
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value >= 1;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isValidHttpStatus(status) {
  return Number.isInteger(status) && status >= 100 && status <= 599;
}

function isSafeLocalFileName(fileName, suffix) {
  return typeof fileName === "string"
    && fileName.trim() !== ""
    && fileName === path.basename(fileName)
    && fileName.endsWith(suffix);
}

function isHeaderValue(value) {
  return typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
    || (Array.isArray(value) && value.every((item) => typeof item === "string"));
}

function exists(filePath) {
  try {
    fs.statSync(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

function isDirectory(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch (_error) {
    return false;
  }
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return { value: JSON.parse(raw) };
  } catch (parseError) {
    return { parseError: parseError.message };
  }
}

// ---------------------------------------------------------------------------
// Path format (src/mocks/route-groups.js)
// ---------------------------------------------------------------------------

function splitRoutePath(routePath) {
  const queryStartIndex = routePath.indexOf("?");
  return {
    pathname: queryStartIndex === -1 ? routePath : routePath.slice(0, queryStartIndex),
    queryString: queryStartIndex === -1 ? "" : routePath.slice(queryStartIndex + 1),
  };
}

function validatePathFormat(routePath, errors) {
  const { pathname } = splitRoutePath(routePath);

  if (!pathname.startsWith("/")) {
    errors.push(`path must start with '/'. Received: ${routePath}`);
  }
  if (routePath.includes(RESERVED_QUERY_FOLDER_CHAR)) {
    errors.push(`path cannot contain '${RESERVED_QUERY_FOLDER_CHAR}': it is reserved for derived query folders`);
  }
  // A bare '*' is not a supported pattern and is rejected when the matcher is built.
  if (pathname.split("/").some((segment) => segment === "*")) {
    errors.push(`path cannot use a bare '*' segment. Received: ${routePath}`);
  }
  if (/\{[^}]*\}/.test(pathname)) {
    errors.push(
      `path uses OpenAPI-style '{param}' syntax. Mockxy paths use ':param' — '{param}' belongs to folder names only. Received: ${routePath}`
    );
  }
}

// ---------------------------------------------------------------------------
// sequence (src/mocks/sequence-config.js)
// ---------------------------------------------------------------------------

function validateSequence(sequence, responseFiles, errors) {
  if (sequence == null) {
    return null;
  }
  if (!isPlainObject(sequence)) {
    errors.push("sequence must be an object");
    return null;
  }

  if (sequence.enabled != null && typeof sequence.enabled !== "boolean") {
    errors.push("sequence.enabled must be a boolean");
  }
  const enabled = sequence.enabled !== false;

  const onEnd = sequence.onEnd == null ? "stay" : sequence.onEnd;
  if (!SEQUENCE_ON_END_VALUES.has(onEnd)) {
    errors.push("sequence.onEnd must be stay or loop");
  }

  if (sequence.resetAfterMs != null && !isPositiveInteger(sequence.resetAfterMs)) {
    errors.push("sequence.resetAfterMs must be a positive integer");
  }

  const knownResponseFiles = new Set(Array.isArray(responseFiles) ? responseFiles : []);
  const stepResponses = [];
  if (!Array.isArray(sequence.steps) || sequence.steps.length < 2) {
    errors.push("sequence.steps must be an array with at least 2 steps");
    return { enabled, stepResponses };
  }

  sequence.steps.forEach((step, index) => {
    const label = `sequence.steps[${index}]`;
    if (!isPlainObject(step)) {
      errors.push(`${label} must be an object`);
      return;
    }
    if (typeof step.response !== "string" || !knownResponseFiles.has(step.response)) {
      errors.push(`${label}.response must be a response filename listed in responseFiles`);
    } else {
      stepResponses.push(step.response);
    }

    const hasTimes = step.times != null;
    const hasForMs = step.forMs != null;
    if (hasTimes && hasForMs) {
      errors.push(`${label} cannot declare both times and forMs`);
    }
    if (hasTimes && !isPositiveInteger(step.times)) {
      errors.push(`${label}.times must be a positive integer`);
    }
    if (hasForMs && !isPositiveInteger(step.forMs)) {
      errors.push(`${label}.forMs must be a positive integer`);
    }

    const isLastStep = index === sequence.steps.length - 1;
    if (!hasTimes && !hasForMs && (!isLastStep || onEnd === "loop")) {
      errors.push(
        isLastStep
          ? `${label} must declare times or forMs when sequence.onEnd is loop`
          : `${label} must declare times or forMs`
      );
    }
  });

  return { enabled, stepResponses };
}

// ---------------------------------------------------------------------------
// Endpoint file (src/mocks/endpoint-loader.js -> validateEndpointConfig)
// ---------------------------------------------------------------------------

function validateEndpointConfig(endpoint, endpointFilePath, errors) {
  if (!isPlainObject(endpoint)) {
    errors.push("endpoint config must be an object");
    return null;
  }

  const fileMethod = path.basename(endpointFilePath).slice(0, -ENDPOINT_SUFFIX.length).toUpperCase();
  const method = String(endpoint.method || "").toUpperCase();
  if (!HTTP_METHOD_PATTERN.test(method)) {
    errors.push("method must be one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS");
  }
  if (method !== fileMethod) {
    errors.push(`method must match the endpoint filename (${fileMethod})`);
  }

  if (typeof endpoint.path !== "string" || endpoint.path.trim() === "") {
    errors.push("path must be a non-empty string");
  } else {
    validatePathFormat(endpoint.path, errors);
  }

  if (endpoint.description != null && typeof endpoint.description !== "string") {
    errors.push("description must be a string when provided");
  }
  if (typeof endpoint.enabled !== "boolean") {
    errors.push("enabled must be a boolean");
  }

  if (!Array.isArray(endpoint.responseFiles) || endpoint.responseFiles.length === 0) {
    errors.push("responseFiles must be a non-empty array");
  }
  const responseFiles = Array.isArray(endpoint.responseFiles) ? endpoint.responseFiles : [];
  const seenResponseFiles = new Set();
  for (const responseFile of responseFiles) {
    if (!isSafeLocalFileName(responseFile, RESPONSE_SUFFIX)) {
      errors.push(`responseFiles contains an invalid response filename: ${JSON.stringify(responseFile)} (plain filename ending in ${RESPONSE_SUFFIX}, no path separators)`);
      continue;
    }
    if (seenResponseFiles.has(responseFile)) {
      errors.push(`responseFiles contains a duplicate response filename: ${responseFile}`);
    }
    seenResponseFiles.add(responseFile);
  }

  if (!isSafeLocalFileName(endpoint.selectedResponseFile, RESPONSE_SUFFIX)) {
    errors.push(`selectedResponseFile must be a plain filename ending in ${RESPONSE_SUFFIX}`);
  } else if (!seenResponseFiles.has(endpoint.selectedResponseFile)) {
    errors.push("selectedResponseFile must be listed in responseFiles");
  }

  const sequence = validateSequence(endpoint.sequence, [...seenResponseFiles], errors);

  return {
    method: HTTP_METHOD_PATTERN.test(method) ? method : fileMethod,
    path: typeof endpoint.path === "string" ? endpoint.path : null,
    enabled: endpoint.enabled === true,
    responseFiles: [...seenResponseFiles],
    selectedResponseFile: endpoint.selectedResponseFile,
    sequence,
  };
}

// ---------------------------------------------------------------------------
// Response variants
// ---------------------------------------------------------------------------

function validateHeaders(headers, errors) {
  if (headers == null) {
    return;
  }
  if (!isPlainObject(headers) || !Object.values(headers).every(isHeaderValue)) {
    errors.push("headers must be an object whose values are strings, numbers, booleans or arrays of strings");
  }
}

function validateMockVariant(response, responseDir, errors) {
  if (!isValidHttpStatus(response.status)) {
    errors.push("status must be an integer between 100 and 599");
  }
  if (response.delayMs != null && !isNonNegativeInteger(response.delayMs)) {
    errors.push("delayMs must be a non-negative integer");
  }
  if (response.templated != null && typeof response.templated !== "boolean") {
    errors.push("templated must be a boolean");
  }
  validateHeaders(response.headers, errors);

  const hasBody = Object.prototype.hasOwnProperty.call(response, "body");
  const hasFile = Object.prototype.hasOwnProperty.call(response, "file");
  if (response.templated === true && hasFile) {
    errors.push("templated is not supported on file payloads");
  }
  if (hasBody && hasFile) {
    errors.push("body and file are mutually exclusive");
  }
  if (!hasBody && !hasFile) {
    errors.push("define exactly one of body or file");
  }
  if (hasFile) {
    if (typeof response.file !== "string" || response.file.trim() === "") {
      errors.push("file must be a non-empty string");
      return;
    }
    const payloadPath = path.resolve(responseDir, response.file);
    const relative = path.relative(path.resolve(responseDir), payloadPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      errors.push(`file must stay inside the ${path.basename(responseDir)} folder`);
      return;
    }
    if (!exists(payloadPath)) {
      errors.push(`file payload not found on disk: ${response.file}`);
    }
  }
}

function validateStreamMessage(message, label, errors, { allowEventAndId }) {
  if (!isPlainObject(message)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  if (!Object.prototype.hasOwnProperty.call(message, "data")) {
    errors.push(`${label}.data is required`);
    return false;
  }
  if (allowEventAndId) {
    if (message.event != null && (typeof message.event !== "string" || message.event.trim() === "")) {
      errors.push(`${label}.event must be a non-empty string`);
    }
    if (message.id != null && typeof message.id !== "string") {
      errors.push(`${label}.id must be a string`);
    }
  }
  return true;
}

function validateStreamScript(entries, field, errors, options) {
  const script = [];
  if (entries != null && !Array.isArray(entries)) {
    errors.push(`${field} must be an array`);
    return script;
  }
  (entries || []).forEach((entry, index) => {
    const label = `${field}[${index}]`;
    if (!validateStreamMessage(entry, label, errors, options)) {
      return;
    }
    if (!isNonNegativeInteger(entry.afterMs)) {
      errors.push(`${label}.afterMs must be a non-negative integer`);
      return;
    }
    script.push(entry);
  });
  return script;
}

function validateLoopScript(script, onEnd, errors) {
  if (onEnd !== "loop") {
    return;
  }
  if (script.length === 0) {
    errors.push("onEnd loop requires a non-empty script");
  } else if (script.every((entry) => entry.afterMs === 0)) {
    errors.push("onEnd loop requires at least one script entry with afterMs > 0");
  }
}

function validatePresets(presets, errors, options) {
  if (presets != null && !Array.isArray(presets)) {
    errors.push("presets must be an array");
    return;
  }
  (presets || []).forEach((entry, index) => {
    const label = `presets[${index}]`;
    if (!validateStreamMessage(entry, label, errors, options)) {
      return;
    }
    if (entry.label != null && typeof entry.label !== "string") {
      errors.push(`${label}.label must be a string`);
    }
  });
}

function validateSseVariant(response, errors) {
  if (response.retryMs != null && !isNonNegativeInteger(response.retryMs)) {
    errors.push("retryMs must be a non-negative integer");
  }
  const onEnd = response.onEnd == null ? "keep-open" : response.onEnd;
  if (!STREAM_ON_END_VALUES.has(onEnd)) {
    errors.push("onEnd must be keep-open, close or loop");
  }
  const script = validateStreamScript(response.script, "script", errors, { allowEventAndId: true });
  validateLoopScript(script, onEnd, errors);
  validatePresets(response.presets, errors, { allowEventAndId: true });
}

function validateWsVariant(response, errors) {
  const onEnd = response.onEnd == null ? "keep-open" : response.onEnd;
  if (!STREAM_ON_END_VALUES.has(onEnd)) {
    errors.push("onEnd must be keep-open, close or loop");
  }

  if (response.closeCode != null) {
    const valid = Number.isInteger(response.closeCode)
      && (response.closeCode === 1000 || (response.closeCode >= 3000 && response.closeCode <= 4999));
    if (!valid) {
      errors.push("closeCode must be 1000 or an integer between 3000 and 4999");
    } else if (onEnd !== "close") {
      errors.push("closeCode requires onEnd close");
    }
  }
  if (response.closeReason != null) {
    if (typeof response.closeReason !== "string" || response.closeReason.length > 123) {
      errors.push("closeReason must be a string of at most 123 characters");
    } else if (onEnd !== "close") {
      errors.push("closeReason requires onEnd close");
    }
  }

  const script = validateStreamScript(response.script, "script", errors, { allowEventAndId: false });
  validateLoopScript(script, onEnd, errors);

  if (response.rules != null && !Array.isArray(response.rules)) {
    errors.push("rules must be an array");
  } else {
    (response.rules || []).forEach((entry, index) => {
      const label = `rules[${index}]`;
      if (!isPlainObject(entry)) {
        errors.push(`${label} must be an object`);
        return;
      }
      if (!isPlainObject(entry.match)) {
        errors.push(`${label}.match must be an object`);
        return;
      }
      const kinds = ["equals", "contains", "json"].filter((kind) =>
        Object.prototype.hasOwnProperty.call(entry.match, kind)
      );
      if (kinds.length !== 1) {
        errors.push(`${label}.match must declare exactly one of equals, contains or json`);
        return;
      }
      const kind = kinds[0];
      if (kind === "json") {
        if (!isPlainObject(entry.match.json)) {
          errors.push(`${label}.match.json must be an object`);
          return;
        }
      } else if (typeof entry.match[kind] !== "string" || entry.match[kind] === "") {
        errors.push(`${label}.match.${kind} must be a non-empty string`);
        return;
      }
      validateStreamScript(entry.reply, `${label}.reply`, errors, { allowEventAndId: false });
      if (!Array.isArray(entry.reply) || entry.reply.length === 0) {
        errors.push(`${label}.reply must be a non-empty array`);
      }
    });
  }

  validatePresets(response.presets, errors, { allowEventAndId: false });
}

function validateScriptVariant(response, responseDir, type, errors, options) {
  const expectedSuffix = type === "handler" ? ".handler.js" : ".middleware.js";
  if (!isSafeLocalFileName(response.sourceFile, expectedSuffix)) {
    errors.push(`sourceFile must be a plain filename ending in ${expectedSuffix}`);
    return null;
  }

  const sourcePath = path.resolve(responseDir, response.sourceFile);
  if (!exists(sourcePath)) {
    errors.push(`source file not found on disk: ${response.sourceFile}`);
    return null;
  }
  if (!options.loadScripts) {
    return sourcePath;
  }

  const requiredFunction = type === "handler" ? "resolveResponse" : "transformResponse";
  let definition;
  try {
    delete require.cache[require.resolve(sourcePath)];
    definition = require(sourcePath);
  } catch (loadError) {
    errors.push(`${response.sourceFile} could not be loaded: ${loadError.message}`);
    return sourcePath;
  }
  if (!isPlainObject(definition) || typeof definition[requiredFunction] !== "function") {
    errors.push(`${response.sourceFile} must export an object with a ${requiredFunction} function`);
  }
  if (definition != null && (definition.method != null || definition.path != null || definition.disabled != null)) {
    errors.push(`${response.sourceFile} must not declare method, path or disabled: routing belongs to the endpoint file`);
  }
  return sourcePath;
}

// Validates one response file and returns its declared type plus the script source path, if any.
function validateResponseFile(responsePath, responseDir, options) {
  const errors = [];
  const parsed = readJson(responsePath);
  if (parsed.parseError != null) {
    return { errors: [`invalid JSON: ${parsed.parseError}`], type: null, sourcePath: null };
  }

  const response = parsed.value;
  if (!isPlainObject(response)) {
    return { errors: ["response must be an object"], type: null, sourcePath: null };
  }
  if (response.title != null && typeof response.title !== "string") {
    errors.push("title must be a string when provided");
  }
  if (!RESPONSE_TYPES.has(response.type)) {
    errors.push("type must be mock, handler, middleware, sse or ws");
    return { errors, type: null, sourcePath: null };
  }

  let sourcePath = null;
  if (response.type === "mock") {
    validateMockVariant(response, responseDir, errors);
  } else if (response.type === "sse") {
    validateSseVariant(response, errors);
  } else if (response.type === "ws") {
    validateWsVariant(response, errors);
  } else {
    sourcePath = validateScriptVariant(response, responseDir, response.type, errors, options);
  }

  return { errors, type: response.type, sourcePath };
}

// ---------------------------------------------------------------------------
// Workspace walk
// ---------------------------------------------------------------------------

function listEndpointFiles(rootDir) {
  const results = [];
  if (!isDirectory(rootDir)) {
    return results;
  }
  const stack = [rootDir];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith(ENDPOINT_SUFFIX)) {
        results.push(absolutePath);
      }
    }
  }
  return results.sort((a, b) => a.localeCompare(b));
}

function collectDataReferences(sourcePath, dataReferences) {
  let source;
  try {
    source = fs.readFileSync(sourcePath, "utf8");
  } catch (_error) {
    return;
  }
  const pattern = /\bdata\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  let match = pattern.exec(source);
  while (match != null) {
    const name = match[1].toLowerCase().replace(/\.json$/, "");
    if (!dataReferences.has(name)) {
      dataReferences.set(name, []);
    }
    dataReferences.get(name).push(sourcePath);
    match = pattern.exec(source);
  }
}

function validateEndpoints(mocksDir, options) {
  const endpointFiles = listEndpointFiles(mocksDir);
  const seenEndpointKeys = new Map();
  const dataReferences = new Map();
  const referencedResponseFiles = new Set();

  if (endpointFiles.length === 0) {
    warn(mocksDir, "no *.endpoint.json file found: the workspace serves no mock");
  }

  for (const endpointFilePath of endpointFiles) {
    const parsed = readJson(endpointFilePath);
    if (parsed.parseError != null) {
      error(endpointFilePath, `invalid JSON: ${parsed.parseError}`);
      continue;
    }

    const errors = [];
    const endpoint = validateEndpointConfig(parsed.value, endpointFilePath, errors);
    for (const message of errors) {
      error(endpointFilePath, message);
    }
    if (endpoint == null || endpoint.path == null) {
      continue;
    }

    const endpointKey = `${endpoint.method} ${endpoint.path}`;
    const previous = seenEndpointKeys.get(endpointKey);
    if (previous != null) {
      error(endpointFilePath, `duplicate endpoint ${endpointKey}: conflicts with ${toRelative(previous)} (the first one wins, this one is ignored)`);
    } else {
      seenEndpointKeys.set(endpointKey, endpointFilePath);
    }

    const endpointDir = path.dirname(endpointFilePath);
    const responseDir = path.join(endpointDir, `${endpoint.method}${RESPONSES_DIR_SUFFIX}`);
    if (endpoint.responseFiles.length > 0 && !isDirectory(responseDir)) {
      error(endpointFilePath, `missing responses folder: ${path.basename(responseDir)}`);
      continue;
    }

    // Variants the engine loads eagerly: the selected one, plus every step of an active sequence.
    const criticalVariants = new Set();
    const sequenceActive = endpoint.sequence != null && endpoint.sequence.enabled;
    if (sequenceActive) {
      for (const stepResponse of endpoint.sequence.stepResponses) {
        criticalVariants.add(stepResponse);
      }
    } else if (typeof endpoint.selectedResponseFile === "string") {
      criticalVariants.add(endpoint.selectedResponseFile);
    }

    for (const responseFileName of endpoint.responseFiles) {
      const responsePath = path.join(responseDir, responseFileName);
      referencedResponseFiles.add(path.resolve(responsePath));
      const isCritical = criticalVariants.has(responseFileName);
      const emit = isCritical ? error : warn;

      if (!exists(responsePath)) {
        emit(endpointFilePath, `response file listed in responseFiles not found on disk: ${responseFileName}`);
        continue;
      }

      const result = validateResponseFile(responsePath, responseDir, options);
      for (const message of result.errors) {
        emit(responsePath, message);
      }
      if (result.sourcePath != null) {
        collectDataReferences(result.sourcePath, dataReferences);
      }
      if (sequenceActive && isCritical && (result.type === "middleware" || result.type === "sse" || result.type === "ws")) {
        error(endpointFilePath, `sequence steps must reference mock or handler variants (${responseFileName} is a ${result.type})`);
      }
      if (!isCritical && result.errors.length > 0) {
        warn(responsePath, "this variant is not selected: the engine ignores it until it becomes the active one");
      }
    }

    // Orphan variants: present on disk, absent from responseFiles, therefore unreachable.
    if (isDirectory(responseDir)) {
      for (const entry of fs.readdirSync(responseDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(RESPONSE_SUFFIX)) {
          continue;
        }
        if (!endpoint.responseFiles.includes(entry.name)) {
          warn(path.join(responseDir, entry.name), "response file not listed in responseFiles: the engine never serves it");
        }
      }
    }
  }

  return { dataReferences, endpointCount: endpointFiles.length, referencedResponseFiles };
}

function validateOrphanResponseFolders(mocksDir, referencedResponseFiles) {
  if (!isDirectory(mocksDir)) {
    return;
  }
  const stack = [mocksDir];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const absolutePath = path.join(currentDir, entry.name);
      if (!entry.isDirectory()) {
        continue;
      }
      if (entry.name.endsWith(RESPONSES_DIR_SUFFIX)) {
        const method = entry.name.slice(0, -RESPONSES_DIR_SUFFIX.length);
        const endpointFilePath = path.join(currentDir, `${method}${ENDPOINT_SUFFIX}`);
        if (!exists(endpointFilePath)) {
          warn(absolutePath, `responses folder without ${method}${ENDPOINT_SUFFIX}: nothing loads these variants`);
        }
        continue;
      }
      stack.push(absolutePath);
    }
  }
}

function validateCollections(mocksDir) {
  const metadataPath = path.join(mocksDir, ".collections.json");
  if (!exists(metadataPath)) {
    return;
  }
  const parsed = readJson(metadataPath);
  if (parsed.parseError != null) {
    error(metadataPath, `invalid JSON: ${parsed.parseError}`);
    return;
  }
  const state = parsed.value;
  if (!isPlainObject(state)) {
    error(metadataPath, "collection metadata must be an object");
    return;
  }

  const collectionIds = new Set();
  const parentById = new Map();
  const rawCollections = state.collections == null ? [] : state.collections;
  if (!Array.isArray(rawCollections)) {
    error(metadataPath, "collections must be an array");
    return;
  }
  for (const collection of rawCollections) {
    if (!isPlainObject(collection)) {
      error(metadataPath, "each entry of collections must be an object");
      continue;
    }
    const id = typeof collection.id === "string" ? collection.id.trim() : "";
    if (id === "") {
      error(metadataPath, "each collection needs a non-empty string id");
      continue;
    }
    if (collectionIds.has(id)) {
      error(metadataPath, `duplicate collection id: ${id}`);
      continue;
    }
    if (typeof collection.label !== "string" || collection.label.trim() === "") {
      error(metadataPath, `collection ${id} needs a non-empty string label`);
    }
    collectionIds.add(id);
    if (typeof collection.parentId === "string" && collection.parentId.trim() !== "") {
      parentById.set(id, collection.parentId.trim());
    }
  }

  for (const [id, parentId] of parentById) {
    if (!collectionIds.has(parentId)) {
      warn(metadataPath, `collection ${id} references an unknown parentId (${parentId}): the parent link is dropped`);
      continue;
    }
    let cursor = parentId;
    const visited = new Set([id]);
    while (cursor != null) {
      if (visited.has(cursor)) {
        warn(metadataPath, `collection ${id} takes part in a parentId cycle: the parent link is dropped`);
        break;
      }
      visited.add(cursor);
      cursor = parentById.get(cursor);
    }
  }

  const memberships = state.memberships == null ? {} : state.memberships;
  if (!isPlainObject(memberships)) {
    error(metadataPath, "memberships must be an object");
    return;
  }
  for (const [relativePath, collectionId] of Object.entries(memberships)) {
    if (!collectionIds.has(String(collectionId).trim())) {
      warn(metadataPath, `membership ${relativePath} points to an unknown collection (${collectionId}): the endpoint stays unsorted`);
    }
    const endpointFilePath = path.join(mocksDir, relativePath.split("/").join(path.sep));
    if (!exists(endpointFilePath)) {
      warn(metadataPath, `membership key does not match any endpoint file: ${relativePath}`);
    }
  }

  const childOrder = state.childOrder == null ? {} : state.childOrder;
  if (!isPlainObject(childOrder)) {
    error(metadataPath, "childOrder must be an object");
    return;
  }
  const allowedParentKeys = new Set(["root", "unsorted", ...collectionIds]);
  for (const [parentKey, children] of Object.entries(childOrder)) {
    if (!allowedParentKeys.has(parentKey)) {
      warn(metadataPath, `childOrder key ${parentKey} is neither "root", "unsorted" nor a known collection id: it is ignored`);
    }
    if (!Array.isArray(children)) {
      error(metadataPath, `childOrder.${parentKey} must be an array`);
    }
  }
}

function validateDataFiles(filesDir, dataReferences) {
  const availableNames = new Set();

  if (isDirectory(filesDir)) {
    for (const entry of fs.readdirSync(filesDir, { withFileTypes: true })) {
      const absolutePath = path.join(filesDir, entry.name);
      if (entry.isDirectory()) {
        warn(absolutePath, "the data folder is flat: subfolders are not read by data()");
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (!DATA_FILE_NAME_PATTERN.test(entry.name)) {
        error(absolutePath, "data file names must be lowercase and made of letters, digits, '.', '_' or '-', with a .json extension");
        continue;
      }
      const parsed = readJson(absolutePath);
      if (parsed.parseError != null) {
        error(absolutePath, `invalid JSON: ${parsed.parseError}`);
        continue;
      }
      availableNames.add(entry.name.replace(/\.json$/, ""));
    }
  }

  for (const [name, sources] of dataReferences) {
    if (availableNames.has(name)) {
      continue;
    }
    for (const sourcePath of sources) {
      error(sourcePath, `data("${name}") has no matching file: expected ${toRelative(path.join(filesDir, `${name}.json`))}`);
    }
  }
}

function validateMarker(root) {
  const markerPath = path.join(root, "mockxy.json");
  if (!exists(markerPath)) {
    warn(root, "mockxy.json is missing: the desktop app will not recognize this folder as a workspace");
    return;
  }
  const parsed = readJson(markerPath);
  if (parsed.parseError != null) {
    error(markerPath, `invalid JSON: ${parsed.parseError}`);
    return;
  }
  if (!isPlainObject(parsed.value)) {
    error(markerPath, "mockxy.json must be an object");
    return;
  }
  if (typeof parsed.value.formatVersion !== "number") {
    warn(markerPath, 'formatVersion is missing or not a number: expected { "formatVersion": 1 }');
  }
  if (parsed.value.title != null && typeof parsed.value.title !== "string") {
    error(markerPath, "title must be a string when provided");
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function resolveTarget(target) {
  const resolved = path.resolve(target);
  if (!isDirectory(resolved)) {
    return { fatal: `not a directory: ${resolved}` };
  }

  if (exists(path.join(resolved, "mockxy.json")) || isDirectory(path.join(resolved, "mocks"))) {
    return {
      root: resolved,
      mocksDir: path.join(resolved, "mocks"),
      filesDir: path.join(resolved, "files"),
      checkMarker: true,
    };
  }

  // A mocks folder was passed directly (headless setups point MOCKS_DIR anywhere).
  if (listEndpointFiles(resolved).length > 0 || path.basename(resolved) === "mocks") {
    const parent = path.dirname(resolved);
    return {
      root: parent,
      mocksDir: resolved,
      filesDir: path.join(parent, "files"),
      checkMarker: false,
    };
  }

  return { fatal: `${resolved} is neither a Mockxy workspace (no mockxy.json, no mocks/) nor a mocks folder` };
}

function parseArgs(argv) {
  const options = { target: null, json: false, loadScripts: true, quiet: false };
  for (const arg of argv) {
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--no-scripts") {
      options.loadScripts = false;
    } else if (arg === "--quiet") {
      options.quiet = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg.startsWith("-")) {
      options.unknown = arg;
    } else if (options.target == null) {
      options.target = arg;
    }
  }
  return options;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node validate-workspace.js [path] [--json] [--no-scripts] [--quiet]",
      "",
      "  path          Mockxy workspace root or mocks folder (default: current directory)",
      "  --json        machine-readable report",
      "  --no-scripts  do not require() handler/middleware sources",
      "  --quiet       findings and summary only",
      "",
      "Exits with 1 when errors are found.",
      "",
    ].join("\n")
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return 0;
  }
  if (options.unknown != null) {
    process.stderr.write(`Unknown option: ${options.unknown}\n`);
    printHelp();
    return 2;
  }

  const target = resolveTarget(options.target || process.cwd());
  if (target.fatal != null) {
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ ok: false, fatal: target.fatal }, null, 2)}\n`);
    } else {
      process.stderr.write(`${target.fatal}\n`);
    }
    return 2;
  }

  workspaceRoot = target.root;

  if (target.checkMarker) {
    validateMarker(target.root);
  }
  if (!isDirectory(target.mocksDir)) {
    error(target.mocksDir, "mocks folder not found");
  }

  const { dataReferences, endpointCount, referencedResponseFiles } = validateEndpoints(target.mocksDir, options);
  validateOrphanResponseFolders(target.mocksDir, referencedResponseFiles);
  validateCollections(target.mocksDir);
  validateDataFiles(target.filesDir, dataReferences);

  const errorCount = findings.filter((finding) => finding.level === "error").length;
  const warningCount = findings.length - errorCount;

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: errorCount === 0,
          workspace: target.root,
          mocksDir: target.mocksDir,
          endpoints: endpointCount,
          errors: errorCount,
          warnings: warningCount,
          findings,
          scriptsLoaded: options.loadScripts,
        },
        null,
        2
      )}\n`
    );
    return errorCount === 0 ? 0 : 1;
  }

  const lines = [];
  if (!options.quiet) {
    lines.push(`Mockxy workspace: ${target.root}`);
    lines.push(`Endpoint files:   ${endpointCount}`);
    if (!options.loadScripts) {
      lines.push("Scripts:          not loaded (--no-scripts): handler/middleware exports were not checked");
    }
    lines.push("");
  }
  for (const finding of findings) {
    const tag = finding.level === "error" ? "ERROR" : "WARN ";
    lines.push(`${tag} ${finding.file == null ? "" : `${finding.file}: `}${finding.message}`);
  }
  if (findings.length > 0) {
    lines.push("");
  }
  lines.push(
    errorCount === 0
      ? `OK — ${endpointCount} endpoint file(s), 0 errors, ${warningCount} warning(s).`
      : `FAILED — ${errorCount} error(s), ${warningCount} warning(s).`
  );
  process.stdout.write(`${lines.join("\n")}\n`);

  return errorCount === 0 ? 0 : 1;
}

process.exitCode = main();
