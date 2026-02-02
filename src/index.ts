import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { v4 as uuidv4 } from "uuid";
import fs from "fs-extra";
import { getDb } from "./db/client.js";
import { initSchema } from "./db/schema.js";
import { getEmbedder } from "./lib/embeddings.js";
import {
  CREATE_ENTITY_TOOL,
  CREATE_RELATION_TOOL,
  EXPORT_MEMORIES_TOOL,
  FORGET_TOOL,
  LIST_RECENT_MEMORIES_TOOL,
  READ_GRAPH_TOOL,
  RECALL_TOOL,
  REMEMBER_FACT_TOOL,
} from "./tools/definitions.js";

// Initialize DB
const db = getDb();
initSchema(db);

const embedder = getEmbedder();

// Create server instance
const server = new Server(
  {
    name: "mcp-local-memory",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      REMEMBER_FACT_TOOL,
      RECALL_TOOL,
      FORGET_TOOL,
      LIST_RECENT_MEMORIES_TOOL,
      EXPORT_MEMORIES_TOOL,
      CREATE_ENTITY_TOOL,
      CREATE_RELATION_TOOL,
      READ_GRAPH_TOOL,
    ],
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "remember_fact": {
        const text = args?.text as string;
        const tags = (args?.tags as string[]) || [];
        const id = uuidv4();
        
        // 1. Get embedding
        const embedding = await embedder.embed(text);
        const float32Embedding = new Float32Array(embedding);

        // 2. Insert into DB transactionally
        const insertTx = db.transaction(() => {
            db.prepare(
                `INSERT INTO memories (id, content, tags) VALUES (?, ?, ?)`
            ).run(id, text, JSON.stringify(tags));

            try {
                db.prepare(
                    `INSERT INTO vec_items (rowid, embedding) VALUES ((SELECT rowid FROM memories WHERE id = ?), ?)`
                ).run(id, Buffer.from(float32Embedding.buffer));
            } catch (err) {
                console.warn("Could not insert vector embedding (sqlite-vec might be missing):", err);
            }
        });
        
        insertTx();

        return {
          content: [
            {
              type: "text",
              text: `Remembered fact with ID: ${id}`,
            },
          ],
        };
      }

      case "recall": {
        const query = args?.query as string;
        const limit = (args?.limit as number) || 5;

        // 1. Get query embedding
        const embedding = await embedder.embed(query);
        const float32Embedding = new Float32Array(embedding);

        // 2. Search
        let results: any[] = [];
        let usedSearchMethod = "vector";

        try {
            // Attempt vector search
            // Join back with memories table to get content
            results = db
              .prepare(
                `
                SELECT 
                  m.id, 
                  m.content, 
                  m.created_at,
                  vec_distance_cosine(v.embedding, ?) as distance
                FROM vec_items v
                JOIN memories m ON v.rowid = m.rowid
                ORDER BY distance
                LIMIT ?
                `
              )
              .all(Buffer.from(float32Embedding.buffer), limit) as any[];
        } catch (err) {
            // Vector search failed (likely missing extension), fall back to FTS
             usedSearchMethod = "fts-fallback";
        }

        // 3. Fallback: If vector search failed or returned 0 results, try FTS
        if (results.length === 0) {
            usedSearchMethod = (usedSearchMethod === "vector") ? "fts-hybrid" : "fts-only";
            // Use FTS Match
            // We use the raw query for matching. 
            // Note: FTS5 query syntax is powerful but can error on special chars. 
            // Simple sanitization: remove non-alphanumeric chars or just wrap in quotes if needed.
            // For now, we utilize the query as is, but wrapped in quotes to treat as phrase or simple tokens.
            const ftsResults = db.prepare(`
                SELECT 
                    id, 
                    memories.content, 
                    created_at,
                    rank as score
                FROM memories_fts 
                JOIN memories ON memories_fts.rowid = memories.rowid
                WHERE memories_fts MATCH ? 
                ORDER BY rank
                LIMIT ?
            `).all(query, limit) as any[];
            
            results = ftsResults;
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                  method: usedSearchMethod,
                  results: results
              }, null, 2),
            },
          ],
        };
      }

      case "forget": {
        const memoryId = args?.memory_id as string;
        
        // Check if exists first
        const existing = db.prepare('SELECT rowid FROM memories WHERE id = ?').get(memoryId) as { rowid: number } | undefined;
        
        if (!existing) {
             return {
                isError: true,
                content: [{ type: "text", text: `Memory with ID ${memoryId} not found.` }]
            };
        }

        const deleteTx = db.transaction(() => {
            db.prepare('DELETE FROM vec_items WHERE rowid = ?').run(existing.rowid);
            db.prepare('DELETE FROM memories WHERE id = ?').run(memoryId);
        });

        deleteTx();

        return {
          content: [
            {
              type: "text",
              text: `Forgot memory ${memoryId}`,
            },
          ],
        };
      }

      case "list_recent_memories": {
        const limit = (args?.limit as number) || 10;
        const results = db.prepare('SELECT * FROM memories ORDER BY created_at DESC LIMIT ?').all(limit);
        
        return {
            content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
        };
      }

      case "export_memories": {
          const exportPath = args?.path as string;
          
          const alldata = db.prepare('SELECT * FROM memories').all();
          
          await fs.outputJson(exportPath, alldata, { spaces: 2 });
          
          return {
              content: [{ type: "text", text: `Successfully exported ${alldata.length} memories to ${exportPath}` }]
          };
      }

      case "create_entity": {
        const name = args?.name as string;
        const type = args?.type as string;
        const observations = (args?.observations as string[]) || [];

        const id = uuidv4();
        
        try {
            db.prepare(`INSERT INTO entities (id, name, type, observations) VALUES (?, ?, ?, ?)`).run(id, name, type, JSON.stringify(observations));
            return {
                content: [{ type: "text", text: `Created entity '${name}' of type '${type}'` }]
            };
        } catch (error: any) {
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                 // Entity exists, maybe update it? For now just return success/info
                 return {
                    content: [{ type: "text", text: `Entity '${name}' already exists.` }]
                };
            }
            throw error;
        }
      }

      case "create_relation": {
        const source = args?.source as string;
        const target = args?.target as string;
        const relation = args?.relation as string;

        // Auto-create simplified entities stub if they don't exist?
        // For robustness, let's enforce ensuring they exist or auto-create them as "Unknown".
        // Here we'll just try to insert and if FK fails, warn.
        
        // Actually, to make it "smart", let's ensure they exist.
        const ensureEntity = (name: string) => {
            try {
                const id = uuidv4();
                db.prepare(`INSERT INTO entities (id, name, type, observations) VALUES (?, ?, ?, ?)`).run(id, name, "Unknown", "[]");
            } catch (ignored) {} // Exists
        };

        ensureEntity(source);
        ensureEntity(target);

        try {
            db.prepare(`INSERT INTO relations (source, target, relation) VALUES (?, ?, ?)`).run(source, target, relation);
            return {
                content: [{ type: "text", text: `Created relation: ${source} --[${relation}]--> ${target}` }]
            };
        } catch (error: any) {
            if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
                 return { content: [{ type: "text", text: `Relation already exists.` }] };
            }
            throw error;
        }
      }

      case "read_graph": {
        // Simple implementation: return immediate neighbors or all if no center
        const center = args?.center as string | undefined;
        
        let nodes: any[] = [];
        let edges: any[] = [];

        if (center) {
            // Find entity
            const entity = db.prepare(`SELECT * FROM entities WHERE name = ?`).get(center);
            if (!entity) {
                 return { content: [{ type: "text", text: `Entity '${center}' not found.` }] };
            }
            nodes.push(entity);
            
            // Find outgoing edges
            const outgoing = db.prepare(`SELECT * FROM relations WHERE source = ?`).all(center) as any[];
            edges.push(...outgoing);
            
            // Should we add the target nodes?
            for (const edge of outgoing) {
                const targetNode = db.prepare(`SELECT * FROM entities WHERE name = ?`).get(edge.target);
                if (targetNode) nodes.push(targetNode);
            }
            
            // Find incoming edges? - Usually useful for a graph
             const incoming = db.prepare(`SELECT * FROM relations WHERE target = ?`).all(center) as any[];
             edges.push(...incoming);
             
             for (const edge of incoming) {
                 // Prevent duplicates if possible, but distinct push is okay for JSON
                 const sourceNode = db.prepare(`SELECT * FROM entities WHERE name = ?`).get(edge.source);
                 // Check if in nodes already (simple check by ID or Name)
                 if (sourceNode && !nodes.find((n:any) => n.name === (sourceNode as any).name)) {
                     nodes.push(sourceNode);
                 }
             }
        } else {
             // Return everything (LIMIT?)
             nodes = db.prepare(`SELECT * FROM entities LIMIT 100`).all();
             edges = db.prepare(`SELECT * FROM relations LIMIT 100`).all();
        }

        return {
            content: [{ type: "text", text: JSON.stringify({ nodes, edges }, null, 2) }]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error processing ${name}: ${error.message}`,
        },
      ],
    };
  }
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Local Memory MCP Server running on stdio");
}

run().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
