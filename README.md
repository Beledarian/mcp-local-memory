# Local Memory MCP Server 🧠

A lightweight, privacy-first, "Zero-Docker" memory server for AI agents. This server provides semantic search, keyword search, and a knowledge graph—all running natively on your local machine.

![Antigravity Agent Demo](docs/image.png)

## Key Features

-   **Hybrid Search**: Semantic (Vector) search + Keyword (FTS5) search.
-   **Local Embeddings**: Uses `transformers.js` (ONNX) to run `all-MiniLM-L6-v2` locally on your CPU.
-   **Knowledge Graph**: Structured `entities` and `relations` tables to link facts.
-   **Advanced Graph Traversal**: Recursive queries to find "friends of friends" (Deep Graph).
-   **Mixed Clustering**: "Gravity Center" clustering that groups relevant Memories and Entities together (#6.1).
-   **The Archivist**: Configurable "Auto-Ingestion" strategies for automatic graph building.
-   **Privacy-First**: Zero data leaves your machine. No mandatory cloud APIs.
-   **Resource Efficient**: ~50MB - 200MB RAM usage. Optimized with `Float32Array` buffers. 
-   **Enhanced NLP Extraction**: Extracts complex concepts ("optimized WGSL"), adjectives ("pragmatic"), entities, and relations with robust pattern matching.
-   **Time Tunnel**: Natural language date querying (e.g., "last week", "in 2025") for temporal recall.
-   **Todo System**: Integrated task management with automatic context injection and memory archival.
-   **Entity Observations**: Normalized storage with "Smart Append" for evolving entity knowledge. 

## 🌐 Cross-Agent Shared Context

A core advantage of this server is its ability to serve as a **centralized long-term memory pool** for all your AI workflows. 

Unlike standard agent memories that are ephemeral or locked to a single session, this server allows multiple MCP-enabled agents (e.g., Claude Code, IDE extensions, or custom CLIs) to:
- **Share Knowledge**: Information learned by one agent is instantly accessible to another.
- **Maintain Consistency**: Ensure all your AI tools operate from the same established facts and entity history.
- **Persistent Intelligence**: Your interaction history matures over time into a robust, structured knowledge base available across your entire local ecosystem.

---

## 🛠 Installation

### 1. Prerequisites
-   **Node.js**: v18 or higher.
-   **Build Tools**: Python and C++ build tools (required by `better-sqlite3` native compilation).

> [!IMPORTANT]
> **Windows Users**: You may need to have C++ Build Tools installed.
> Run: `npm install --global --production windows-build-tools` 
> OR install "Desktop development with C++" via Visual Studio Installer.
> *Failure to do this can result in `gyp` errors during installation.*

## 📦 Installation & Setup

### Method 1: Use via NPX (Recommended)

You can use the server directly without installing it globally, using `npx`. This is the easiest way to use it with MCP clients like Claude Desktop.

**Add to your MCP Configuration:**

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@beledarian/mcp-local-memory"],
      "env": {
        "ARCHIVIST_STRATEGY": "nlp"
      }
    }
  }
}
```

### Method 2: Install via NPM

Global installation provides the `memory` command:

```bash
npm install -g @beledarian/mcp-local-memory

# Usage
memory --help
```
```

### Method 3: Install from Source (For Contributors)

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

## ⚙️ Configuration

Control the server behavior via environment variables:

| Variable | Options | Default | Description |
| :--- | :--- | :--- | :--- |
| `ARCHIVIST_STRATEGY` | `passive`, `nlp`, `llm` | `nlp` | Control automatic entity extraction behavior. `passive`=disabled, `nlp`=free offline extraction, `llm`=AI-powered extraction (~200 tokens per `remember_fact` call). Can be comma-separated (e.g., `nlp,llm`). |
| `MEMORY_DB_PATH` | Path to DB file | `./memory.db` | Location of the SQLite database. |
| `CONTEXT_WINDOW_LIMIT` | Integer | `500` | Max characters returned by `memory://current-context`. |
| `CONTEXT_MAX_ENTITIES` | Integer | `5` | Max high-importance entities in context. |
| `CONTEXT_MAX_MEMORIES` | Integer | `5` | Max recent memories in context. |
| `OLLAMA_URL` | URL string | `http://localhost:11434` | Full API Endpoint for the LLM strategy (e.g. `http://localhost:11434/api/generate`). |
| `USE_WORKER` | `true`, `false` | `true` | Run Archivist in a background thread to prevent blocking. |
| `ENABLE_CONSOLIDATE_TOOL` | `true`, `false` | `false` | Enable the `consolidate_context` tool for retrospective memory extraction. |
| `TAG_MATCH_BOOST` | Float | `0.15` | Score boost for exact tag matches in `recall` results. Higher = stronger tag priority. |
| `MEMORY_HALF_LIFE_WEEKS` | Float | `4.0` | Weeks until memory importance decays to 50%. Longer = slower decay. |
| `MEMORY_CONSOLIDATION_FACTOR` | Float | `1.0` | Strength of access-based consolidation. Higher = frequently-used memories resist decay more. |
| `MEMORY_SEMANTIC_WEIGHT` | Float | `0.7` | Balance between semantic similarity (0.7) and decayed importance (0.3) in recall ranking. |
| `EXTRACT_COMPLEX_CONCEPTS` | `true`, `false` | `true` | Enable extraction of modifier+noun phrases (e.g., "optimized WGSL"). Set to `false` to disable. |
| `CONTEXT_TODO_LIMIT` | Integer | `3` | Max pending todos shown in `memory://current-context`. |
| `EMBEDDING_CONCURRENCY` | Integer | `5` | Max concurrent embedding operations for `remember_facts`. Higher values = faster batch processing but more CPU/memory usage. |
| `EXTENSIONS_PATH` | Path to directory | (none) | Optional path to load custom tool extensions from external directory. Allows adding private/experimental tools without modifying the codebase. |



To enable AI-powered entity extraction, importance scoring, and auto-labeling, run [Ollama](https://ollama.com/) locally.

```json
{
  "mcpServers": {
    "local-memory": {
      "command": "wsl",
      "args": ["/home/username/.nvm/versions/node/v20.11.1/bin/node", "/home/username/mcp-local-memory/dist/index.js"],
      "env": {
        "MEMORY_DB_PATH": "/home/username/.memory/memory.db",
        "ARCHIVIST_STRATEGY": "nlp",
        "ARCHIVIST_LANGUAGE": "en"  // Optional: Default is 'en'
      }
    }
  }
}
```

### Archivist Strategies (`ARCHIVIST_STRATEGY`)
You can combine multiple strategies by separating them with a comma (e.g. `nlp,llm`).

-   **`passive`**: Manual only. The server waits for the Agent to call tools.
-   **`nlp`**: **(Open Source / Offline)** Uses the `compromise` library to extract entities locally. Very fast, but less comprehensive.
-   **`llm`**: **(Ollama / Artificial Intelligence)** Sends text to a local LLM (e.g., Llama 3) for deep understanding, relation extraction, and importance scoring. Requires running Ollama.

---

## ⚡ Performance Optimizations

### Asynchronous Memory Operations
**All memory saving operations are now non-blocking** for instant responses:

- **`remember_fact`**: Returns immediately, processes embedding + archivist in background
  - **Before**: ~50-200ms blocking wait
  - **After**: Instant return (0ms)
  
- **`remember_facts`**: Parallel batch processing with concurrency limiting
  - **Before**: 7 facts × 200ms = ~1.4s (sequential)
  - **After**: ~200ms (parallel batches)
  - **Speedup**: ~7x faster
  - **Configuration**: Set `EMBEDDING_CONCURRENCY` env var (default: 5)

### Natural Memory Evolution
Memories accessed frequently gain importance automatically:
- **Each `recall()`**: +0.05 importance boost (capped at 1.0)
- **Fresh memories**: Start at 0.5 importance
- **After ~10 accesses**: Become "cherished" (>0.7 importance)
- **After ~20 accesses**: Maximum importance (1.0)

This mimics **hippocampus consolidation** - frequently-used memories naturally rise to the top. No manual curation needed.

### Official Extensions

This package includes first-party extensions to enhance memory management:

1.  **Soul Maintenance** (`extensions/soul_maintenance.ts`): Implements a "biological" lifecycle where memories must earn importance through use and naturally decay over time unless immunized by core tags.

To use these official extensions, set your `EXTENSIONS_PATH` to the `extensions` folder inside the installed package:

```bash
# Example for npx usage
EXTENSIONS_PATH=./node_modules/@beledarian/mcp-local-memory/extensions
```

**Setup:**
1. Create a directory for your extensions (e.g., `./my-extensions/`)
2. Add TypeScript/JavaScript modules with your custom tools
3. Set `EXTENSIONS_PATH` environment variable to your directory
4. Restart the server

**Extension Format:**
```typescript
// my-extensions/my_tool.ts
import type { Database } from 'better-sqlite3';

export function handleMyTool(db: Database, args?: any) {
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

## 💡 Recommended System Prompt

For effective agent interaction with this memory server, we recommend using a detailed system prompt.

- **Quick Start**: See [docs/example_instructions.md](docs/example_instructions.md)
- **Comprehensive Rules**: See [docs/detailed_prompt.md](docs/detailed_prompt.md)

---

## 🔧 Tools for Agents

The server exposes the following MCP tools:

### Memory Management
-   **`remember_fact(text, tags?)`**: Saves a new piece of information. **USE FREQUENTLY**—be proactive about saving anything important the user shares (preferences, projects, goals, decisions, context).
    - **Automatic Entity Extraction**: Extracts entities and relations using configured `ARCHIVIST_STRATEGY` (**NLP=free, LLM=~200 tokens per call**)
-   **`remember_facts(facts)`**: Save multiple distinct facts at once. Use this to batch saves and reduce latency.
    - **Input**: `{ facts: [{ text: "...", tags?: [...] }] }`
-   **`recall(query, limit?)`**: Search for relevant past entries via Vector or FTS search.
    - **Automatic Tracking**: Updates `access_count` (+1) and `last_accessed` (timestamp) for all returned memories
    - **Automatic Tracking**: Updates `access_count` (+1) and `last_accessed` (timestamp) for all returned memories
    - **Feeds Consolidation**: Frequently-recalled memories gain stability and resist decay
    - **Time Tunnel**: Filters by natural language dates (e.g., "last week", "yesterday", "in 2025").
-   **`list_recent_memories(limit?)`**: View the latest context.
-   **`forget(memory_id)`**: Delete a specific entry.
-   **`export_memories(path)`**: Backup all data to a JSON file.

### Knowledge Graph
-   **`create_entity(name, type, observations?)`**: Manually define an entity. **Smart Append**: If entity exists, observations are added to it.
-   **`delete_observation(entity_name, observations)`**: Remove specific invalid facts from an entity.
-   **`create_relation(source, target, relation)`**: Link two entities with a predicate.
-   **`delete_relation(source, target, relation)`**: Delete a specific link between entities.
-   **`delete_entity(name)`**: Delete an entity **and all its relations, observations, and embeddings** (Cascade Delete).
-   **`update_entity(current_name, new_name?, new_type?)`**: Rename an entity or change its type. Relations update automatically.
-   **`read_graph(center?, depth?)`**: Explore the network of linked facts.
-   **`cluster_memories(k?)`**: Group knowledge into k topics to get a bird's-eye view.

### Task Management

#### Global Todos (Legacy System)
-   **`add_todo(content, due_date?)`**: Create a global task. Pending tasks automatically appear in `memory://current-context`.
-   **`complete_todo(id)`**: Mark task as done. Archives it as a long-term memory ("Completed task: ...").
-   **`list_todos(status?, limit?)`**: View pending or completed tasks.

#### Conversation & Task Management
-   **`init_conversation(name?)`**: Initialize a conversation session. Returns `conversation_id`. **MUST follow up with `read_resource("memory://current-context")`** to get startup context (user info, recent memories, active tasks).
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
> **For Chat App Developers**: The consolidate tool is designed for manual agent use. However, chat apps can integrate NLP/LLM logic directly into the client for **automatic, zero-cost context parsing**. See [Advanced Integrations](#advanced-integration-possibilities) below.

### 🧠 Advanced Capabilities

#### Project Tagging (Auto-Organization)
The server automatically detects project names like "Project Alpha" or "Operation X" and tags memories with them.
- **Search**: `recall("Project Alpha")` will prioritize these memories.
- **Graph**: A node of type `Project` is created automatically.

#### Tag Priority Matching
When using `recall`, memories with exact tag matches get a score boost for better ranking.
- **Default Boost**: `0.15` (configurable via `TAG_MATCH_BOOST`)
- **Example**: Query "performance" will rank memories tagged `["performance", "optimization"]` higher
- **Pure Semantic**: Content embeddings remain clean; tag matching happens in post-filter for transparency

#### Memory Decay & Consolidation
Memories fade over time unless accessed, mimicking human memory consolidation through a **use-it-or-lose-it** system.

**How It Works:**
- **Automatic Tracking**: Every time `recall` returns a memory, two fields are updated:
  - `access_count` → Incremented by +1
  - `last_accessed` → Set to current timestamp
- **Stability Formula**: `stability = halfLife * (1 + consolidation * log2(access_count + 1))`
- **Decay Calculation**: `decayedImportance = importance * pow(0.5, weeks / stability)`

**Result**: Frequently-recalled memories become more **stable** and resist decay. Memories you never use gradually fade from search results.

**Configuration:**
- **Half-Life**: 4 weeks (configurable via `MEMORY_HALF_LIFE_WEEKS`)
- **Consolidation Factor**: 1.0 (configurable via `MEMORY_CONSOLIDATION_FACTOR`)
- **Semantic Weight**: 0.7 (configurable via `MEMORY_SEMANTIC_WEIGHT`)

**Example Timeline:**
```
Day 1:  recall("python") → Memory A: access_count=1, importance=0.8
Day 7:  recall("coding") → Memory A: access_count=2, stability↑
Day 30: Memory A maintains relevance due to high access_count
Day 90: Unused memories decay to 50% importance (one half-life)
```

#### Mixed Topic Clustering
Group your knowledge into thematic clusters to see the big picture.
- **Tool**: `cluster_memories(k=5)`
- **Logic**: Clusters both Memories AND Entities to find semantic centers (e.g. "SpaceX" entity + "Launch was successful" memory).



---

## 📂 Resources

The server exposes structured data via MCP Resources:

| URI Patterns | Description |
| :--- | :--- |
| `memory://current-context` | Standard snapshot of recent memories, important entities, relations, and top 3 pending todos. Optimized for turn-start context injection. |
| `memory://turn-context` | Dynamic refresh of active tasks, important entities, and recent memory activity. Recommended for mid-conversation "awareness checks". |
| `memory://tasks` | View all global tasks (not tied to a specific conversation). |
| `memory://tasks-{conversation_id}` | View all tasks for a specific conversation, organized by section. |
| `memory://todos` | View all pending and recently completed todos. |

---

## 🏗 System Architecture

The heart of the system is a single `memory.db` SQLite file. 

1.  **Semantic Layer**: `sqlite-vec` extension stores 384-dimensional embeddings generated by `transformers.js`.
2.  **Text Layer**: SQLite FTS5 index kept in sync via database triggers.
3.  **Graph Layer**: Relational tables with foreign key constraints to ensure data integrity.

---

## 🧪 Testing

Run internal verification tests:
-   `npx tsx test_verification.ts` (Core flow)
-   `npx tsx test_embedding.ts` (AI Model check)
-   `npx tsx test_graph.ts` (Graph check)
-   `npx tsx test_archivist_nlp.ts` (Auto-ingestion check)

---

## 🖥 Compatibility & Troubleshooting

### Windows ARM64 (Snapdragon / Surface Pro X)
*   **Limitation**: The vector search extension (`sqlite-vec`) does not currently provide pre-built binaries for Windows ARM64.
*   **Result**: Vector-based features (like `recall` with semantic queries) will be unavailable.
*   **Workaround**: Run this server using **WSL2** (see WSL configuration example above).
    *   **Alternative**: If you prefer native Windows, use **x64 Node.js** (v20 or v22 recommended).
    *   **Note**: Avoid Node v24+ for now, as it lacks pre-built binaries for `better-sqlite3`, requiring you to have C++ Build Tools installed to compile from source.

### Build Tools
*   **Requirement**: This project uses `better-sqlite3`, which is a native C++ module.
*   **Who needs them?**: Users on platforms **without pre-built binaries** (e.g., Windows ARM64, some Linux distros) must have Python and C++ build tools installed to compile the module from source.
*   **Windows**: Install via `npm install --global --production windows-build-tools` or Visual Studio Build Tools.
*   **Linux**: `sudo apt-get install build-essential python3`

## License
MIT

