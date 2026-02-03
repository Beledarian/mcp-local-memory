import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
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
  CLUSTER_MEMORIES_TOOL,
  CONSOLIDATE_CONTEXT_TOOL
} from "./tools/definitions.js";
import { getArchivist } from "./lib/archivist.js";

// Initialize DB
const db = getDb();
try { fs.writeFileSync('/tmp/mcp_db_path.txt', process.env.MEMORY_DB_PATH || 'DEFAULT'); } catch(e) {}
console.error(`[Server] Database initialized at: ${process.env.MEMORY_DB_PATH || 'default (memory.db)'}`);

// Register Custom Functions
// Leventshtein distance for fuzzy matching
const levenshtein = (a: string, b: string): number => {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
    for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) == a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
            }
        }
    }
    return matrix[b.length][a.length];
};
db.function('levenshtein', levenshtein);

// Scoring function for Temporal Decay + Semantic Similarity
const decay = (importance: number, last_accessed: string | null, access_count: number, distance: number): number => {
    // 1. Config
    const halfLife = parseFloat(process.env.MEMORY_HALF_LIFE_WEEKS || '4');
    const consolidation = parseFloat(process.env.MEMORY_CONSOLIDATION_FACTOR || '1.0');
    const semanticWeight = parseFloat(process.env.MEMORY_SEMANTIC_WEIGHT || '0.7');
    const importanceWeight = 1.0 - semanticWeight;
    
    // 2. Time Delta (Weeks)
    const now = new Date();
    const accessed = last_accessed ? new Date(last_accessed) : new Date(); // If null, assume fresh
    const diffTime = Math.abs(now.getTime() - accessed.getTime());
    const weeks = diffTime / (1000 * 60 * 60 * 24 * 7);

    // 3. Stability (Consolidation)
    // Stability increases with access count. 
    // log2(1) = 0, log2(2) = 1, log2(4) = 2...
    const stability = halfLife * (1 + (consolidation * Math.log2(access_count + 1)));
    
    // 4. Decayed Importance (Exponential Half-Life)
    const decayedImportance = (importance || 0.5) * Math.pow(0.5, weeks / stability);
    
    // 5. Semantic Similarity
    // distance is cosine distance (0=identical, 2=opposite). verify sqlite-vec range.
    // Assuming 0 to 2. Similarity = 1 - (distance / 2)? Or usually just 1 - distance.
    // Let's assume standard 1 - dist.
    const similarity = 1.0 - distance;
    
    // 6. Final Score (Weighted Mix)
    return (similarity * semanticWeight) + (decayedImportance * importanceWeight);
};
db.function('ranked_score', decay);

initSchema(db);

const embedder = getEmbedder();
const archivist = getArchivist(db, async (text) => {
    const vectors = await embedder.embed(text);
    return Array.from(vectors);
});

// Create server instance
const server = new Server(
  {
    name: "mcp-local-memory",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// List available resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
        resources: [
            {
                uri: "memory://current-context",
                name: "Current Context",
                description: "A summary of relevant entities and recent memories for the current session.",
                mimeType: "text/plain",
            }
        ]
    };
});

// Read resources
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    
    if (uri === "memory://current-context") {
        const limitEnv = process.env.CONTEXT_WINDOW_LIMIT;
        const limit = limitEnv ? parseInt(limitEnv, 10) : 500;
        
        const entitiesLimit = parseInt(process.env.CONTEXT_MAX_ENTITIES || '5', 10);
        const memoriesLimit = parseInt(process.env.CONTEXT_MAX_MEMORIES || '5', 10);
        
        // --- SMART CONTEXT LOGIC ---
        
        // 1. Recent Memories
        const recentMemories = db.prepare(`SELECT content, created_at FROM memories ORDER BY created_at DESC LIMIT ?`).all(memoriesLimit) as any[];
        
        // 2. Active Entities (Entities mentioned in recent memories)
        // Accessing 'tags' is a cheap proxy if NLP filled them, or we scan content?
        // Better: Find entities that were updated recently? Or just global VIPs + search?
        // Let's stick to Global VIPs + Manual "Active" list if we had one.
        // For now: Global Importance is the most reliable signal we have.
        // IMPROVEMENT: "Entities recently modified or created"
        // Let's add: Top N Important Entities
        let importantEntities = [];
        try {
             importantEntities = db.prepare(`SELECT name, type, observations FROM entities ORDER BY importance DESC LIMIT ?`).all(entitiesLimit) as any[];
        } catch (e) {
             importantEntities = db.prepare(`SELECT name, type, observations FROM entities LIMIT ?`).all(entitiesLimit) as any[];
        }

        // 3. Recently Active Entities (Created/Updated recently)
        // We assume 'rowid' is roughly chronological or 'id' if time-sortable. 
        // Best proxy without a 'updated_at' column is just reliance on importance or recent memories content.
        // Let's try to match entities in recent memories content (simple string match)
        const recentContent = recentMemories.map(m => m.content).join(' ');
        // Find entities whose names appear in recent content
        // This is a "Poor man's active context" but effective locally.
        const allEntities = db.prepare('SELECT name, type, observations FROM entities').all() as any[];
        const activeEntities = allEntities.filter(e => recentContent.includes(e.name)).slice(0, entitiesLimit);
        
        // Deduplicate Important vs Active
        const combinedEntities = [...importantEntities];
        activeEntities.forEach(ae => {
            if (!combinedEntities.find(ce => ce.name === ae.name)) {
                combinedEntities.push(ae);
            }
        });
        
        let context = "=== CURRENT CONTEXT ===\n\n";
        
        if (combinedEntities.length > 0) {
            context += "Relevant Entities:\n";
            combinedEntities.forEach(e => {
                const obs = JSON.parse(e.observations || '[]');
                const obsStr = obs.length > 0 ? ` (${obs.join(', ')})` : '';
                context += `- ${e.name} [${e.type}]${obsStr}\n`;
            });
            context += "\n";
        }
        
        context += "Recent Memories:\n";
        recentMemories.forEach(m => {
            context += `- ${m.content} (${m.created_at})\n`;
        });
        
        // Truncate if needed
        if (context.length > limit) {
            context = context.substring(0, limit) + "... (truncated)";
        }
        
        return {
            contents: [{
                uri: uri,
                mimeType: "text/plain",
                text: context
            }]
        };
    }
    
    throw new Error(`Resource not found: ${uri}`);
});

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = [
    REMEMBER_FACT_TOOL,
    RECALL_TOOL,
    FORGET_TOOL,
    LIST_RECENT_MEMORIES_TOOL,
    EXPORT_MEMORIES_TOOL,
    CREATE_ENTITY_TOOL,
    CREATE_RELATION_TOOL,
    READ_GRAPH_TOOL,
  ];

  // consolidate_context is opt-in via environment variable
  if (process.env.ENABLE_CONSOLIDATE_TOOL === 'true') {
    tools.push(CONSOLIDATE_CONTEXT_TOOL);
  }

  return { tools };
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
        
        // 1. Get embedding (pure semantic - tags handled in post-filter)
        const embedding = await embedder.embed(text);
        const float32Embedding = new Float32Array(embedding);

        // 2. Insert into DB transactionally
        const insertTx = db.transaction(() => {
            db.prepare(
                `INSERT INTO memories (id, content, tags, last_accessed, importance) VALUES (?, ?, ?, CURRENT_TIMESTAMP, 0.5)`
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

        // 3. Trigger Archivist (Auto-Ingestion)
        // Fire and forget - don't block the response
        archivist.process(text, id).catch(err => console.error("Archivist error:", err));

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
        const returnJson = (args?.json as boolean) || false;

        // 1. Get query embedding
        const embedding = await embedder.embed(query);
        const float32Embedding = new Float32Array(embedding);

        // 2. Search
        let results: any[] = [];
        let usedSearchMethod = "vector";

        try {
            // Attempt vector search
            results = db
              .prepare(
                `
                SELECT 
                  m.id, 
                  m.content,
                  m.tags,
                  m.created_at,
                  m.importance,
                  m.last_accessed,
                  m.access_count,
                  vec_distance_cosine(v.embedding, ?) as distance,
                  ranked_score(m.importance, m.last_accessed, m.access_count, vec_distance_cosine(v.embedding, ?)) as score
                FROM vec_items v
                JOIN memories m ON v.rowid = m.rowid
                ORDER BY score DESC
                LIMIT ?
                `
              )
              .all(Buffer.from(float32Embedding.buffer), Buffer.from(float32Embedding.buffer), limit * 2) as any[];
        } catch (err) {
            usedSearchMethod = "fts-fallback";
        }

        // 3. Fallback/Hybrid using FTS
        if (results.length === 0 || usedSearchMethod === "fts-fallback") {
            const tokenizeFTSQuery = (q: string): string => {
                const tokens = q.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(t => t.length > 0).map(t => `"${t}"`);
                return tokens.length > 0 ? tokens.join(' OR ') : q;
            };
            
            const ftsResults = db.prepare(`
                SELECT 
                    id, 
                    memories.content,
                    memories.tags,
                    memories.importance,
                    created_at,
                    rank as score
                FROM memories_fts 
                JOIN memories ON memories_fts.rowid = memories.rowid
                WHERE memories_fts MATCH ? 
                ORDER BY rank
                LIMIT ?
            `).all(tokenizeFTSQuery(query), limit) as any[];
            
            results = ftsResults;
            usedSearchMethod = (usedSearchMethod === "vector") ? "fts-hybrid" : "fts-only";
        }

        // Post-process boosting
        const tagBoost = parseFloat(process.env.TAG_MATCH_BOOST || '0.15');
        const queryLower = query.toLowerCase();
        results = results.map(r => {
            try {
                const tags = JSON.parse(r.tags || '[]') as string[];
                const hasExactMatch = tags.some(tag => queryLower.includes(tag.toLowerCase()));
                return { ...r, score: r.score + (hasExactMatch ? tagBoost : 0) };
            } catch { return r; }
        }).sort((a, b) => b.score - a.score).slice(0, limit);

        // Update Access Stats
        if (results.length > 0) {
            const ids = results.map(r => r.id);
            const ph = ids.map(() => '?').join(',');
            db.prepare(`UPDATE memories SET last_accessed = CURRENT_TIMESTAMP, access_count = access_count + 1 WHERE id IN (${ph})`).run(...ids);
        }

        if (returnJson) {
          return { content: [{ type: "text", text: JSON.stringify({ method: usedSearchMethod, results }, null, 2) }] };
        }

        const head = `Recall results for "${query}" (${usedSearchMethod}):\n`;
        const body = results.map(r => {
          const importanceChar = r.importance >= 0.8 ? " ⭐" : "";
          const tags = JSON.parse(r.tags || '[]');
          const tagStr = tags.length > 0 ? ` [Tags: ${tags.join(', ')}]` : '';
          return `[Score: ${r.score.toFixed(2)}${importanceChar}] ${r.content}${tagStr}`;
        }).join('\n');

        return {
          content: [{ type: "text", text: head + (body || "No relevant memories found.") }],
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
        const returnJson = (args?.json as boolean) || false;
        const results = db.prepare('SELECT * FROM memories ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
        
        if (returnJson) {
            return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
        }

        const head = `Most recent ${results.length} memories:\n`;
        const body = results.map(r => {
            const importanceChar = r.importance >= 0.8 ? " ⭐" : "";
            const tags = JSON.parse(r.tags || '[]');
            const tagStr = tags.length > 0 ? ` [Tags: ${tags.join(', ')}]` : '';
            return `- [${new Date(r.created_at).toLocaleDateString()}${importanceChar}] ${r.content}${tagStr}`;
        }).join('\n');

        return {
            content: [{ type: "text", text: head + (body || "No memories found.") }]
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

        // Check for existing entity via fuzzy match (Levenshtein <= 2)
        const existing = db.prepare(`SELECT id, name FROM entities WHERE levenshtein(name, ?) <= 2 LIMIT 1`).get(name) as any;
        
        if (existing) {
             return {
                content: [{ type: "text", text: `Entity '${name}' already exists (as '${existing.name}'). ID: ${existing.id}` }]
            };
        }

        const id = uuidv4();
        
        try {
            db.prepare(`INSERT INTO entities (id, name, type, observations) VALUES (?, ?, ?, ?)`).run(id, name, type, JSON.stringify(observations));
            
            // Feature 6.1: Generate Entity Embedding
            embedder.embed(name + " " + type).then(vec => {
                const float32 = new Float32Array(vec);
                try {
                    db.prepare('INSERT INTO vec_entities (rowid, embedding) VALUES ((SELECT rowid FROM entities WHERE id = ?), ?)').run(id, Buffer.from(float32.buffer));
                } catch (e) { console.warn("Entity embedding insert failed:", e); }
            }).catch(e => console.error("Embedding generation failed:", e));

            return {
                content: [{ type: "text", text: `Created entity '${name}' of type '${type}'` }]
            };
        } catch (error: any) {
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
        const center = args?.center as string | undefined;
        const depth = Math.min((args?.depth as number) || 1, 3);
        const returnJson = (args?.json as boolean) || false;
        
        let nodes: any[] = [];
        let edges: any[] = [];
        let relatedMemories: any[] = [];

        if (center) {
            let centerEntity = db.prepare('SELECT * FROM entities WHERE name = ?').get(center) as any;
            if (!centerEntity) {
                 centerEntity = db.prepare('SELECT * FROM entities WHERE levenshtein(name, ?) <= 2 LIMIT 1').get(center) as any;
            }
            
            if (!centerEntity) {
                  return { content: [{ type: "text", text: `Entity '${center}' not found.` }] };
            }
            
            const query = `
                WITH RECURSIVE bfs(name, depth) AS (
                    SELECT name, 0 FROM entities WHERE name = ?
                    UNION
                    SELECT 
                        CASE WHEN r.source = bfs.name THEN r.target ELSE r.source END, 
                        bfs.depth + 1
                    FROM relations r
                    JOIN bfs ON (r.source = bfs.name OR r.target = bfs.name)
                    WHERE bfs.depth < ?
                )
                SELECT DISTINCT r.source, r.target, r.relation 
                FROM relations r
                JOIN bfs b1 ON r.source = b1.name
                JOIN bfs b2 ON r.target = b2.name
                WHERE b1.depth <= ? AND b2.depth <= ?;
            `;
            
            edges = db.prepare(query).all(centerEntity.name, depth, depth, depth) as any[];
            const nodeNames = new Set<string>([centerEntity.name]);
            edges.forEach(e => { nodeNames.add(e.source); nodeNames.add(e.target); });
            
            const placeholders = Array.from(nodeNames).map(() => '?').join(',');
            nodes = db.prepare(`SELECT * FROM entities WHERE name IN (${placeholders}) ORDER BY importance DESC`).all(...Array.from(nodeNames)) as any[];

            // Fetch top 5 important memories related to center (simple FTS fallback)
            relatedMemories = db.prepare(`
                SELECT content, importance, tags 
                FROM memories 
                WHERE id IN (SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?) 
                ORDER BY importance DESC LIMIT 5
            `).all(`"${centerEntity.name}"`) as any[];

            if (relatedMemories.length === 0) {
                 relatedMemories = db.prepare(`SELECT content, importance, tags FROM memories WHERE content LIKE ? ORDER BY importance DESC LIMIT 5`).all(`%${centerEntity.name}%`) as any[];
            }
            
        } else {
             nodes = db.prepare(`SELECT * FROM entities ORDER BY importance DESC LIMIT 50`).all() as any[];
             const names = nodes.map(n => n.name);
             if (names.length > 0) {
                 const ph = names.map(() => '?').join(',');
                 edges = db.prepare(`SELECT * FROM relations WHERE source IN (${ph}) AND target IN (${ph}) LIMIT 100`).all(...names, ...names) as any[];
             }
        }

        if (returnJson) {
            return { content: [{ type: "text", text: JSON.stringify({ nodes, edges, relatedMemories }, null, 2) }] };
        }

        let output = center ? `Knowledge Graph for "${center}":\n` : `Knowledge Graph Overview:\n`;
        
        if (edges.length > 0) {
            output += "\n--- Relations ---\n";
            output += edges.map(e => `- ${e.source} --(${e.relation})--> ${e.target}`).join('\n');
        } else {
            output += "\nNo relations found in this range.";
        }

        if (nodes.length > 1) {
            output += "\n\n--- Key Entities ---\n";
            output += nodes.map(n => `- ${n.name} (${n.type})${n.importance >= 0.8 ? " ⭐" : ""}`).join('\n');
        }

        if (relatedMemories.length > 0) {
            output += "\n\n--- Top Related Memories ---\n";
            output += relatedMemories.map(m => {
                 const tags = JSON.parse(m.tags || '[]');
                 return `- ${m.content}${tags.length > 0 ? ` [${tags.join(', ')}]` : ''}`;
            }).join('\n');
        }

        return { content: [{ type: "text", text: output }] };
      }

      case "cluster_memories": {
        const k = (args?.k as number) || 5;
        try {
            const { MemoryClusterer } = await import('./lib/clustering.js');
            const clusterer = new MemoryClusterer(db);
            const clusters = await clusterer.cluster(k);
            
            return {
                content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        clusters: clusters
                    }, null, 2),
                },
                ],
            };
        } catch (err: any) {
            return {
                content: [{ type: 'text', text: `Clustering failed: ${err.message}` }],
                isError: true
            };
        }
      }

      case "consolidate_context": {
        const text = args?.text as string;
        const strategy = (args?.strategy as string) || 'nlp';
        const limit = (args?.limit as number) || 5;

        try {
          const { Consolidator } = await import('./lib/consolidator.js');
          const consolidator = new Consolidator(db, async (text) => {
            const vectors = await embedder.embed(text);
            return Array.from(vectors);
          });

          const extracted = await consolidator.extract(text, strategy, limit);

          return {
            content: [{
              type: "text",
              text: `Extracted ${extracted.length} novel memories:\n\n` +
                    extracted.map((m, i) => `${i+1}. ${m.text} (importance: ${m.importance}, tags: ${m.tags.join(', ')})`).join('\n') +
                    `\n\nTo save a memory: remember_fact(text="...", tags=[...])`
            }]
          };
        } catch (err: any) {
          return {
            content: [{ type: 'text', text: `Consolidation failed: ${err.message}` }],
            isError: true
          };
        }
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
