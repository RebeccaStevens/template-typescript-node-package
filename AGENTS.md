# Agent Guide

Authoritative guide for AI coding agents working in this repository — the template repo for
Rebecca Stevens' TypeScript Node packages.

## Project Map

- `src/` — package source code (entry point: `src/index.ts`).
- `tests/` — test suite run with vitest.
- `.github/workflows/` — CI workflows (build, lint, test, typecheck, release).
- `rollup.config.ts` — bundler configuration producing dual ESM/CJS builds with bundled types.
- Builds are orchestrated by wireit (`pnpm build`), with incremental state cached in `.wireit/`.

## Commands

| Command              | Purpose                                                       |
| -------------------- | ------------------------------------------------------------- |
| `pnpm build`         | Build `dist/` via wireit and rollup.                          |
| `pnpm test`          | Run the vitest suite with coverage.                           |
| `pnpm run typecheck` | Typecheck the root and src projects.                          |
| `pnpm run lint`      | Aggregate lint gate (see sub-lints below).                    |
| `pnpm run lint-fix`  | Auto-fix eslint, markdown, and dependency duplication issues. |
| `pnpm run release`   | Publish via semantic-release driven by conventional commits.  |

Lint sub-scripts: `lint:md` (markdownlint-cli2), `lint:spelling` (cspell with
`project-dictionary.txt`), `lint:js` (eslint), `lint:yaml`, `lint:knip` (unused files,
exports, and dependencies), `lint:package` (publint), `lint:packages` (pnpm dedupe check).

## Conventions

- Strict TypeScript; the src build additionally enables `isolatedDeclarations` and
  `erasableSyntaxOnly`.
- Functional style enforced by eslint (`@rebeccastevens/eslint-config` with
  eslint-plugin-functional): prefer immutability and pure functions over classes and mutation.
- Conventional Commits are enforced by commitlint in the husky `commit-msg` hook;
  `pnpm run cz` commits interactively via Commitizen.
- The husky `pre-commit` hook runs lint-staged; PR titles are validated by the
  `semantic-pr.yml` workflow, and all compliance checks must pass before merge.

<!-- template-agents-template-only-start -->

## Template Development

This repository is the upstream template; this section only applies while developing the template
itself and is removed when a consumer initializes a package from it.

- `scripts/init.ts` implements the init system: it copies the template, prompts for package
  metadata (or reads a JSON config validated against `scripts/init-config.schema.json`), rewrites
  text files via placeholder replacement, and conditionally removes optional features.
- Templated documents use HTML comment marker pairs of the form
  `<!-- template-<name>-start -->` / `<!-- template-<name>-end -->`; the init system strips these
  blocks plus any leftover markers. Keep new conditional content inside such markers.
- `CALIBRATION.md` records audits of template-vs-consumer deltas and their propagation rulings.
- Upstream-to-consumer sync is handled by the `template-sync.yml` and `reusable-template-sync.yml`
  workflows; `.templatesyncignore` lists local-only paths that sync must never clobber.

<!-- template-agents-template-only-end -->

## After init

Running `pnpm run init` personalizes this template into a standalone package: placeholders are
replaced, optional features are pruned, and template-only sections (including the template
development section above) are removed while the remaining agent guidance stays as-is.
