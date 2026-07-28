# MCP Extensions

This directory contains official extensions for the `mcp-local-memory` server. These extensions add specialized logic and tools that go beyond core hybrid search.

## Available Extensions

### 1. Soul Maintenance (`soul_maintenance.js`)

**Purpose**: Recalculates lifecycle importance from explicit reinforcement and
elapsed time.

- **Initial State**: New memories start with low importance (0.1).
- **Growth**: Explicit positive `reinforce_memory` events add a bounded,
  logarithmic boost. Passive recall is ignored.
- **Decay**: Importance decreases by a base `0.05` per average month since
  creation or the latest positive reinforcement.
- **Resilience**: Up to 20 explicit reinforcements slow the extension's decay
  calculation.
- **Bounds**: Non-immune results are clamped to `0.01..1`; database triggers
  cap all importance writes to `0..1`.
- **Immunization**: Tags `core`, `identity`, `value`, and `principle` set
  importance to `1` and skip decay.
- **Execution**: The pass runs once when the extension loads and whenever the
  `soul_maintenance` tool is called.

#### Logic formula:

- `confirmed = min(reinforcement_count, 20)`
- `boost = min(0.9, log2(confirmed + 1) / log2(21) * 0.9)`
- `decay = months_since_anchor * 0.05 / log2(confirmed + 2)`
- `importance = clamp(0.1 + boost - decay, 0.01, 1)`

---

## How to use
To enable these extensions, set the `EXTENSIONS_PATH` environment variable to this directory.

```bash
export EXTENSIONS_PATH=$(pwd)/extensions
```

The server discovers `.js` and `.ts` filenames, but the standard Node.js
runtime must be able to import the file directly. Use ESM `.js` for deployed
extensions; TypeScript source requires a separate runtime loader or compilation
to JavaScript.

An extension can export either:

- `handler` and `tool`, plus optional `init`; or
- a function whose name starts with `handle`, a tool definition ending in
  `_TOOL` or `Tool`, and optional `init`.

The packaged allowlist includes only `soul_maintenance.js`. Files placed beside
it in a development checkout are not automatically published.
