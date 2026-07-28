# Contributing to Local Memory MCP

We love your input! We want to make contributing to this project as easy and transparent as possible, whether it's:

- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features
- Becoming a maintainer

## Development Features

This project supports **mixed mode development**:
- **TypeScript**: Written in TS for type safety.
- **Native Modules**: Uses `better-sqlite3` and `sqlite-vec` which require native compilation.

## We Develop with GitHub Issues

We use GitHub Issues to track public bugs. Report a bug by
[opening a new issue](https://github.com/Beledarian/mcp-local-memory/issues).

## Pull Requests

1.  Fork the repo and create your branch from `main`.
2.  If you've added code that should be tested, add tests.
3.  If you've changed APIs, update the documentation.
4.  Ensure the authoritative test suite passes (`npm test`).
5.  Run the focused CLI verifier (`npm run test:cli`) when changing CLI routing.
6.  Run `npm run audit:recall` when changing retrieval against a representative
    database. This is a live diagnostic, not an isolated release gate.
7.  Ensure the TypeScript build passes (`npm run build`).
8.  When changing public tools, configuration, scoring, lifecycle behavior, or
    platform support, update the concise `README.md`, `docs/extended-guide.md`,
    the copy-ready prompts under `docs/`, and any affected extension
    documentation.

`npm run normalize:importance -- --db <path>` is dry-run by default. Applying
normalization requires both `--apply` and a non-existing `--backup <path>`.

## Native Windows ARM64 sqlite-vec

The checked-in `vendor/sqlite-vec/windows-arm64/vec0.dll` is built from the
checksum-pinned upstream v0.1.9 amalgamation. Rebuild it with:

```powershell
.\scripts\build-sqlite-vec-windows-arm64.ps1
```

This requires `npm install`, Visual Studio Build Tools with the ARM64 C++
component, and network access to the pinned upstream release archive. If the
binary changes intentionally, update its checksum in `src/db/client.ts`,
`vendor/sqlite-vec/README.md`, and `tests/packaging.test.ts`, then run the
native vector integration and package-extraction checks.

### License

By contributing, you agree that your contributions will be licensed under its MIT License.
