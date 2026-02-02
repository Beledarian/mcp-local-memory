# Local Memory MCP Server (Project Outline)

**Goal**: Create a lightweight, privacy-first, "Zero-Docker" memory server for
AI agents. **Philosophy**: "Forget the cloud. Forget heavy containers. Use the
disk."

## 1. Core Architecture

This project replaces the heavy Zep stack (Docker + Postgres + Neo4j) with a
single Node.js process and SQLite.

### Technology Stack

- **Runtime**: Node.js (TypeScript)
- **Database**: `better-sqlite3` (Fast, synchronous, stable)
- **Vector Search**: `sqlite-vec` (Native vector search extension for SQLite)
- **Protocol**: Model Context Protocol (MCP) SDK

### Resource Footprint Comparison

| Feature          | Zep (Standard)          | Local Memory (This Project) |
| :--------------- | :---------------------- | :-------------------------- |
| **RAM Usage**    | ~4GB - 8GB              | ~50MB - 200MB               |
| **Storage**      | Complex Volume Mounts   | Single `.sqlite` file       |
| **Mechanism**    | Docker Orchestration    | Native Process              |
| **Dependencies** | Docker, Neo4j, Postgres | Node.js Only                |

## 2. Implementation Plan

### Phase 1: The "Vector" Store (Semantic Search)

**Objective**: Allow the AI to save text and find it later by meaning.

**Schema (`memory.db`)**:

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  -- Metadata columns (optional)
  source TEXT,
  tags TEXT
);

-- sqlite-vec virtual table
CREATE VIRTUAL TABLE vec_items USING vec0(
  embedding float[768] -- Dimension depends on model (e.g. 768 for Gemini/OpenAI)
);
```

**Workflow**:

1.  **Ingest**: Agent calls `remember(text="User likes Python")`.
2.  **Embed**: Server uses an Embedding API (Gemini/OpenAI) _OR_ a local ONNX
    model (transformers.js) to convert text -> vector.
3.  **Store**: Save text to `memories` table, vector to `vec_items`.

### Phase 2: The "Graph" Store (Relationships)

**Objective**: Link facts together without heavy Graph DBs.

**Schema**:

```sql
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE,
  type TEXT -- e.g. "Person", "Language"
);

CREATE TABLE relations (
  source_id TEXT,
  target_id TEXT,
  relation TEXT, -- e.g. "likes", "authored"
  FOREIGN KEY(source_id) REFERENCES entities(id),
  FOREIGN KEY(target_id) REFERENCES entities(id)
);
```

### Phase 3: The "Archivist" (Auto-Ingestion)

**Objective**: Automatically extract facts.

- Instead of Zep doing this, we implement a background "Audit" loop.
- Periodically (or after session), the MCP server asks the LLM: _"Extract new
  timeline events and facts from this conversation history."_
- It saves these as structured rows.

## 3. MCP Tools Definition

The server will expose these tools to the Agent:

1.  **`remember_fact(text: string, tags?: string[])`**
    - Explicitly saves a piece of information.
2.  **`recall(query: string, limit?: number)`**
    - Performs semantic (vector) search to find relevant past memories.
3.  **`forget(memory_id: string)`**
    - Deletes a specific memory.
4.  **`list_recent_memories(limit?: number)`**
    - Getting the last N items for context.

## System Architecture

### 1. Hybrid Search (Vector + FTS)
This server implements a "hybrid" storage approach to ensure compatibility and robustness:
- **Primary**: Semantic Search using `sqlite-vec`. This allows finding memories by meaning (e.g., "favorite food" matches "I like pizza").
- **Fallback**: Full-Text Search (FTS5). If `sqlite-vec` is not compatible with the host system (e.g., missing binaries for Windows ARM64), the system automatically gracefully degrades to use SQLite's native FTS5 engine. This allows finding memories by keyword matching (e.g., "pizza" matches "I like pizza").

### 2. Auto-Sync
Database triggers ensure that the `memories` table and the `memories_fts` search index are always perfectly in sync. When you add, update, or delete a memory, the search index is updated instantly.

### 3. Privacy & Storage
All data is stored in a single local file (`memory.db`). No data leaves your machine unless you explicitly export it using the `export_memories` tool.

## Directory Structure
```text
/mcp-local-memory/
├── package.json
├── src/
│   ├── index.ts          # Entry point (MCP Server setup & Logic)
│   ├── db/
│   │   ├── schema.ts     # SQLite table definitions (Memories + Vectors + FTS5)
│   │   └── client.ts     # Database connection & vector extension load
│   ├── lib/
│   │   ├── embeddings.ts # Logic to fetch embeddings
│   └── tools/
│       └── definitions.ts # Schema for MCP tools
└── tsconfig.json
```
