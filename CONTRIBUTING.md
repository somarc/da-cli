# Contributing

Thanks for helping improve `da-cli`.

## Local Setup

```bash
git clone https://github.com/somarc/da-cli.git
cd da-cli
npm ci
npm test
```

Run the CLI locally with:

```bash
node ./bin/da.js --help
```

## Pull Requests

Before opening a pull request:

- Run `npm test`
- Keep changes scoped to one behavior or documentation update
- Add or update tests for command behavior changes
- Update `README.md` when user-facing commands, flags, examples, or safety behavior change
- Mirror material agent-facing changes into `AGENTS.md`

## CLI Safety Rules

Write operations must remain dry-run by default. Any command that mutates DA, Helix, GitHub, local content state, or CDN state should require an explicit commit-style opt-in and should print a compact preflight before mutation.

## Release Process

Releases should use semantic versioning.

1. Update `package.json` and `package-lock.json` with the new version.
2. Update `CHANGELOG.md`.
3. Open and merge a pull request after CI passes.
4. Create a GitHub Release from a `vX.Y.Z` tag.
5. The publish workflow publishes `@somarc/da-cli` to npm.

The npm package is intended to be published from GitHub Actions with npm Trusted Publishing/OIDC and provenance, not with a long-lived local npm token.
