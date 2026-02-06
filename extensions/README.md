# MCP Extensions

This directory contains official extensions for the `mcp-local-memory` server. These extensions add specialized logic and tools that go beyond core hybrid search.

## Available Extensions

### 1. Soul Maintenance (`soul_maintenance.ts`)
**Purpose**: Manages the "biological lifecycle" of memories.
- **Initial State**: New memories start with low importance (0.1).
- **Growth**: Memories gain importance logarithmically as they are recalled.
- **Decay**: Memories decay linearly over time.
- **Resilience**: Frequent access slows down the decay rate.
- **Immunization**: Tags like `core`, `identity`, and `value` prevent decay, ensuring fundamental facts are never forgotten.

#### Logic formula:
- **Resilience**: `Decay = (Age * Rate) / log2(Access + 2)`
- **Growth**: `Importance = Start + log2(Access + 1) - Decay`

---

## How to use
To enable these extensions, set the `EXTENSIONS_PATH` environment variable to this directory.

```bash
export EXTENSIONS_PATH=$(pwd)/extensions
```

The server will automatically load all `.ts` or `.js` files in this directory and register their tools and startup hooks.
