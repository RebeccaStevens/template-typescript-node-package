# Calibration Audit — deepmerge-ts vs template-typescript-node-package

- Date: 2026-08-23
- Template side: worktree `/home/rebec/dev/.worktrees/template-typescript-node-package` @ `7b51545` (`chore/template-platform`)
- Consumer side: `/home/rebec/dev/deepmerge-ts` (working tree, untouched)
- Method: file-by-file diff of the areas named in Chunk A3; consumer-repo spot-checks for PROPAGATE evidence.
- Legend:
  - **PROPAGATE** — repo-agnostic improvement; evidence cites ≥1 other consumer repo where it also applies.
  - **REPO-SPECIFIC** — coupled to deepmerge-ts runtime/build/publish surface; do not propagate.
  - **EXPERIMENTAL** — preview tech; never propagates.
  - **PENDING** — subject to one of the three calibration rulings below.
  - **NO DELTA** — files identical.

## package.json

| Delta | Classification | Evidence / Notes |
| --- | --- | --- |
| exports map uses `.mjs`/`.d.mts` (dm) vs `.js`/`.d.ts` (tpl) | REPO-SPECIFIC | dm publish surface; tpl dual `.cjs`/`.js` naming is its own convention |
| `build` = wireit (tpl) vs direct `rimraf && rollup` (dm); tpl adds `build:force` | PENDING → ruling 1 (wireit-vs-direct) | see Recommendations |
| `lint:attw` script + `@arethetypeswrong/cli` dep (tpl only) | PENDING → ruling 2 (attw placement) | eslint-plugin-functional already ships `lint:attw` + `lint-attw.yml` |
| `benchmark`, `benchmark:types`, `benchmark:types:baseline`, `build:check`, `test:types` (tsd), `typecheck:consumer-ts7` scripts (dm only) | REPO-SPECIFIC | benchmark harness + tsd type-tests + TS7 consumer probe are dm features (tsd also used by uom-types/transpose-array, so *adoption elsewhere* is possible, but the scripts reference dm-only `scripts/*.ts`) |
| `init`, `prepublishOnly` scripts + `bin` (tpl only) | TEMPLATE-SPECIFIC (n/a) | scaffolding entry points; not a consumer delta |
| Dep drift, tpl newer: `@commitlint/*` 21.2.2, `knip` 6.32.2, `lint-staged` 17.3.0, `publint` 0.3.23, `rollup` 4.62.4, `eslint` 10.8.1 | PROPAGATE (to dm) | routine sync; consumers pin independently (is-immutable-type/uom-types/ts-declaration-location all on older lines) — aligning forward is repo-agnostic |
| Dep drift, dm newer: `@rebeccastevens/eslint-config` 4.0.2, `eslint-plugin-jsdoc` 64.2.1, `eslint-plugin-unicorn` 73.0.0, `@types/node` 22→(tpl 24), `packageManager` pnpm@11.21.0 | PROPAGATE (into template) | eslint-plugin-functional already on unicorn 73.0.0 + jsdoc 64.2.1 — proves fleet compatibility of the newer majors |
| `engines.node`: tpl `>=24.0.0` vs dm `>=16.9.0` | REPO-SPECIFIC | dm publishes with a wide runtime-support floor; template targets the dev-platform floor. Consumers vary (uom-types >=18, epf >=20, several none) — per-repo policy |
| `files` array: tpl ships config/tooling files, dm ships `dist/` + metadata only | REPO-SPECIFIC | each repo's publish surface; template intentionally vendors its own config |
| dm-only deps: `tsd`, `vite-tsconfig-paths` | REPO-SPECIFIC | tied to dm `test:types` and its vitest plugin choice (template replaced plugin with builtin `resolve.tsconfigPaths`; eslint-plugin-functional already uses the builtin form) |
| dm-only deps: `eslint-plugin-command`, `eslint-plugin-pnpm`, `eslint-plugin-security`, `eslint-plugin-unused-imports` | PROPAGATE (candidate, into template) | eslint-plugin-functional carries all four — repo-agnostic lint coverage; adoption order left to maintainer |
| `typescript`: tpl plain `6.0.3` vs dm `npm:@typescript/typescript6@6.0.2` + `@typescript/native: npm:typescript@7.0.2` | EXPERIMENTAL (alias+native part) / PENDING → ruling 3 (policy) | see Recommendations |

## rollup.config.ts

NO DELTA — byte-identical (incl. `src/tsconfig.build.json`, also identical).

## vitest.config.ts

| Delta | Classification | Evidence / Notes |
| --- | --- | --- |
| tpl builtin `resolve.tsconfigPaths: true` vs dm `vite-tsconfig-paths` plugin | PROPAGATE (tpl → dm) | eslint-plugin-functional uses the builtin form; drops a dev dep |
| `include`: tpl `./**/*.test.ts` vs dm `./tests/**/*.test.ts`; coverage excludes `src/types` (dm) | REPO-SPECIFIC | mirrors each repo's test layout / internal type dirs |

## eslint.config.js

| Delta | Classification | Evidence / Notes |
| --- | --- | --- |
| dm inline rule blocks: unicorn/jsdoc suppressions, `ts/no-explicit-any` for src, test/benchmark glob relaxations, extra ignores (`tests/modules`, `tests/types`, `tests/consumer-ts7`, `benchmark/data.json`) | REPO-SPECIFIC | codebase-specific suppressions coupled to dm sources/tests |
| `functional: false` (dm) vs `"recommended"` (tpl); `json: true` vs `jsonc: true` | REPO-SPECIFIC | deliberate dm opt-out; shared-config mode naming differs per repo preference |

## knip.jsonc

| Delta | Classification | Evidence / Notes |
| --- | --- | --- |
| dm explicit `entry: ["src/index.ts!"]`, `ignore: benchmark/types/scenarios/**`, `ignoreDependencies: [..., "tsc-files"]` | REPO-SPECIFIC | entry graph + benchmark exclusions are dm-shaped (uom-types likewise declares multi-entry explicitly — pattern is per-repo, not a template fix) |

## cspell.config.yml

| Delta | Classification | Evidence / Notes |
| --- | --- | --- |
| tpl extra ignorePaths: `.wireit`, `.markdownlint-cli2.jsonc` | PROPAGATE (tpl → dm) | `.markdownlint-cli2.jsonc` exists in every consumer incl. dm; `.wireit` rides ruling 1. No consumer carries these yet — harmless ignore-path additions |

## tsconfig.json (root)

| Delta | Classification | Evidence / Notes |
| --- | --- | --- |
| tpl enables `erasableSyntaxOnly`; dm comments it out | PROPAGATE (tpl → dm, when TS policy allows) | eslint-plugin-functional, is-immutable-type, uom-types, ts-declaration-location all enable it at root |
| dm `exclude: ["benchmark", "tests/consumer-ts7"]`; tpl none | REPO-SPECIFIC | excludes exist only because of dm-only dirs |
| dm explicit `target: "esnext"`; tpl omits target | PENDING → ruling 3 (TS policy) | folded into TS-policy decision |

## src/tsconfig.json

| Delta | Classification | Evidence / Notes |
| --- | --- | --- |
| tpl `isolatedDeclarations: true` + `module: "preserve"`; dm comments out isolatedDeclarations, sets `erasableSyntaxOnly: false` | PROPAGATE candidate (tpl → dm) with caveat | 5 consumers enable isolatedDeclarations (eslint-plugin-functional, is-immutable-type, uom-types, effect-uom, ts-declaration-location); dm re-enablement requires source fixes (declaration emit constraints) — flag as follow-up, not mechanical |
| dm `erasableSyntaxOnly: false` in src build scope | REPO-SPECIFIC | required by dm source patterns today |

> TODO(dm): isolatedDeclarations propagation blocked until declaration-emit source fixes land in deepmerge-ts.

## .github/workflows

| Delta | Classification | Evidence / Notes |
| --- | --- | --- |
| `concurrency` + `cancel-in-progress` on every workflow (tpl) — missing in all dm workflows | PROPAGATE | eslint-plugin-functional has concurrency blocks across build/lint-js/lint-knip/lint-spelling/lint-yaml/etc.; is-immutable-type & ts-declaration-location mostly lack them (also candidates) |
| `done-label.yml` / `stale.yml` explicit `permissions: issues+pull-requests: write` (tpl) | PROPAGATE | eslint-plugin-functional done-label.yml carries the permissions block; is-immutable-type/uom-types/ts-declaration-location lack it |
| `sync-labels.yml` explicit `issues: write` (tpl) | PROPAGATE | same fleet pattern as above (epf) |
| `semantic-pr.yml` typed `types:` list + `subjectPattern` (no leading uppercase) + headerPattern correspondence (tpl) | PROPAGATE | eslint-plugin-functional, is-immutable-type, uom-types, ts-declaration-location all carry `subjectPattern` |
| `build.yml` extra `- run: pnpm run lint:package` step (tpl) | PROPAGATE | eslint-plugin-functional build.yml runs lint:package post-build |
| `test-js.yml`: name `Test JS` + `test:js-run` (tpl) vs name `Test` + `test:js` (dm) | PROPAGATE | is-immutable-type & uom-types name it "Test JS"; eslint-plugin-functional runs `pnpm test:js-run` |
| `release.yml`: OIDC Trusted Publishing comment instead of `NPM_TOKEN` secret (tpl) | PROPAGATE (ops-prereq: configure Trusted Publisher first) | eslint-plugin-functional release.yml already uses `id-token: write` |
| `release.yml` needs-list gains `lint_yaml` + `lint_attw`; job key `typecheck` vs dm `type_check` (tpl) | PROPAGATE | bundles with lint-yaml/lint-attw adoption (see those rows); job-key rename is cosmetic alignment |
| tpl-only `lint-yaml.yml` workflow | PROPAGATE | 7 of 8 spot-checked consumers ship lint-yaml.yml (all but transpose-array); dm has `lint:yaml` scripts but no workflow — gap |
| tpl-only `lint-attw.yml` workflow | PENDING → ruling 2 | eslint-plugin-functional already ships lint-attw.yml |
| tpl-only `template-sync.yml` | PROPAGATE | every spot-checked consumer except transpose-array ships template-sync.yml; dm lacks it despite being template-derived |
| dm-only `benchmark-runtime.yml`, `benchmark-types.yml`, `test-types.yml` | REPO-SPECIFIC | benchmark + tsd type-test CI, dm-only features (uom-types has its own test-types.yml — adoption pattern exists but content is dm-coupled) |

## .releaserc.yml

| Delta | Classification | Evidence / Notes |
| --- | --- | --- |
| dm adds `@sebbo2002/semantic-release-jsr` plugin + channel-aware `releasedLabels` (`Status: Released on Next`) | PROPAGATE (dm → template) — APPLIED | template now ships the plugin in `.releaserc.yml` (plugins list, after `@semantic-release/npm`); the init-time insertion of the same entry is guarded so repeat runs cannot duplicate it; the channel-aware `releasedLabels` variant remains dm-only |

## husky / lint-staged

NO DELTA — `.husky/pre-commit`, `.husky/commit-msg`, `.lintstagedrc.yml`, `.commitlintrc.cjs` identical (dm `.husky/_` is generated runtime state).

---

## Pending Calibration Decisions — Recommended Rulings

## 1. Build orchestration: wireit vs direct rollup

**Ruling: keep wireit as the template standard; defer consumer propagation one cycle.**
- Template keeps `build` = wireit (incremental caching keyed on src/config inputs) with `build:force` as the clean-build escape hatch — already coherent with `.wireit` cspell ignore.
- No consumer uses wireit yet (0/8 spot-checked) → zero fleet breakage risk if deferred; deepmerge-ts stays direct-rollup until the template path soaks.
- Revisit after Chunk B/C validation; propagation then lands together with the `.wireit` cspell ignore row above.

## 2. attw: inside lint chain vs separate

**Ruling: separate workflow; remove `lint:attw` from the aggregate `lint` script.**
- attw requires a built `dist`; the aggregate `lint` chain runs without a build, so keeping it there guarantees failure-order coupling (or forces a redundant build into every lint run).
- Dedicated `lint-attw.yml` (checkout → prepare → build → attw) gates releases correctly via the release needs-list; eslint-plugin-functional already proves this shape in the fleet.
- Template currently has BOTH (script in `lint` chain AND workflow) — drop the script from the chain, keep the workflow.

## 3. TypeScript policy: plain 6.x vs typescript6 alias vs alias + native7-preview

**Ruling: template stays plain `typescript` 6.x stable; aliases never leave deepmerge-ts.**
- Plain 6.x is what the template validates and what consumers inherit by default — keeps knip/dedupe/publint hygiene clean (no npm-aliased identity skew).
- `npm:@typescript/typescript6` alias + `@typescript/native` (TS 7 preview) in dm are **EXPERIMENTAL** by definition: they exist to let dm probe TS7 behavior (`typecheck:consumer-ts7`) against its own suite. Never propagate; revisit only when TS 7 goes stable and the template adopts it deliberately.
- Root-tsconfig `target` question resolves with this: template's omitted target (module-driven default) stands; dm's explicit `target: "esnext"` is a dm-local pin.

---

## Ignore Baseline Audit

Comparison of the template's root `.templatesyncignore` baseline against the consumer lists in
`eslint-config-rebeccastevens` and `eslint-plugin-functional` (read from `/home/rebec/dev/<name>/`).

Consumer-only extensions (paths ignored by consumers but absent from the template baseline):

| Path | eslint-config-rebeccastevens | eslint-plugin-functional | Note |
| --- | --- | --- | --- |
| `vitest.config.ts` | ✓ | ✓ | consumer-local test config |
| `eslint.config.js` | ✓ | ✓ | consumer-local lint config |
| `knip.jsonc` | ✓ | ✓ | consumer-local knip config |
| `cspell.config.yml` | ✓ | ✓ | consumer-local spelling config |
| `.github/codecov.yml` | ✓ | ✓ | consumer-local codecov |
| `.github/renovate.json` | ✓ | ✓ | consumer-local renovate config |
| `.github/workflows/test-js.yml` | ✓ | ✓ | consumer-local test workflow |
| `.gitignore` | ✓ | — | rs-config only |
| `.czrc` | — | ✓ | epf only |
| `CONTRIBUTING.md` | — | ✓ | epf only |
| `rollup.config.ts` | — | ✓ | epf only |
| `tsconfig.json` (root) | — | ✓ | epf only |
| `.github/labels.yml` | — | ✓ | epf only |
| `.github/actions/prepare/action.yml` | — | ✓ | epf only |
| `.github/workflows/release.yml` | — | ✓ | epf only |
| `.github/workflows/semantic-pr.yml` | — | ✓ | epf only |

Ruling: these extensions stay consumer-local per plan R-b; they are NOT promoted into the template
baseline this cycle. The template baseline itself is unchanged in this audit.
