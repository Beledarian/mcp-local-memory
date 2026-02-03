# Local Memory MCP Server 🧠

A lightweight, privacy-first, "Zero-Docker" memory server for AI agents. This server provides semantic search, keyword search, and a knowledge graph—all running natively on your local machine.

## Key Features

-   **Hybrid Search**: Semantic (Vector) search + Keyword (FTS5) search.
-   **Local Embeddings**: Uses `transformers.js` (ONNX) to run `all-MiniLM-L6-v2` locally on your CPU.
-   **Knowledge Graph**: Structured `entities` and `relations` tables to link facts.
-   **Advanced Graph Traversal**: Recursive queries to find "friends of friends" (Deep Graph).
-   **Mixed Clustering**: "Gravity Center" clustering that groups relevant Memories and Entities together (#6.1).
-   **The Archivist**: Configurable "Auto-Ingestion" strategies for automatic graph building.
-   **Privacy-First**: Zero data leaves your machine. No mandatory cloud APIs.
-   **Resource Efficient**: ~50MB - 200MB RAM usage. Optimized with `Float32Array` buffers. 

## 🌐 Cross-Agent Shared Context

A core advantage of this server is its ability to serve as a **centralized long-term memory pool** for all your AI workflows. 

Unlike standard agent memories that are ephemeral or locked to a single session, this server allows multiple MCP-enabled agents (e.g., Claude Desktop, IDE extensions, or custom CLIs) to:
- **Share Knowledge**: Information learned by one agent is instantly accessible to another.
- **Maintain Consistency**: Ensure all your AI tools operate from the same established facts and entity history.
- **Persistent Intelligence**: Your interaction history matures over time into a robust, structured knowledge base available across your entire local ecosystem.

---

## 🛠 Installation

### 1. Prerequisites
-   **Node.js**: v18 or higher.
-   **Build Tools**: Python and C++ build tools (required by `better-sqlite3` native compilation).

### 2. Setup
```bash
git clone https://github.com/Beledarian/mcp-local-memory.git
cd mcp-local-memory
npm install
npm run build
```

---

## ⚙️ Configuration

Control the server behavior via environment variables:

| Variable | Options | Default | Description |
| :--- | :--- | :--- | :--- |
| `ARCHIVIST_STRATEGY` | `passive`, `nlp`, `llm` | `nlp` | Control the auto-ingestion behavior. Can be comma-separated. |
| `MEMORY_DB_PATH` | Path to DB file | `./memory.db` | Location of the SQLite database. |
| `CONTEXT_WINDOW_LIMIT` | Integer | `500` | Max characters returned by `memory://current-context`. |
| `CONTEXT_MAX_ENTITIES` | Integer | `5` | Max high-importance entities in context. |
| `CONTEXT_MAX_MEMORIES` | Integer | `5` | Max recent memories in context. |
| `OLLAMA_URL` | URL string | `http://localhost:11434` | Endpoint for the LLM strategy. |
| `USE_WORKER` | `true`, `false` | `true` | Run Archivist in a background thread to prevent blocking. |

## Quick Start Configuration (Standard)

Add this to your `mcp_config.json` (or `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "local-memory": {
      "command": "node",
      "args": ["/path/to/mcp-local-memory/dist/index.js"],
      "env": {
        "ARCHIVIST_STRATEGY": "nlp",
        "USE_WORKER": "true"
      }
    }
  }
}
```

## Advanced Configuration (with Ollama)

To enable AI-powered entity extraction, importance scoring, and auto-labeling, run [Ollama](https://ollama.com/) locally.

```json
{
  "mcpServers": {
    "local-memory": {
      "command": "node",
      "args": ["/path/to/mcp-local-memory/dist/index.js"],
      "env": {
        "ARCHIVIST_STRATEGY": "nlp,llm",
        "OLLAMA_URL": "http://localhost:11434/api/generate",
        "CONTEXT_WINDOW_LIMIT": "2000",
        "USE_WORKER": "true"
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

## 💡 Recommended System Prompt

To get the most out of this memory server, instruct your agent to check the context resource at the start of every interaction.

**Add this to your System Prompt / Custom Instructions:**

> You have access to a long-term memory via the `local-memory` tool server.
> 1.  **ALWAYS** read the resource `memory://current-context` at the start of every turn to understand the user's recent activities and important entities.
> 2.  Use `remember_fact` to save any new, important information the user tells you.
> 3.  Use `recall` to search for specific past details if the context resource doesn't provide enough info.
> 4.  Use `read_graph(depth=2)` to understand the relationships between entities if complex reasoning is required.

---

## 🔧 Tools for Agents

The server exposes the following MCP tools:

### Memory Management
-   **`remember_fact(text, tags?)`**: Saves a new piece of information.
-   **`recall(query, limit?)`**: Search for relevant past entries via Vector or FTS search.
-   **`list_recent_memories(limit?)`**: View the latest context.
-   **`forget(memory_id)`**: Delete a specific entry.
-   **`export_memories(path)`**: Backup all data to a JSON file.

### Knowledge Graph
-   **`create_entity(name, type, observations?)`**: Manually define an entity.
-   **`create_relation(source, target, relation)`**: Link two entities with a predicate.
-   **`read_graph(center?, depth?)`**: Explore the network of linked facts.
-   **`cluster_memories(k?)`**: Group knowledge into k topics to get a bird's-eye view.

### 🧠 Advanced Capabilities

#### Project Tagging (Auto-Organization)
The server automatically detects project names like "Project Alpha" or "Operation X" and tags memories with them.
- **Search**: `recall("Project Alpha")` will prioritize these memories.
- **Graph**: A node of type `Project` is created automatically.

#### Memory Decay & Consolidation
Memories fade over time unless accessed.
- **Half-Life**: 4 weeks (configurable).
- **Consolidation**: Frequently accessed memories become "stable" and resist decay.

#### Mixed Topic Clustering
Group your knowledge into thematic clusters to see the big picture.
- **Tool**: `cluster_memories(k=5)`
- **Logic**: Clusters both Memories AND Entities to find semantic centers (e.g. "SpaceX" entity + "Launch was successful" memory).



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

## License
MIT

