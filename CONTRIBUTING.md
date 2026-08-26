# Contributing

## How to

For new features file an issue.\
For bugs, file an issue and optionally file a PR with a failing test.

### How to publish

Publishing is handled by [semantic release](https://github.com/semantic-release/semantic-release#readme) -
there shouldn't be any need to publish manually.

## Template Development

This section documents template development and only applies while developing the template itself; consumers get consumer-focused guidance via `README.md` and `AGENTS.md` after init.

### Key references

- **`AGENTS.md`** — authoritative guide for AI agents: project map, commands, conventions, and the template development section (auto-removed on consumer init).
- **`CALIBRATION.md`** — audits of template-vs-consumer deltas and their propagation rulings; consult before changing any file that ships to consumers.

### Sync helpers

- **`.templatesyncignore`** — lists consumer-owned paths that sync must never clobber. Add new local-only paths here when they should survive upstream pulls.
