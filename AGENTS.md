# Repository Guidelines

This repository is a catalog of portable Agent Skills for [Mockxy](https://github.com/tosdan/mockxy)
workspaces.

## Structure

- Put every publishable skill in `skills/<skill-name>/`.
- Prefix every skill name with `mockxy-`. The prefix is the namespace of this catalog: it keeps
  the skills recognizable and prevents collisions with skills installed from other sources.
- Keep each skill self-contained: a skill must never read files that live in another skill's
  directory, because users install skills individually. Referring to another skill *by name*
  ("validate with `mockxy-workspace`") is allowed and expected.
- Require `SKILL.md`. Add `agents/`, `scripts/`, `references/` and `assets/` only when the skill
  needs them.
- Do not place templates or incomplete skills under `skills/`, because the CLI may discover and
  publish them.

## The two READMEs

- `README.md` is the official one and is written in **English**; `README.it.md` is its **Italian**
  translation. The project is public, so English comes first and the Italian link stays visible at
  the top of both files.
- Change them **together**: a pull request touching one and not the other is incomplete. Keep the
  same section order, so the two files stay diffable side by side.
- Keep the language badges (`lang-eng.svg`, `lang-ita.svg`) at the head of both files, pointing at
  `README.md` and `README.it.md`.
- Anchors differ between the two languages: check that in-page links resolve in the file they
  belong to.

## SKILL.md

- Follow the Agent Skills specification at https://agentskills.io/specification.
- Use lowercase kebab-case for the directory and `name`; they must match.
- Make `description` state both what the skill does and when it should trigger.
- Write `SKILL.md` and `references/` in English.
- Keep instructions portable across agents. Isolate agent-specific behavior and document it
  explicitly when it cannot be avoided.
- Keep `SKILL.md` concise: it holds the workflow and the minimum format an agent needs to write a
  correct file. Put exhaustive field-by-field documentation in `references/` and link to it with
  relative paths.
- Avoid experimental frontmatter fields unless the skill genuinely requires them and their
  reduced portability is intentional.

## Fidelity to Mockxy

- The on-disk format documented here mirrors what the Mockxy engine actually loads
  (`src/mocks/endpoint-loader.js` and the modules it uses in the Mockxy repository). When Mockxy
  changes a validation rule, the references and `scripts/validate-workspace.js` must change with
  it.
- Prefer stating the rule the engine enforces over describing what the UI happens to do.
- Never document a field the loader ignores without saying so.

## Verification

- Run or otherwise exercise scripts added to a skill. `skills/mockxy-workspace/scripts/validate-workspace.js`
  must be run against a real workspace before committing a change to it.
- From the repository root, run `npx skills@latest add . --list` and confirm all intended skills
  are discovered with no duplicates.
- Review skill scripts and instructions for unsafe commands, hidden network access, secrets, and
  machine-specific absolute paths before committing.
