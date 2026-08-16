<div align="center">

# Mockxy Skills

[![en](lang-eng.svg)](README.md)
[![it](lang-ita.svg)](README.it.md)

**Skills for AI agents that author mocks in the [Mockxy](https://github.com/tosdan/mockxy) workspace format.**

![MIT license](https://img.shields.io/badge/license-MIT-blue)
![Agent Skills](https://img.shields.io/badge/agent%20skills-4-7c9d8e)

</div>

---

Give an agent the path of a Mockxy workspace and it will compose endpoints, response variants,
handlers, middleware and streams that match exactly what the engine loads.

The catalog follows the [open Agent Skills specification](https://agentskills.io/specification)
and installs through the [`skills` CLI](https://github.com/vercel-labs/skills).

## Install

```sh
npx skills@latest add tosdan/mockxy-skills --skill '*' --global
```

This is the recommended way: `--skill '*'` installs all four skills of the catalog, `--global`
makes them available user-wide instead of in the current project only. Skill and scope are already
chosen, so the CLI only asks **which agents** to install them for.

The four skills are meant to work together, and a complete endpoint almost always comes from two
of them (see [How they combine](#how-they-combine)): installing all of them keeps the agent from
holding half the format.

## Other options

`skills add` takes as its argument the source to discover and install skills from: a GitHub
repository, a Git URL or a local folder. The GitHub source of this catalog is
`tosdan/mockxy-skills`.

### Browse the catalog without installing

```sh
npx skills@latest add tosdan/mockxy-skills --list
```

### Install into the current project only

Just drop `--global`:

```sh
npx skills@latest add tosdan/mockxy-skills --skill '*'
```

### Install a single skill

```sh
npx skills@latest add tosdan/mockxy-skills --skill mockxy-workspace --global
```

### Pick the agent on the command line

`--agent` also skips the question about agents:

```sh
npx skills@latest add tosdan/mockxy-skills --skill '*' --global --agent claude-code
```

Other supported identifiers include, for example, `codex`, `cursor` and `opencode`.

### Non-interactive install

`--yes` accepts the remaining confirmations automatically. Useful in scripts and in flows where
skill, agent and scope have already been chosen explicitly:

```sh
npx skills@latest add tosdan/mockxy-skills --skill '*' --global --agent codex --yes
```

### Use a local checkout

From the root of this repository, use `.` as the source:

```sh
# List the local skills without installing them
npx skills@latest add . --list

# Install the local catalog
npx skills@latest add . --skill '*' --global
```

## The catalog

Every skill carries the `mockxy-` prefix: it is the catalog's namespace and keeps these skills from
colliding with skills installed from other sources.

### `mockxy-workspace`

The entry-point skill. It recognizes and initializes a workspace, and owns the folder layout and
the **endpoint file** format (method, path, available variants and selected variant), sequence
selection, the path convention, the catalog's organization into collections and the admin API.
It ships
`scripts/validate-workspace.js`, the validator that mirrors the Mockxy engine's own checks.

```text
Use $mockxy-workspace to inspect the workspace in ~/projects/my-workspace, add the
GET /api/orders/:id endpoint and validate the result.
```

### `mockxy-static-mock`

Static response variants: status, headers, JSON or text body, binary file payloads, simulated
delay, `{{...}}` placeholder templating, and selectable `sequence` response variants that make the
answer evolve over time. It also covers the automatic filters and pagination on list bodies.

```text
Use $mockxy-static-mock to create the GET /api/users endpoint with three variants: full list,
empty list and a 500 error.
```

### `mockxy-dynamic-mock`

Handlers and middleware: local JavaScript scripts that compute the response or transform the real
backend's one, plus JSON data files read through `data()` and named runtime state shared between
handlers. It covers scenarios where a POST must change a later GET before the backend exists.

```text
Use $mockxy-dynamic-mock to write a handler on GET /api/users/:id that looks the user up in the
data file and answers 404 when it does not exist.
```

```text
Use $mockxy-dynamic-mock to make POST /api/items add arbitrary frontend data to shared runtime
state and make GET /api/items return the seed plus every added item.
```

### `mockxy-realtime-mock`

Streaming variants: Server-Sent Events and mocked WebSocket channels, with their message scripts,
declarative reply rules, end-of-script behavior and console presets.

```text
Use $mockxy-realtime-mock to create an SSE stream on /api/events that emits three progress events
and then stays open.
```

### How they combine

`mockxy-workspace` owns the endpoint file and is the starting point; the other three own the
content of the variants. A complete endpoint almost always comes from two skills: one for the
endpoint file, one for the variant. Each skill remains usable on its own.

## Validating a workspace

The validator shipped with `mockxy-workspace` mirrors the checks the Mockxy engine performs while
loading, so a format error shows up immediately instead of silently making an endpoint disappear:

```sh
node skills/mockxy-workspace/scripts/validate-workspace.js /path/to/workspace
```

It accepts the workspace root or a `mocks/` folder directly. Options: `--json` for a
machine-readable report, `--no-scripts` to skip loading handler and middleware sources, `--quiet`
for the summary only. It exits with 1 when it finds errors.

## Repository layout

```text
skills/
  mockxy-<skill-name>/
    SKILL.md
    agents/        # optional agent metadata
    scripts/       # optional executable tools
    references/    # optional documentation loaded on demand
    assets/        # optional templates and static resources
```

Every skill is self-contained: it never reads files belonging to another skill, because users may
install them individually. The folder name and the `name` field of its `SKILL.md` must match, use
lowercase kebab-case, and start with `mockxy-`.

`SKILL.md` files and `references/` are written in English, for portability across agents. This
README is the official one; [README.it.md](README.it.md) is its Italian translation, and the two
versions are updated together.

## Contributing

The guidelines for anyone changing the catalog live in [AGENTS.md](AGENTS.md). In short: the
documented format must mirror what the Mockxy engine actually loads, the validator must be run
against a real workspace before committing, and before creating a commit you must confirm that the
CLI discovers all the intended skills and nothing else:

```sh
npx skills@latest add . --list
```

## License

[MIT](LICENSE).
