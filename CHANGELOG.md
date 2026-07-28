# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.1] - 2026-07-29

### Fixed

- Prevented asynchronous LLM enrichment from creating orphan generated
  entities or relations after their source memory is forgotten. Post-embedding
  graph writes now recheck and attach provenance inside an immediate
  transaction.
- Explicitly creating an existing generated entity or relation now marks it as
  manually maintained, so forgetting the originating memory does not delete
  deliberately preserved graph knowledge.

### Added

- Added regression coverage for LLM enrichment racing with `forget` and for
  manual reaffirmation of generated graph knowledge.
- Added Node.js 22 GitHub Actions gates on Linux, Windows, and macOS.

## [2.0.0] - 2026-07-28

### Breaking changes

- Raised the minimum Node.js version to 22. Node.js 18 and 20 are already
  end-of-life and no longer receive upstream security fixes.
- Recall no longer raises stored importance, increments passive access count,
  or refreshes the decay anchor. Agents that relied on recall-driven
  consolidation must call `reinforce_memory` after confirmed use or correction.
- `MEMORY_SEMANTIC_WEIGHT` now controls overall retrieval relevance versus
  decayed importance, rather than selecting vector versus keyword scoring.

### Added

- Explicit, auditable `reinforce_memory` feedback with `used`, `important`,
  `irrelevant`, `incorrect`, `outdated`, and `restore` signals.
- Default suppression of outdated and incorrect memories, with
  `include_outdated=true` for explicit history searches.
- A dry-run-first importance normalization command that requires and verifies a
  SQLite backup before applying changes.
- A real stdio MCP smoke/probe command that verifies recall, reinforcement,
  cleanup, and lifecycle-preserving recall behavior.
- Additive `memory_recall_exposures` telemetry containing normalized query
  hashes rather than raw queries. The primary key deduplicates each
  memory/query/UTC-day exposure and cascades cleanup when a memory is forgotten.
- Native Windows ARM64 semantic search through a checksum-verified
  `sqlite-vec` v0.1.9 DLL, upstream licenses, provenance, and a reproducible MSVC
  build script.
- Authoritative isolated tests for scoring, lifecycle migration, privacy and
  provenance, MCP contracts, packaging, normalization, and vector integration.

### Changed

- Moved local embeddings to the maintained `@huggingface/transformers` package.
- Updated the source/runtime dependency resolution to
  `@huggingface/transformers` 4.2.0, ONNX Runtime 1.27.0, Sharp 0.35.3, and
  adm-zip 0.6.0.
- Changed the default relevance weight from `0.7` to `0.9`, limiting decayed
  importance to a mild 10% ranking contribution unless explicitly configured.
- Recall now merges semantic vector and FTS5 candidates instead of allowing one
  search path to suppress the other.
- Ranking uses bounded cosine similarity, reciprocal-rank evidence, whole-token
  coverage, proportional tag matching, time-decayed importance, relevance
  thresholds, and near-duplicate removal.
- `MEMORY_SEMANTIC_WEIGHT` remains backward compatible but now controls
  retrieval relevance versus importance rather than vector versus keyword
  search.
- Historical `access_count` no longer reinforces or stabilizes memories.
  Recall instead records bounded familiarity telemetry without changing
  importance, explicit reinforcement, lifecycle state, or decay timestamps.
- Recent distinct recall exposures contribute a saturating familiarity boost
  only after relevance gating. Defaults are a 30-day window, saturation at
  five exposures, and a maximum `0.03` headroom contribution; the hard
  configurable cap is `0.05`.
- Positive reinforcement is capped, cooldown-protected, and subject to
  diminishing returns. Database triggers cap importance writes to `0..1`.
- Memory writes now wait for embedding and archivist acknowledgement, including
  worker mode, before reporting success.
- Default context, recent-memory, clustering, and consolidation paths ignore
  memories explicitly marked outdated or incorrect.
- The official Soul Maintenance extension ships as runtime-loadable ESM
  JavaScript and uses explicit reinforcement rather than passive recall count.
- Agent prompts and operational documentation now describe actual initialization,
  WSL environment, privacy, scoring, lifecycle, extension, and packaging
  behavior.
- Split the landing documentation into a concise release-aware `README.md` and
  a packaged `docs/extended-guide.md` covering full configuration, scoring,
  migration, tools, operations, and platform details.

### Fixed

- Generic high-importance identity memories no longer bypass retrieval
  relevance or crowd specific recall results.
- Cosine distance is mapped across its full documented range and all final
  scores remain bounded.
- Compound identifiers such as `MEMORY_SEMANTIC_WEIGHT` contribute meaningful
  component tokens without substring false positives.
- `forget` cancels or removes derived auto-generated graph data without deleting
  manually maintained entities.
- MCP CLI task mutations return one valid protocol result instead of duplicate
  or malformed responses.
- FTS schema migrations backfill existing memories.
- Arbitrary local extensions and development-only artifacts are excluded from
  the npm package.

### Privacy and provenance

- Automatic graph entities and relations record provenance so memory deletion
  removes only generated knowledge.
- Optional LLM data flow is documented as crossing the configured
  `OLLAMA_URL` boundary; local storage and model-download behavior are stated
  explicitly.

### Migration notes

- Back up `MEMORY_DB_PATH` before upgrading.
- Existing databases automatically gain explicit reinforcement, lifecycle, and
  provenance fields plus the additive `memory_recall_exposures` table.
  Historical importance values are clamped to `0..1`; existing memory rows are
  not rewritten for familiarity.
- Installations affected by passive-access popularity can preview
  `npm run normalize:importance -- --db <path>` and apply only with explicit
  `--apply --backup <new-path>` arguments.
- WSL users should place scoring variables inside the Linux command environment;
  Windows-side MCP environment entries may not reach the Linux process.
[2.0.1]: https://github.com/Beledarian/mcp-local-memory/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/Beledarian/mcp-local-memory/compare/v1.1.0...v2.0.0
