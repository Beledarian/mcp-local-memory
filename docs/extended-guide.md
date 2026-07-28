# Local Memory MCP Server — Extended Guide

This guide covers the complete configuration, memory lifecycle, MCP surface,
extensions, architecture, testing, and platform-specific operations. For the
short installation path, return to the [README](../README.md).

## Contents

- [Installation and setup](#installation-and-setup)
- [Configuration](#configuration)
- [Reliable memory operations](#reliable-memory-operations)
- [Importance normalization](#one-time-importance-normalization)
- [Extensions and agent prompts](#official-extensions)
- [Tools and resources](#tools-for-agents)
- [Recall scoring and decay](#hybrid-recall-scoring)
- [Architecture and source testing](#system-architecture)
- [Compatibility and troubleshooting](#compatibility-and-troubleshooting)

A lightweight, privacy-first, "Zero-Docker" memory server for AI agents. This server provides semantic search, keyword search, and a knowledge graph—all running natively on your local machine.

![Antigravity Agent Demo](image.png)

## Key Features

-   **Hybrid Search**: Semantic (Vector) search + Keyword (FTS5) search.
-   **Local Embeddings**: Uses `transformers.js` (ONNX) to run `all-MiniLM-L6-v2` locally on your CPU.
-   **Knowledge Graph**: Structured `entities` and `relations` tables to link facts.
-   **Advanced Graph Traversal**: Recursive queries to find "friends of friends" (Deep Graph).
-   **Mixed Clustering**: "Gravity Center" clustering that groups relevant Memories and Entities together (#6.1).
-   **The Archivist**: Configurable "Auto-Ingestion" strategies for automatic graph building.
-   **Privacy-First**: Memory data is stored in your local SQLite database. No
    cloud API is required; optional LLM-backed features send their input only
    to the `OLLAMA_URL` endpoint you configure.
-   **Resource Efficient**: ~50MB - 200MB RAM usage. Optimized with `Float32Array` buffers.
-   **Enhanced NLP Extraction**: Extracts complex concepts ("optimized WGSL"), adjectives ("pragmatic"), entities, and relations with robust pattern matching.
-   **Time Tunnel**: Natural language date querying (e.g., "last week", "in 2025") for temporal recall.
-   **Todo System**: Integrated task management with automatic context injection and memory archival.
-   **Entity Observations**: Normalized storage with "Smart Append" for evolving entity knowledge.

## Cross-Agent Shared Context

A core advantage of this server is its ability to serve as a **centralized long-term memory pool** for all your AI workflows.

Unlike standard agent memories that are ephemeral or locked to a single session, this server allows multiple MCP-enabled agents (e.g., Claude Code, IDE extensions, or custom CLIs) to:
- **Share Knowledge**: Information learned by one agent is instantly accessible to another.
- **Maintain Consistency**: Ensure all your AI tools operate from the same established facts and entity history.
- **Persistent Intelligence**: Your interaction history matures over time into a robust, structured knowledge base available across your entire local ecosystem.

---

## Installation and Setup

### Prerequisites
-   **Node.js**: v22 or higher. Use a currently supported LTS release.
-   **Build Tools**: Python and C++ build tools may be required when
    `better-sqlite3` has no matching native prebuild.

> [!IMPORTANT]
> **Windows Users**: You may need to have C++ Build Tools installed.
> Install "Desktop development with C++" via Visual Studio Installer.
> *Failure to do this can result in `gyp` errors during installation.*
>
> **Windows ARM64:** native semantic search is supported through a bundled,
> verified ARM64 build of upstream `sqlite-vec` v0.1.9. WSL2 remains supported
> as an alternative deployment and recovery path.

### Method 1: Use via NPX (Recommended)

`npx` is the easiest package-based setup for MCP clients.

**Add to your MCP Configuration:**

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@beledarian/mcp-local-memory@2"],
      "env": {
        "ARCHIVIST_STRATEGY": "nlp"
      }
    }
  }
}
```

### Method 2: Install via NPM

Global installation provides the `memory` and `mcp-local-memory` commands:

```bash
npm install -g @beledarian/mcp-local-memory@2

# Usage
memory --help
```

**Add to your MCP Configuration:**

```json
{
  "mcpServers": {
    "memory": {
      "command": "mcp-local-memory",
      "env": {
        "ARCHIVIST_STRATEGY": "nlp"
      }
    }
  }
}
```

### Method 3: Install from Source

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/Beledarian/mcp-local-memory.git
    cd mcp-local-memory
    ```
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Build the project**:
    ```bash
    npm run build
    ```
4.  **Run the server**:
    ```bash
    npm start
    ```

---

## Configuration

Control the server behavior via environment variables:

| Variable | Options | Default | Description |
| :--- | :--- | :--- | :--- |
| `ARCHIVIST_STRATEGY` | `passive`, `nlp`, `llm` | `nlp` | Control automatic entity extraction behavior. `passive`=disabled, `nlp`=free offline extraction, `llm`=AI-powered extraction (~200 tokens per `remember_fact` call). Can be comma-separated (e.g., `nlp,llm`). |
| `MEMORY_DB_PATH` | Path to DB file | `~/.memory/memory.db` | Location of the SQLite database. |
| `CONTEXT_WINDOW_LIMIT` | Integer | `2500` | Approximate token budget for `memory://current-context` (implemented as 4 characters per token). |
| `CONTEXT_MAX_ENTITIES` | Integer | `10` | Max high-importance entities in context. |
| `CONTEXT_MAX_MEMORIES` | Integer | `10` | Max recent memories in context. |
| `OLLAMA_URL` | URL string | `http://localhost:11434/api/generate` | Full generation endpoint used by the optional LLM archivist, consolidation, and cluster labeling paths. |
| `ARCHIVIST_LANGUAGE` | Language code | `en` | Language hint for the offline NLP archivist. Non-English modes are accepted but have reduced extraction accuracy. |
| `USE_WORKER` | `true`, `false` | `false` | Run Archivist in a worker thread. Tool completion still waits for the worker acknowledgement so writes are durable. |
| `ENABLE_CONSOLIDATE_TOOL` | `true`, `false` | `false` | Enable the `consolidate_context` tool for retrospective memory extraction. |
| `TAG_MATCH_BOOST` | Float | `0.15` | Score boost for exact tag matches in `recall` results. Higher = stronger tag priority. |
| `MEMORY_HALF_LIFE_WEEKS` | Float | `4.0` | Weeks until memory importance decays to 50%. Longer = slower decay. |
| `MEMORY_CONSOLIDATION_FACTOR` | Float | `1.0` | Strength of explicit reinforcement-based consolidation. Passive recall does not affect it. |
| `MEMORY_SEMANTIC_WEIGHT` | Float `0..1` | `0.9` | Backward-compatible name for retrieval relevance weight (semantic/lexical) versus decayed importance. |
| `MEMORY_KEYWORD_COVERAGE_BOOST` | Float `0..1` | `0.15` | Additional bounded boost for memories covering more meaningful query terms. |
| `MEMORY_MIN_RELEVANCE` | Float `0..1` | `0.55` | Abstain from returning candidates below this retrieval-relevance threshold. Importance cannot bypass it. |
| `MEMORY_SEMANTIC_ONLY_MIN_RELEVANCE` | Float `0..1` | `0.75` | Stronger threshold for long queries when a candidate has weak exact-token coverage. |
| `MEMORY_DEDUP_SIMILARITY` | Float `0.5..1` | `0.9` | Token-set similarity at which near-identical recall results are collapsed. |
| `MEMORY_RECALL_FAMILIARITY_MAX_BOOST` | Float `0..0.05` | `0.03` | Maximum familiarity contribution for relevant memories. Exposure is deduplicated per memory, normalized-query hash, and UTC day. Set to `0` to disable recording and scoring. |
| `MEMORY_RECALL_FAMILIARITY_WINDOW_DAYS` | Float `1..365` | `30` | Rolling UTC-day window used for familiarity exposure counts. |
| `MEMORY_RECALL_FAMILIARITY_SATURATION` | Float `1..100` | `5` | Exposure count at which the bounded familiarity curve reaches about 63% of its maximum. |
| `EXTRACT_COMPLEX_CONCEPTS` | `true`, `false` | `true` | Enable extraction of modifier+noun phrases (e.g., "optimized WGSL"). Set to `false` to disable. |
| `CONTEXT_TODO_LIMIT` | Integer | `5` | Max pending todos shown in `memory://current-context`. |
| `EMBEDDING_CONCURRENCY` | Integer | `5` | Max concurrent embedding operations for `remember_facts`. Higher values = faster batch processing but more CPU/memory usage. |
| `EXTENSIONS_PATH` | Path to directory | (none) | Optional path to load custom tool extensions from external directory. Allows adding private/experimental tools without modifying the codebase. |



### Codex + WSL2

Environment entries attached to the Windows `wsl.exe` process are not a
reliable way to configure the Linux child. Put the variables inside the Linux
command so the scorer actually receives them:

```toml
[mcp_servers.memory]
command = "wsl"
args = [
  "bash",
  "-lc",
  "cd ~/mcp-local-memory && exec env MEMORY_DB_PATH=/home/username/.memory/memory.db EXTENSIONS_PATH=/home/username/.memory/extensions ARCHIVIST_STRATEGY=nlp ARCHIVIST_LANGUAGE=en MEMORY_HALF_LIFE_WEEKS=4.0 MEMORY_CONSOLIDATION_FACTOR=1.0 MEMORY_SEMANTIC_WEIGHT=0.9 MEMORY_MIN_RELEVANCE=0.55 MEMORY_SEMANTIC_ONLY_MIN_RELEVANCE=0.75 MEMORY_DEDUP_SIMILARITY=0.9 MEMORY_RECALL_FAMILIARITY_MAX_BOOST=0.03 MEMORY_RECALL_FAMILIARITY_WINDOW_DAYS=30 MEMORY_RECALL_FAMILIARITY_SATURATION=5 TAG_MATCH_BOOST=0.15 USE_WORKER=false node dist/index.js"
]
```

Replace `/home/username` with the Linux home used by the distro. This remains a
supported setup when you prefer Linux tooling or already keep the database in
WSL.

To enable AI-powered entity extraction, importance scoring, and auto-labeling,
run [Ollama](https://ollama.com/) locally.

The first semantic-search use may download the local
`all-MiniLM-L6-v2` model if it is not already cached. Memory text and embeddings
remain in the configured SQLite database. If `OLLAMA_URL` points at a remote
host, `llm` strategy input is sent to that host.

### Archivist Strategies (`ARCHIVIST_STRATEGY`)
You can combine multiple strategies by separating them with a comma (e.g. `nlp,llm`).

-   **`passive`**: Manual only. The server waits for the Agent to call tools.
-   **`nlp`**: **(Open Source / Offline)** Uses the `compromise` library to extract entities locally. Very fast, but less comprehensive.
-   **`llm`**: **(Ollama / Artificial Intelligence)** Sends text to a local LLM (e.g., Llama 3) for deep understanding, relation extraction, and importance scoring. Requires running Ollama.

---

## Reliable Memory Operations

Memory text is inserted transactionally, then embedding and archivist work
finishes before the tool acknowledges completion. This prevents a successful
response from racing with `forget` or process shutdown.

- **`remember_fact`** waits for its derived writes.
- **`remember_facts`** processes derived writes in bounded parallel batches.
- **`EMBEDDING_CONCURRENCY`** controls batch concurrency (default `5`, bounded
  to `1..32`).

### Natural Memory Evolution

Recall builds lightweight familiarity without rewriting stored importance or
the decay anchor. It records a SHA-256 hash of the normalized query for each
returned active memory, deduplicated to one exposure per query and UTC day.
Recent distinct exposures give frequently accessed, relevant memories a
saturating familiarity contribution capped at `0.03` by default.

The relevance threshold is still applied before familiarity affects ranking.
Exposures older than the configured 30-day window are ignored and are pruned
during a later qualifying familiarity write. Setting
`MEMORY_RECALL_FAMILIARITY_MAX_BOOST=0` disables scoring and future recording
but does not delete previously stored exposure rows.

After a memory genuinely helps downstream work, agents can call
`reinforce_memory`; confirmed-use counts then slow temporal decay through the
consolidation factor.

Positive reinforcement has a one-hour duplicate cooldown, seven-day
diminishing returns, and cannot raise importance above `0.95`. Negative feedback
can lower importance immediately. Every feedback event is auditable in
`memory_feedback`. All writers, including extensions, are database-capped to
importance `0..1`.

Memories marked `outdated` or `incorrect` remain stored for audit/history but
are suppressed from recall, recent-context resources, clustering, and
consolidation deduplication by default. Use `include_outdated: true` for an
explicit history search, or `restore` to make a memory active again.

### One-Time Importance Normalization

Older releases increased `importance` and `access_count` whenever recall
returned a memory. To reset that historical popularity signal without deleting
memory content, first stop every process writing to the database and preview:

```bash
npm run normalize:importance -- --db ~/.memory/memory.db
```

Apply requires a new, explicit backup path and refuses to overwrite it:

```bash
npm run normalize:importance -- \
  --db ~/.memory/memory.db \
  --baseline 0.5 \
  --apply \
  --backup ~/.memory/backups/memory-before-importance-reset.db
```

The command verifies the SQLite backup before writing, normalizes stored
importance to the chosen `0..1` baseline, clears legacy passive-access state,
and preserves content, IDs, tags, embeddings, graph links, and existing
`memory_feedback` audit rows.

### Official Extensions

This package includes first-party extensions to enhance memory management:

1.  **Soul Maintenance** (`extensions/soul_maintenance.js`): Implements a
    startup and on-demand lifecycle pass based on explicit reinforcement and
    time since creation or reinforcement. Tags `core`, `identity`, `value`, and
    `principle` are immune. Passive recall is ignored.

### Community Extensions

1.  **Theme DB Extension** ([GitHub](https://github.com/Beledarian/theme-db-extension) | [npm](https://www.npmjs.com/package/theme-db-extension)): Adds theme-separated memory databases to isolate contexts for different projects or topics.
    - **Install**: Run `npx theme-db-extension install` to automatically copy the tools to your `~/.memory/extensions` directory.

Extensions are opt-in. Copy the desired module into a stable directory and set
`EXTENSIONS_PATH` to that directory:

```bash
mkdir -p ~/.memory/extensions
cp ./extensions/soul_maintenance.js ~/.memory/extensions/
export EXTENSIONS_PATH="$HOME/.memory/extensions"
```

**Setup:**
1. Create a stable directory for extensions.
2. Add runtime-loadable JavaScript modules with custom tools.
3. Set `EXTENSIONS_PATH` to its absolute path.
4. Restart the server

**Extension Format:**
```javascript
// my-extensions/my_tool.js
export function handleMyTool(db, args = {}) {
    // Your tool logic here
    return { result: "Custom tool output" };
}

export const MY_TOOL_TOOL = {
    name: "my_tool",
    description: "Description of what your tool does",
    inputSchema: {
        type: "object",
        properties: {
            // Define input parameters
        }
    }
};
```

**Benefits:**
- Keep experimental/private tools separate from the main codebase
- No need to rebuild or modify source code
- Easy to version control your extensions independently
- Perfect for personal customizations


---

## Recommended System Prompt

For effective agent interaction with this memory server, we recommend using a detailed system prompt.

- **Quick Start**: See [example_instructions.md](example_instructions.md)
- **Comprehensive Rules**: See [detailed_prompt.md](detailed_prompt.md)

---

## Tools for Agents

The server exposes the following MCP tools. Saving should be selective:
preferences, decisions, durable project facts, and reusable findings are good
candidates; transient chatter and unverified guesses are not.

### Memory Management
-   **`remember_fact(text, tags?)`**: Saves one durable, scoped fact.
    - **Automatic Entity Extraction**: Extracts entities and relations using configured `ARCHIVIST_STRATEGY` (**NLP=free, LLM=~200 tokens per call**)
-   **`remember_facts(facts)`**: Save multiple distinct facts at once. Use this to batch saves and reduce latency.
    - **Input**: `{ facts: [{ text: "...", tags?: [...] }] }`
-   **`recall(query, limit?)`**: Search for relevant past entries via Vector or FTS search.
    - **Hybrid retrieval**: Vector and FTS5 candidates are fetched
      independently and merged.
    - **Time recall**: Natural-language dates such as `yesterday`, `last week`,
      and `in 2025` are inferred from the query. Use ISO `startDate` and
      `endDate` for an explicit range.
    - **Lifecycle-preserving**: Recall never changes importance, reinforcement
      count, lifecycle state, or the decay anchor.
    - **Bounded familiarity**: Active results record hashed, daily-deduplicated
      query exposure. This can add at most `0.03` by default after relevance
      gating; it is not reinforcement.
    - **Abstention**: Weak results below `MEMORY_MIN_RELEVANCE` are omitted.
    - **Deduplication**: Near-identical results do not crowd the context window.
    - **Lifecycle filter**: Outdated/incorrect results are hidden unless
      `include_outdated=true`.
-   **`reinforce_memory(memory_id, signal, reason?)`**: Write explicit, auditable feedback after evaluating a memory.
    - `used`: the memory genuinely contributed to downstream work.
    - `important`: the memory was explicitly identified as durable.
    - `irrelevant`: the result was off-topic for the query.
    - `incorrect`: the memory is false and is suppressed from default recall.
    - `outdated`: the memory was superseded and is suppressed but retained.
    - `restore`: make an outdated/incorrect memory active again.
-   **`list_recent_memories(limit?)`**: View the latest context.
-   **`forget(memory_id)`**: Delete a specific entry.
-   **`export_memories(path)`**: Backup all data to a JSON file.

### Knowledge Graph
-   **`create_entity(name, type, observations?)`**: Manually define an entity.
    If the entity already exists or closely matches an existing name,
    observations are appended instead of creating a duplicate.
-   **`delete_observation(entity_name, observations)`**: Remove specific invalid facts from an entity.
-   **`create_relation(source, target, relation)`**: Link two entities with a
    directional predicate. Missing endpoints are created as `Unknown`
    entities.
-   **`delete_relation(source, target, relation)`**: Delete a specific link between entities.
-   **`delete_entity(name)`**: Delete an entity **and all its relations, observations, and embeddings** (Cascade Delete).
-   **`update_entity(current_name, new_name?, new_type?)`**: Rename an entity or change its type. Relations update automatically.
-   **`read_graph(center?, depth?, json?)`**: Without a center, return a graph
    overview. With a center, return its observations, directional relations,
    related memories, and either direct neighbors (`depth=1`) or one additional
    hop (`depth>1`). Text output includes a Mermaid graph; `json=true` returns
    nodes, edges, and related memories.
-   **`cluster_memories(k?)`**: Group both memories and entities into semantic
    topics when embeddings are available.

Saved facts can populate the graph automatically through the configured
archivist:

- `passive` leaves entity and relation creation to the agent;
- `nlp` performs local extraction;
- `llm` asks the configured `OLLAMA_URL` to extract structured knowledge.

Automatically derived memory-to-entity and memory-to-relation links are stored
with the originating memory. This lets cleanup preserve graph records that are
still referenced elsewhere.

### Task Management

#### Global Todos (Legacy System)
-   **`add_todo(content, due_date?)`**: Create a global task. Pending tasks automatically appear in `memory://current-context`.
-   **`complete_todo(id)`**: Mark task as done. Archives it as a long-term memory ("Completed task: ...").
-   **`list_todos(status?, limit?)`**: View pending or completed tasks.

#### Conversation & Task Management
-   **`init_conversation(name?)`**: Initialize a conversation session. Returns
    `conversation_id`. Follow it with
    `read_resource("memory://current-context")` to get user/entity information,
    relations, recent memories, and pending todos. Active tasks are provided by
    `memory://turn-context` or the task resources.
-   **`add_task(content, section?, conversation_id?)`**: Add a task to a specific conversation or global scope (if `conversation_id` omitted).
-   **`update_task_status(id, status)`**: Update task status to `pending`, `in-progress`, or `complete`.
-   **`list_tasks(conversation_id?, status?)`**: List tasks. Use `__all__` to show all tasks or omit to show global tasks only.
-   **`delete_task(id)`**: **CRITICAL for task gardening** - Remove obsolete or completed tasks to prevent context pollution.

### Retrospective Extraction
-   **`consolidate_context(text, strategy?, limit?)`** *(OPT-IN via `ENABLE_CONSOLIDATE_TOOL=true`)*: Extract important facts from a brief conversation summary (~50-100 tokens). Uses NLP or LLM to identify novel memories the agent might have missed explicitly saving. Returns extracted facts for agent to selectively save.
    - **Enable**: Set `ENABLE_CONSOLIDATE_TOOL=true` in your MCP server environment variables
    - **`strategy`**: `'nlp'` (fast, offline, default) or `'llm'` (thorough, requires Ollama)
    - **Token Cost**: ~80 tokens (summary input) + **~200 tokens (if strategy='llm')** = **~280 tokens total (LLM)** or **~80 tokens (NLP only)**
    - **Example**: `consolidate_context(text="Discussed Python for data science, TypeScript frustrations, CEOSim project", strategy="llm")`

> [!NOTE]
> **For Chat App Developers**: The consolidate tool is designed for manual
> agent use. Chat applications can instead run equivalent NLP or LLM extraction
> in the client before selectively calling `remember_fact`.

### Advanced Capabilities

#### Project Tagging (Auto-Organization)
The server automatically detects project names like "Project Alpha" or "Operation X" and tags memories with them.
- **Search**: `recall("Project Alpha")` will prioritize these memories.
- **Graph**: A node of type `Project` is created automatically.

#### Tag Priority Matching
When using `recall`, memories with query-token tag matches get a proportional
score boost. Matching one generic tag in a long query no longer grants the
entire boost.
- **Maximum Boost**: `0.15` (configurable via `TAG_MATCH_BOOST`)
- **Example**: Query "performance" will rank memories tagged `["performance", "optimization"]` higher
- **Pure Semantic**: Content embeddings remain clean; tag matching happens in post-filter for transparency

#### Hybrid Recall Scoring

Recall always attempts vector and FTS candidate retrieval independently, then
merges them. A non-empty vector result no longer suppresses exact keyword hits.
Cosine distance is mapped from `0..2` into bounded similarity `1..0`. Vector and
FTS positions are combined through reciprocal-rank fusion, while lexical
coverage uses whole tokens rather than substring matches.

Final scores are bounded to `0..1` and combine:

- vector/keyword retrieval relevance;
- bounded, time-decayed importance;
- meaningful query-term coverage;
- exact tag boost;
- bounded recent familiarity after relevance gating.

`MEMORY_SEMANTIC_WEIGHT=0.9` therefore gives retrieval relevance 90% of the
base score and importance 10%. The historical variable name is retained so
existing presets remain compatible. Candidates must first clear
`MEMORY_MIN_RELEVANCE`; high importance cannot rescue an unrelated result.
For long queries, candidates with weak exact-token overlap must clear the
stronger `MEMORY_SEMANTIC_ONLY_MIN_RELEVANCE` guard. Compound identifiers such
as `MEMORY_SEMANTIC_WEIGHT` contribute both the intact identifier and its
meaningful component tokens.
Coverage and tag boosts consume only remaining score headroom instead of
flattening many candidates to `1.0`.

Temporal filtering is orthogonal to topical ranking. `recall` accepts ISO 8601
`startDate` and `endDate`, or infers a date expression from the query with
Chrono and removes that expression before topical matching. A query containing
only a date can still return memories from that period, ordered by creation
time. Date filters apply to `created_at`; they do not change decay or
familiarity state.

Familiarity uses the same headroom rule:
`boost = maxBoost * (1 - exp(-recentDistinctExposures / saturation))`.
The default maximum is `0.03`, saturation is `5`, and the window is 30 UTC
days.

Familiarity telemetry has these exact semantics:

- the primary key is memory ID + normalized-query hash + UTC day;
- meaningful query tokens are normalized and sorted before SHA-256 hashing;
- the hash is local pseudonymous telemetry, not encryption, and common queries
  may be susceptible to dictionary guessing;
- repeated queries on a later day and different queries on the same day can
  each count once;
- only returned active memories are recorded; outdated, incorrect, date-only,
  and empty-token recalls are not;
- scoring uses prior exposures because the current exposure is written after
  ranking;
- `MEMORY_RECALL_FAMILIARITY_MAX_BOOST=0` disables recording and scoring but
  does not purge existing rows.

A familiarity count cannot make a candidate pass `MEMORY_MIN_RELEVANCE`,
cannot refresh decay, and cannot counteract `outdated` or `incorrect`
lifecycle state.

#### Memory Decay & Consolidation
Memory adaptation uses two distinct strengths: recent recall familiarity for a
small access-based preference, and explicit reinforcement for durable
importance and stability changes.

**How It Works:**
- **Lifecycle-preserving recall**: Retrieval may record bounded familiarity
  telemetry but performs no importance, reinforcement, lifecycle, or decay
  write.
- **Explicit feedback**: `reinforce_memory` records a durable event.
- **Auditable supersession**: `outdated`/`incorrect` hide stale facts without
  deleting history; `restore` reverses the state.
- **Confirmed use**: Positive signals update `reinforcement_count` and
  `last_reinforced_at`; historical passive `access_count` is ignored.
- **Stability Formula**: `stability = halfLife * (1 + consolidation * log2(min(reinforcement_count, 20) + 1))`
- **Decay Calculation**: `decayedImportance = importance * pow(0.5, weeks / stability)`

**Result**: Confirmed-use memories become more stable. Frequently and
distinctly recalled relevant memories receive only a small, temporary ranking
preference; generic memories cannot bypass the relevance threshold or
strengthen their stored importance.

**Configuration:**
- **Half-Life**: 4 weeks (configurable via `MEMORY_HALF_LIFE_WEEKS`)
- **Consolidation Factor**: 1.0 (configurable via `MEMORY_CONSOLIDATION_FACTOR`)
- **Retrieval Relevance Weight**: 0.9 (configured through the backward-compatible `MEMORY_SEMANTIC_WEIGHT`)
- **Familiarity Maximum**: 0.03 (`MEMORY_RECALL_FAMILIARITY_MAX_BOOST`)
- **Familiarity Window**: 30 days (`MEMORY_RECALL_FAMILIARITY_WINDOW_DAYS`)

**Example Timeline:**
```
Day 1:  recall("python") → one hashed daily familiarity exposure; no decay refresh
Day 1:  reinforce_memory(A, "used") → bounded importance gain, confirmed count=1
Day 7:  reinforce_memory(A, "important") → diminishing gain, stability rises
Day 30: Memory A maintains relevance due to confirmed use
Day 90: Unused memories decay to 50% importance (one half-life)
```

#### Mixed Topic Clustering
Group your knowledge into thematic clusters to see the big picture.
- **Tool**: `cluster_memories(k=5)`
- **Logic**: Clusters both Memories AND Entities to find semantic centers (e.g. "SpaceX" entity + "Launch was successful" memory).



---

## Resources

The server exposes structured data via MCP Resources:

| URI Patterns | Description |
| :--- | :--- |
| `memory://current-context` | Standard snapshot of recent memories, important entities, relations, and up to `CONTEXT_TODO_LIMIT` pending todos. Optimized for turn-start context injection. |
| `memory://turn-context` | Dynamic refresh of active tasks, important entities, and recent memory activity. Recommended for mid-conversation "awareness checks". |
| `memory://tasks` | View all global tasks (not tied to a specific conversation). |
| `memory://tasks-{conversation_id}` | View all tasks for a specific conversation, organized by section. |
| `memory://todos` | View all pending and recently completed todos. |

---

## System Architecture

The heart of the system is a single `memory.db` SQLite file.

1.  **Semantic Layer**: `sqlite-vec` extension stores 384-dimensional embeddings generated by `transformers.js`.
2.  **Text Layer**: SQLite FTS5 index kept in sync via database triggers.
3.  **Graph Layer**: Relational tables with foreign key constraints to ensure data integrity.

---

## Source Checkout Testing

The following development commands require a source checkout and its
development dependencies. They are not runtime commands for an installed npm
package:

- `npm test` — scoring, privacy/provenance, schema, MCP protocol, packaging,
  and vector-or-FTS integration.
- `npm run test:cli` — focused CLI workflow verification.
- `npm run audit:recall` — live recall ranking audit against the configured
  database; diagnostic, not an isolated release gate.
- `npm run build` — strict TypeScript compilation.

The older `tests/test_*.ts` files are retained as manual historical diagnostics
and are not release gates.

---

## Compatibility and Troubleshooting

### Windows ARM64 (Snapdragon / Surface Pro X)
*   **Native support**: This package includes a verified `sqlite-vec` v0.1.9 ARM64 DLL built from the official dependency-free amalgamation.
*   **Verification**: The packaged DLL is tested through `better-sqlite3` with a real `vec0` create/insert/search/delete workflow.
*   **Provenance**: Source checksum, binary checksum, licenses, and the reproducible MSVC build command are in `vendor/sqlite-vec/README.md`.
*   **Rebuild**: Run `powershell -ExecutionPolicy Bypass -File scripts/build-sqlite-vec-windows-arm64.ps1` from a Visual Studio Build Tools installation with the ARM64 C++ component.
*   **Fallback**: If the bundled extension cannot load, recall remains available through FTS and logs a WSL2 fallback hint.

### Build Tools
*   **Requirement**: This project uses `better-sqlite3`, which is a native C++ module.
*   **Who needs them?**: Users on platforms without a matching `better-sqlite3` prebuild may need Python and C++ build tools. Rebuilding the bundled Windows ARM64 `sqlite-vec` DLL also requires the MSVC ARM64 tools.
*   **Windows**: Install “Desktop development with C++” through Visual Studio Build Tools.
*   **Linux**: `sudo apt-get install build-essential python3`

## License
MIT
