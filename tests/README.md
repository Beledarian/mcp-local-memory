# Test layout

`*.test.ts` files are the authoritative release tests run by `npm test`.
They use assertions, isolated databases, and non-zero exit codes on failure.

The older `test_*.ts` files are retained as historical/manual diagnostics. They
are not release gates: several were written as console probes, use obsolete
import paths, or require optional native vector/model support.

Additional checks:

- `npm run test:cli` verifies the built-in CLI workflow.
- `npm run audit:recall` runs a live ranking diagnostic against the configured
  database; it is intentionally not part of the isolated release suite.
- `npm run smoke:mcp -- --db <path>` starts the compiled stdio server, writes a
  temporary sentinel, proves recall preserves lifecycle fields while recording
  bounded familiarity, proves explicit reinforcement is durable, and removes
  the sentinel.
- Add `--probe-only --probe-query "<query>"` for a lifecycle-preserving live
  ranking probe. It can write deduplicated familiarity telemetry.
- `npm pack --dry-run --json` runs `prepack`, shows the exact publish allowlist,
  and should include the prompt docs, the official extension, and the
  checksum-verified Windows ARM64 DLL while excluding arbitrary local
  extensions.
