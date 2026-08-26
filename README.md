<div align="center">

# Template for my Node Packages

[![npm version](https://img.shields.io/npm/v/package_name.svg)](https://www.npmjs.com/package/package_name)
<!-- template-jsr-badge-start -->

[![jsr Version](https://img.shields.io/jsr/v/package_name.svg)](https://jsr.io/package_name)
<!-- template-jsr-badge-end -->

[![CI](https://github.com/RebeccaStevens/template-typescript-node-package/actions/workflows/release.yml/badge.svg)](https://github.com/RebeccaStevens/template-typescript-node-package/actions/workflows/release.yml)
[![Coverage Status](https://codecov.io/gh/RebeccaStevens/template-typescript-node-package/branch/main/graph/badge.svg)](https://codecov.io/gh/RebeccaStevens/template-typescript-node-package)\
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)
[![GitHub Discussions](https://img.shields.io/github/discussions/RebeccaStevens/template-typescript-node-package?style=flat-square)](https://github.com/RebeccaStevens/template-typescript-node-package/discussions)
[![BSD 3 Clause license](https://img.shields.io/github/license/RebeccaStevens/template-typescript-node-package.svg?style=flat-square)](https://opensource.org/licenses/BSD-3-Clause)
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg?style=flat-square)](https://commitizen.github.io/cz-cli/)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg?style=flat-square)](https://github.com/semantic-release/semantic-release)

</div>

<!-- template-init-start -->

## Template Setup

`pnpm run init` compiles the init script on the fly (`build:init` → tsc → `node scripts/init.js`)
and then runs it. No separate build step is needed.

### npx

To create and initialize a new package:

```sh
npx @rebeccastevens/create-ts-pkg my-new-package
```

For advanced configuration (license selection, test suite, JSR, Renovate, Commitizen, and VS Code configuration toggles):

```sh
npx @rebeccastevens/create-ts-pkg my-new-package --advanced
```

### Cloned repository

```sh
pnpm run init
```

For advanced configuration:

```sh
pnpm run init -- --advanced
```

### Non-interactive init

Pass a JSON config file to skip prompts entirely — useful for CI or scripted setups:

```sh
pnpm run init -- --config config.json
pnpm run init -- -c config.json
pnpm run init -- --config=config.json
```

All three forms are equivalent; short flags `-c` and `-c=<file>` also work.

The config file is validated against [`scripts/init-config.schema.json`](./scripts/init-config.schema.json).
**Required keys:** `name`, `description`, `authorName`, `authorEmail`, `repoOwner`, `repoName`, `licenseType`.

| Key                 | Type    | Default          | Description                                          |
| ------------------- | ------- | ---------------- | ---------------------------------------------------- |
| `name`              | string  | _(required)_     | npm package name                                     |
| `description`       | string  | _(required)_     | Short package description                            |
| `authorName`        | string  | _(required)_     | Author name                                          |
| `authorEmail`       | string  | _(required)_     | Author email                                         |
| `repoOwner`         | string  | _(required)_     | GitHub user or org                                   |
| `repoName`          | string  | _(required)_     | GitHub repository name                               |
| `licenseType`       | enum    | _(required)_     | `BSD-3-Clause`, `MIT`, `Apache-2.0`, or `UNLICENSED` |
| `includeTidelift`   | boolean | author-dependent | Include Tidelift subscription references             |
| `includeTests`      | boolean | `true`           | Scaffold the test suite                              |
| `includeJsr`        | boolean | `true`           | Include JSR publishing configuration                 |
| `includeRenovate`   | boolean | `true`           | Include Renovate bot configuration                   |
| `includeCommitizen` | boolean | `true`           | Include Commitizen & Conventional Commits setup      |
| `includeVSCode`     | boolean | `true`           | Include `.vscode` workspace settings                 |
| `isPrivate`         | boolean | `false`          | Set `"private": true` in package.json                |

### Consumer onboarding checklist

After cloning the template repo:

1. **Set variables and secrets** (for automated sync via the reusable workflow):
   - Repository variable `TEMPLATE_SYNC_ENABLED` = `true`
   - Repository variable `TEMPLATE_APP_ID` — GitHub App ID for PR creation
   - Repository secret `TEMPLATE_APP_KEY` — private key for the same App
2. **Run init** — `pnpm run init` (interactive) or `pnpm run init -- --config <file>` (non-interactive).
3. **Verify the result** — inspect the initial commit; run `pnpm run lint` to confirm everything is clean.
4. **Sync PR expectations** — the `template-sync.yml` workflow opens a PR weekly (Monday 00:00 UTC) or on manual dispatch, gated on `TEMPLATE_SYNC_ENABLED`. The PR applies upstream template changes via squash-pull, restores consumer-owned files listed in `.templatesyncignore`, and regenerates the lockfile.
5. **Failed-init recovery** — init snapshots every touched path and rolls back byte-exact on failure. Only pre-existing uncommitted changes are at risk, so run from a clean tree.

This section will be automatically removed once template initialization completes.
<!-- template-init-end -->
<!-- template-donations-start -->

## Donate

[Any donations would be much appreciated](./DONATIONS.md). 😄
<!-- template-tidelift-start -->

### Enterprise Users

`package_name` is available as part of the [Tidelift Subscription](https://tidelift.com/funding/github/npm/package_name).

Tidelift is working with the maintainers of `package_name` and a growing network of open source maintainers
to ensure your open source software supply chain meets enterprise standards now and into the future.
[Learn more.](https://tidelift.com/subscription/pkg/npm-package_name?utm_source=npm-package_name&utm_medium=referral&utm_campaign=enterprise&utm_term=repo)
<!-- template-tidelift-end -->
<!-- template-donations-end -->

## Installation

### npm

```sh
# Install with npm
npm install package_name

# Install with pnpm
pnpm add package_name

# Install with yarn
yarn add package_name

# Install with bun
bun add package_name
```

<!-- template-jsr-install-start -->

### jsr

```sh
# Install in a node project
npx jsr add package_name

# Install in a deno project
deno add jsr:package_name

# Install in a bun project
bunx jsr add package_name
```

<!-- template-jsr-install-end -->
<!-- template-publishing-start -->

## Publishing (Post-Initialization)

When you are ready to publish your package:

1. Update `package.json` to set `"private": false`.
2. Configure **npm Trusted Publishing** (OIDC) at [npmjs.com](https://www.npmjs.com) to allow GitHub Actions to publish securely without an `NPM_TOKEN`.
3. If your repository is private, add a `CODECOV_TOKEN` repository secret for the coverage step to succeed.

<!-- template-publishing-end -->

<!-- template-sync-start -->

## Template Sync

### Automated sync (reusable workflow)

Consumers pin the upstream reusable workflow via the `sync-v1` tag. The workflow is gated on the `TEMPLATE_SYNC_ENABLED` repository variable — set it to `true` to opt in.

**Required for automated PRs:**

| Scope    | Name                    | Description                                            |
| -------- | ----------------------- | ------------------------------------------------------ |
| variable | `TEMPLATE_SYNC_ENABLED` | Must be `"true"` for sync to run                       |
| variable | `TEMPLATE_APP_ID`       | GitHub App ID (creates PRs that trigger downstream CI) |
| secret   | `TEMPLATE_APP_KEY`      | Private key for the same App                           |

> **Note:** PRs created with the default `GITHUB_TOKEN` do not trigger downstream CI.
> A GitHub App token is required so sync PRs run checks and are reviewable.
> There is no `GITHUB_TOKEN` fallback.

Once the `sync-v1` tag exists, the reusable ref in `template-sync.yml` should be
pinned to the full commit SHA (e.g. `sync-v1^{commit}`) rather than the mutable
tag — Renovate/bumps must update the pinned SHA.

<!-- template-sync-end -->
