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
import * as chrono from 'chrono-node';
import {
  CREATE_ENTITY_TOOL,
  CREATE_RELATION_TOOL,
  EXPORT_MEMORIES_TOOL,
  FORGET_TOOL,
  LIST_RECENT_MEMORIES_TOOL,
  READ_GRAPH_TOOL,
  RECALL_TOOL,
  REMEMBER_FACT_TOOL,
  REMEMBER_FACTS_TOOL,
  CLUSTER_MEMORIES_TOOL,
  CONSOLIDATE_CONTEXT_TOOL,
  DELETE_OBSERVATION_TOOL,
  ADD_TODO_TOOL,
  COMPLETE_TODO_TOOL,
  LIST_TODOS_TOOL,
  INIT_CONVERSATION_TOOL,
  ADD_TASK_TOOL,
  UPDATE_TASK_STATUS_TOOL,
  LIST_TASKS_TOOL,
  DELETE_TASK_TOOL,
  DELETE_RELATION_TOOL,
  DELETE_ENTITY_TOOL,
  UPDATE_ENTITY_TOOL
} from "./tools/definitions.js";
import { getArchivist } from "./lib/archivist.js";
import * as taskHandlers from './tools/task_handlers.js';

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
            },
            {
                uri: "memory://turn-context",
                name: "Turn Context",
                description: "Dynamic mid-conversation refresh of active tasks, entities, and recent activity.",
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
        
        // 0. Todo Context (Pending & Overdue)
        const todoLimit = parseInt(process.env.CONTEXT_TODO_LIMIT || '3');
        const todos = db.prepare(`SELECT * FROM todos WHERE status = 'pending' ORDER BY created_at DESC LIMIT ?`).all(todoLimit) as any[];

        // 1. Recent Memories
        const recentMemories = db.prepare(`SELECT content, created_at FROM memories ORDER BY created_at DESC LIMIT ?`).all(memoriesLimit) as any[];
        
        // 2. Active Entities (Entities mentioned in recent memories)
        // Accessing 'tags' is a cheap proxy if NLP filled them, or we scan content?
        // Better: Find entities that were updated recently? Or just global VIPs + search?
        // Let's stick to Global VIPs + Manual "Active" list if we had one.
        // For now: Global Importance is the most reliable signal we have.
        // IMPROVEMENT: "Entities recently modified or created"
        // Let's add: Top N Important Entities
        let importantEntities: any[] = [];
        try {
             importantEntities = db.prepare(`SELECT id, name, type, observations FROM entities ORDER BY importance DESC LIMIT ?`).all(entitiesLimit) as any[];
        } catch (e) {
             importantEntities = db.prepare(`SELECT id, name, type, observations FROM entities LIMIT ?`).all(entitiesLimit) as any[];
        }

        // 3. Recently Active Entities (Created/Updated recently)
        // We assume 'rowid' is roughly chronological or 'id' if time-sortable. 
        // Best proxy without a 'updated_at' column is just reliance on importance or recent memories content.
        // Let's try to match entities in recent memories content (simple string match)
        const recentContent = recentMemories.map(m => m.content).join(' ');
        // Find entities whose names appear in recent content
        // This is a "Poor man's active context" but effective locally.
        // This is a "Poor man's active context" but effective locally.
        const allEntities = db.prepare('SELECT id, name, type, observations FROM entities').all() as any[];
        const activeEntities = allEntities.filter(e => recentContent.includes(e.name)).slice(0, entitiesLimit);
        
        // Deduplicate Important vs Active
        const combinedEntities = [...importantEntities];
        activeEntities.forEach(ae => {
            if (!combinedEntities.find(ce => ce.name === ae.name)) {
                combinedEntities.push(ae);
            }
        });
        
        let context = "=== CURRENT CONTEXT ===\n\n";

        if (todos.length > 0) {
            context += "Active Todos:\n";
            todos.forEach(t => {
                const due = t.due_date ? ` (Due: ${t.due_date})` : '';
                context += `[ ] ${t.content}${due} (ID: ${t.id})\n`;
            });
            context += "\n";
        }
        
        if (combinedEntities.length > 0) {
            context += "Relevant Entities:\n";
            
             // Fetch observations from new table for these entities
            const entityIds = combinedEntities.map(e => e.id); // Assuming entities have 'id' select in previous query? 
            // The query was `SELECT name, type, observations FROM entities` -> NO ID.
            // We need to fetch ID to join.
            // Let's rely on name for now or fetch ID.
            // Actually, let's just fetch IDs in step 2.
            // Since we can't easily change the previous query without context, let's just do a name look up or subquery?
            // Better: update step 2 query to include ID.
            
            combinedEntities.forEach(e => {
                context += `- ${e.name} [${e.type}]\n`;
                
                // Fetch top 3 observations for this entity
                const observations = db.prepare(`
                    SELECT content FROM entity_observations 
                    WHERE entity_id = ? 
                    ORDER BY created_at DESC 
                    LIMIT 3
                `).all(e.id) as any[];
                
                if (observations.length > 0) {
                    observations.forEach((obs: any) => {
                        const truncated = obs.content.length > 60 ? obs.content.substring(0, 60) + '...' : obs.content;
                        context += `    • ${truncated}\n`;
                    });
                }
            });
            context += "\n";
        }
        
        // === PROMINENT RELATIONS ===
        const topRelations = db.prepare(`
            SELECT source, relation, target, COUNT(*) as freq
            FROM relations
            GROUP BY source, relation, target
            ORDER BY freq DESC
            LIMIT 10
        `).all() as any[];
        
        if (topRelations.length > 0) {
            context += "Prominent Relations:\n";
            topRelations.forEach((r: any) => {
                context += `- ${r.source} --[${r.relation}]--> ${r.target}\n`;
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
    
    if (uri === "memory://turn-context") {
        // Dynamic refresh context
        const recentMemories = db.prepare(`
            SELECT content, created_at FROM memories 
            ORDER BY created_at DESC LIMIT 10
        `).all() as any[];
        
        const activeEntities = db.prepare(`
            SELECT name, type FROM entities 
            ORDER BY importance DESC LIMIT 5
        `).all() as any[];
        
        const topRelations = db.prepare(`
            SELECT source, relation, target 
            FROM relations 
            GROUP BY source, relation, target
            ORDER BY COUNT(*) DESC LIMIT 10
        `).all() as any[];
        
        // Get recent tasks (both global and conversation-specific)
        const recentTasks = db.prepare(`
            SELECT * FROM tasks 
            WHERE status != 'complete'
            ORDER BY created_at DESC LIMIT 5
        `).all() as any[];
        
        let context = "=== TURN CONTEXT (Dynamic Refresh) ===\n\n";
        
        if (recentTasks.length > 0) {
            context += "Active Tasks:\n";
            recentTasks.forEach((t: any) => {
                const status = t.status === 'in-progress' ? '[/]' : '[ ]';
                context += `c:\Users\Laurin\Documents\GitHub\mcp-local-memory{status} c:\Users\Laurin\Documents\GitHub\mcp-local-memory{t.content}\n`;
            });
            context += "\n";
        }
        
        context += "Active Entities:\n";
        activeEntities.forEach((e: any) => {
            context += `- c:\Users\Laurin\Documents\GitHub\mcp-local-memory{e.name} [c:\Users\Laurin\Documents\GitHub\mcp-local-memory{e.type}]\n`;
        });
        context += "\n";
        
        if (topRelations.length > 0) {
            context += "Key Relations:\n";
            topRelations.forEach((r: any) => {
                context += `- c:\Users\Laurin\Documents\GitHub\mcp-local-memory{r.source} --[c:\Users\Laurin\Documents\GitHub\mcp-local-memory{r.relation}]--> c:\Users\Laurin\Documents\GitHub\mcp-local-memory{r.target}\n`;
            });
            context += "\n";
        }
        
        context += "Recent Activity:\n";
        recentMemories.forEach((m: any) => {
            const truncated = m.content.length > 80 ? m.content.substring(0, 80) + '...' : m.content;
            context += `- c:\Users\Laurin\Documents\GitHub\mcp-local-memory{truncated}\n`;
        });
        
        return {
            contents: [{
                uri,
                mimeType: "text/plain",
                text: context
            }]
        };
    }
    
    if (uri === "memory://tasks" || uri.startsWith("memory://tasks-")) {
        // Extract conversation_id if present in URI like memory://tasks-{conversation_id}
        const conversationId = uri.startsWith("memory://tasks-") 
            ? uri.substring("memory://tasks-".length) 
            : null;
        
        // Always show global tasks
        const globalTasks = db.prepare(`
            SELECT id, content, status, section FROM tasks
            WHERE conversation_id IS NULL
            ORDER BY created_at DESC
        `).all() as any[];
        
        let output = "=== TASKS ===\\n\\n";
        
        // Global tasks
        if (globalTasks.length > 0) {
            output += "Global Tasks:\\n";
            globalTasks.forEach((t: any) => {
                const checkbox = t.status === 'complete' ? '[x]' : t.status === 'in-progress' ? '[/]' : '[ ]';
                const section = t.section ? ` (${t.section})` : '';
                output += `${checkbox} ${t.content}${section} (ID: ${t.id})\\n`;
            });
            output += "\\n";
        }
        
        // If conversation_id specified, show that conversation's tasks
        if (conversationId) {
            const conversation = db.prepare(`
                SELECT id, name FROM conversations WHERE id = ?
            `).get(conversationId) as any;
            
            if (conversation) {
                const tasks = db.prepare(`
                    SELECT id, content, status, section FROM tasks
                    WHERE conversation_id = ?
                    ORDER BY section, created_at DESC
                `).all(conversationId) as any[];
                
                if (tasks.length > 0) {
                    output += `Conversation: "${conversation.name || 'Unnamed'}" (ID: ${conversation.id})\\n`;
                    
                    // Group by section
                    const sections = new Map<string, any[]>();
                    tasks.forEach(task => {
                        const section = task.section || 'Uncategorized';
                        if (!sections.has(section)) {
                            sections.set(section, []);
                        }
                        sections.get(section)!.push(task);
                    });
                    
                    sections.forEach((taskList, section) => {
                        output += `  ${section}:\\n`;
                        taskList.forEach(t => {
                            const checkbox = t.status === 'complete' ? '[x]' : t.status === 'in-progress' ? '[/]' : '[ ]';
                            output += `    ${checkbox} ${t.content} (ID: ${t.id})\\n`;
                        });
                    });
                    output += "\\n";
                }
            }
        }
        
        if (globalTasks.length === 0 && !conversationId) {
            output += "No global tasks found.\\n";
        }
        
        return {
            contents: [{
                uri,
                mimeType: "text/plain",
                text: output
            }]
        };
    }
    
    if (uri === "memory://todos") {
        // Show todos separated by status
        const pendingTodos = db.prepare(`
            SELECT id, content, due_date FROM todos
            WHERE status = 'pending'
            ORDER BY due_date, created_at DESC
        `).all() as any[];
        
        const completedTodos = db.prepare(`
            SELECT id, content, completed_at FROM todos
            WHERE status = 'complete'
            ORDER BY completed_at DESC LIMIT 10
        `).all() as any[];
        
        let output = "=== TODOS ===\\n\\n";
        
        output += `Pending (${pendingTodos.length}):\\n`;
        if (pendingTodos.length > 0) {
            pendingTodos.forEach((t: any) => {
                const dueStr = t.due_date ? ` (Due: ${t.due_date})` : '';
                output += `[ ] ${t.content}${dueStr} (ID: ${t.id})\\n`;
            });
        } else {
            output += "No pending todos.\\n";
        }
        output += "\\n";
        
        output += `Completed (${completedTodos.length}):\\n`;
        if (completedTodos.length > 0) {
            completedTodos.forEach((t: any) => {
                output += `[x] ${t.content} (ID: ${t.id})\\n`;
            });
        } else {
            output += "No completed todos.\\n";
        }
        
        return {
            contents: [{
                uri,
                mimeType: "text/plain",
                text: output
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
    REMEMBER_FACTS_TOOL,
    CLUSTER_MEMORIES_TOOL,
    DELETE_OBSERVATION_TOOL,
    ADD_TODO_TOOL,
    COMPLETE_TODO_TOOL,
    LIST_TODOS_TOOL,
    INIT_CONVERSATION_TOOL,
    ADD_TASK_TOOL,
    UPDATE_TASK_STATUS_TOOL,
    LIST_TASKS_TOOL,
    DELETE_TASK_TOOL,
    DELETE_RELATION_TOOL,
    DELETE_ENTITY_TOOL,
    UPDATE_ENTITY_TOOL,
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
        // Fire and forget - don't block the response (LATENCY OPTIMIZATION)
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

      case "remember_facts": {
        const facts = (args?.facts as any[]) || [];
        const results = [];

        // Transactionally insert all text first (Fast)
        const insertTx = db.transaction(() => {
            for (const f of facts) {
                const id = uuidv4();
                f.id = id; // Store for post-processing
                db.prepare(
                    `INSERT INTO memories (id, content, tags, last_accessed, importance) VALUES (?, ?, ?, CURRENT_TIMESTAMP, 0.5)`
                ).run(id, f.text, JSON.stringify(f.tags || []));
            }
        });
        insertTx();

        // Background Processing (Slow)
        // We do NOT await this, to return control to the LLM immediately.
        (async () => {
             for (const f of facts) {
                 try {
                    // 1. Embedding
                    const embedding = await embedder.embed(f.text);
                    const float32Embedding = new Float32Array(embedding);
                    db.prepare(
                        `INSERT INTO vec_items (rowid, embedding) VALUES ((SELECT rowid FROM memories WHERE id = ?), ?)`
                    ).run(f.id, Buffer.from(float32Embedding.buffer));
                    
                    // 2. Archivist
                    await archivist.process(f.text, f.id);
                 } catch (e) {
                     console.error(`Error processing background task for fact ${f.id}:`, e);
                 }
             }
        })();

        return {
            content: [{ type: "text", text: `Queued ${facts.length} facts for memory.` }]
        };
      }

      case "recall": {
        const query = args?.query as string;
        const limit = (args?.limit as number) || 5;
        const returnJson = (args?.json as boolean) || false;
        const showDebug = (args?.debug as boolean) || false;
        
        let startDate: Date | null = args?.startDate ? new Date(args.startDate as string) : null;
        let endDate: Date | null = args?.endDate ? new Date(args.endDate as string) : null;

        let debugSteps = [];
        let semanticQuery = query;

        // 0. Time Tunnel Parsing (Chrono)
        try {
            if (!startDate && !endDate) {
                const parsed = chrono.parse(query, new Date(), { forwardDate: false });
                if (parsed.length > 0) {
                    const result = parsed[0];
                    if (result.start) {
                        startDate = result.start.date();
                        debugSteps.push(`Time Tunnel: Parsed start date: ${startDate.toISOString()}`);
                    }
                    if (result.end) {
                        endDate = result.end.date();
                        debugSteps.push(`Time Tunnel: Parsed end date: ${endDate.toISOString()}`);
                    } else if (startDate) {
                        // If "last week", usually implies a range up to now or end of that period
                        // chrono usually handles "last week" as a specific point or range. 
                        // If no end is explicit, we might want to default to NOW for "since" logic
                        // But let's verify what chrono gives. 
                        // For "last week", chrono gives a specific date. 
                        // If the user says "since last week", start is set.
                        // Let's default endDate to NOW if we have a start date but no end date, assuming a "filter from X" intent?
                        // Actually, strict filtering is safer. Let's start with just what chrono finds.
                    }
                    
                    // Remove the time phrase from the query to improve embedding quality
                    // e.g. "What did I do yesterday" -> "What did I do"
                    if (startDate || endDate) {
                         // escape special regex chars? chrono result.text is usually safe text
                         semanticQuery = query.replace(result.text, "").trim();
                         // Cleanup extra spaces or punctuation left behind
                         semanticQuery = semanticQuery.replace(/\s+/, " ").trim();
                         debugSteps.push(`Time Tunnel: Cleaned query: "${semanticQuery}"`);
                    }
                }
            }
        } catch (err) {
            console.warn("Chrono parsing failed", err);
        }

        try {
            // 1. Get query embedding
            // 1. Get query embedding
            debugSteps.push(`Embedding query: "${semanticQuery}"...`);
            const embedding = await embedder.embed(semanticQuery);
            const float32Embedding = new Float32Array(embedding);

            // 2. Search
            let results: any[] = [];
            let usedSearchMethod = "vector";

            try {
                debugSteps.push("Attempting vector search...");
                // Attempt vector search
                // Dynamic WHERE clause
                let whereClause = "WHERE 1=1";
                const params: any[] = [Buffer.from(float32Embedding.buffer), Buffer.from(float32Embedding.buffer)];

                if (startDate) {
                    whereClause += " AND m.created_at >= ?";
                    params.push(startDate.toISOString());
                }
                if (endDate) {
                    whereClause += " AND m.created_at <= ?";
                    params.push(endDate.toISOString());
                }

                params.push(limit * 2);

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
                    ${whereClause}
                    ORDER BY score DESC
                    LIMIT ?
                    `
                )
                .all(...params) as any[];
                debugSteps.push(`Vector search success. Got ${results.length} results.`);
            } catch (err: any) {
                const msg = `Vector search failed: ${err.message}`;
                console.warn(msg);
                debugSteps.push(msg);
                usedSearchMethod = "fts-fallback";
            }

            // 3. Fallback/Hybrid using FTS
            if (results.length === 0 || usedSearchMethod === "fts-fallback") {
                debugSteps.push("Entering FTS fallback...");
                try {
                    const tokenizeFTSQuery = (q: string): string => {
                        const tokens = q.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(t => t.length > 0).map(t => `"${t}"`);
                        return tokens.length > 0 ? tokens.join(' OR ') : q;
                    };
                    
                    let ftsWhere = "WHERE memories_fts MATCH ?";
                    const ftsParams: any[] = [tokenizeFTSQuery(query)];

                    if (startDate) {
                        ftsWhere += " AND memories.created_at >= ?";
                        ftsParams.push(startDate.toISOString());
                    }
                    if (endDate) {
                        ftsWhere += " AND memories.created_at <= ?";
                        ftsParams.push(endDate.toISOString());
                    }
                    ftsParams.push(limit);
                    
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
                        ${ftsWhere} 
                        ORDER BY rank
                        LIMIT ?
                    `).all(...ftsParams) as any[];
                    
                    results = ftsResults;
                    usedSearchMethod = (usedSearchMethod === "vector") ? "fts-hybrid" : "fts-only";
                    debugSteps.push(`FTS search success. Got ${results.length} results.`);
                } catch (ftsErr: any) {
                    const msg = `FTS search failed: ${ftsErr.message}`;
                    console.error(msg);
                    debugSteps.push(msg);
                    // If both fail, throwing here will be caught by outer catch
                    throw new Error(`Both Vector and FTS search failed. Debug: ${debugSteps.join(' -> ')}`);
                }
            }

            // Post-process boosting
            debugSteps.push("Post-processing...");
            const tagBoost = parseFloat(process.env.TAG_MATCH_BOOST || '0.15');
            const queryLower = query.toLowerCase();
            results = results.map(r => {
                try {
                    const tags = JSON.parse(r.tags || '[]') as string[];
                    const hasExactMatch = tags.some(tag => queryLower.includes(tag.toLowerCase()));
                    return { ...r, score: (r.score || 0) + (hasExactMatch ? tagBoost : 0) };
                } catch { return r; }
            }).sort((a, b) => b.score - a.score).slice(0, limit);

            // Update Access Stats
            if (results.length > 0) {
                try {
                    debugSteps.push("Updating access stats...");
                    const ids = results.map(r => r.id);
                    const ph = ids.map(() => '?').join(',');
                    db.prepare(`UPDATE memories SET last_accessed = CURRENT_TIMESTAMP, access_count = access_count + 1 WHERE id IN (${ph})`).run(...ids);
                    debugSteps.push("Access stats updated.");
                } catch (updateErr: any) {
                    console.warn("Failed to update access stats (non-critical):", updateErr.message);
                    debugSteps.push(`Access stats update failed: ${updateErr.message}`);
                }
            }

            if (returnJson) {
            return { content: [{ type: "text", text: JSON.stringify({ method: usedSearchMethod, results, debug: debugSteps }, null, 2) }] };
            }

            const head = `Recall results for "${query}" (${usedSearchMethod}):\n`;
            const body = results.map(r => {
            const importanceChar = (r.importance || 0) >= 0.8 ? " ⭐" : "";
            const tags = JSON.parse(r.tags || '[]');
            const tagStr = tags.length > 0 ? ` [Tags: ${tags.join(', ')}]` : '';
            
            // Calculate Time Ago
            const created = new Date(r.created_at);
            const now = new Date();
            const diffTime = Math.abs(now.getTime() - created.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
            const timeAgo = diffDays === 1 ? "1 day ago" : `${diffDays} days ago`;

            return `[Score: ${(r.score || 0).toFixed(2)}${importanceChar} | ${timeAgo}] ${r.content}${tagStr}`;
            }).join('\n');

            if (showDebug && !returnJson) {
                const debugHeader = `\n\n--- Debug Info ---\n${debugSteps.join('\n')}`;
                return {
                    content: [{ type: "text", text: head + (body || "No relevant memories found.") + debugHeader }],
                };
            }

            return {
            content: [{ type: "text", text: head + (body || "No relevant memories found.") }],
            };

        } catch (outerErr: any) {
             // Catch all logic errors and return debug info
             return {
                isError: true,
                content: [{ type: "text", text: `Critical Recall Error: ${outerErr.message}\nTrace: ${debugSteps.join(' -> ')}` }]
             };
        }
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
        let existing = db.prepare(`SELECT id, name FROM entities WHERE levenshtein(name, ?) <= 2 LIMIT 1`).get(name) as any;
        
        let entityId = existing?.id;
        let message = "";

        if (existing) {
             message = `Entity '${name}' already exists (as '${existing.name}').`;
             if (observations.length > 0) {
                 const insertObs = db.prepare("INSERT INTO entity_observations (entity_id, content) VALUES (?, ?)");
                 const transaction = db.transaction((obsList) => {
                     for (const obs of obsList) insertObs.run(existing.id, obs);
                 });
                 transaction(observations);
                 message += ` Appended ${observations.length} new observations.`;
             }
        } else {
             entityId = uuidv4();
             db.prepare(`INSERT INTO entities (id, name, type, observations) VALUES (?, ?, ?, ?)`).run(entityId, name, type, "[]");
             
             if (observations.length > 0) {
                 const insertObs = db.prepare("INSERT INTO entity_observations (entity_id, content) VALUES (?, ?)");
                 const transaction = db.transaction((obsList) => {
                     for (const obs of obsList) insertObs.run(entityId, obs);
                 });
                 transaction(observations);
             }
             
             // Generate Entity Embedding
             embedder.embed(name + " " + type).then(vec => {
                const float32 = new Float32Array(vec);
                try {
                    db.prepare('INSERT INTO vec_entities (rowid, embedding) VALUES ((SELECT rowid FROM entities WHERE id = ?), ?)').run(entityId, Buffer.from(float32.buffer));
                } catch (e) { console.warn("Entity embedding insert failed:", e); }
             }).catch(e => console.error("Embedding generation failed:", e));

             message = `Created entity '${name}' of type '${type}'.`;
        }

        return {
            content: [{ type: "text", text: message }]
        };
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
        const { handleReadGraph } = await import('./tools/graph_reader.js');
        return handleReadGraph(db, args);
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

      case "delete_observation": {
          const entityName = args?.entity_name as string;
          const content = (args?.observations as string[]) || []; 
          
          const entity = db.prepare("SELECT id FROM entities WHERE name = ?").get(entityName) as any;
          if (!entity) {
               return { content: [{ type: "text", text: `Entity '${entityName}' not found.` }], isError: true };
          }
          
          let deletedCount = 0;
          const delStmt = db.prepare("DELETE FROM entity_observations WHERE entity_id = ? AND content = ?");
          
          const transaction = db.transaction((items) => {
              for (const obs of items) {
                  const res = delStmt.run(entity.id, obs);
                  deletedCount += res.changes;
              }
          });
          transaction(content);

          return {
              content: [{ type: "text", text: `Deleted ${deletedCount} observations from '${entityName}'.` }]
          };
      }

      case "add_todo": {
          const content = args?.content as string;
          const dueDate = args?.due_date as string | undefined;
          const id = uuidv4();
          
          db.prepare("INSERT INTO todos (id, content, due_date) VALUES (?, ?, ?)").run(id, content, dueDate || null);
          
          return {
              content: [{ type: "text", text: `Todo added (ID: ${id})` }]
          };
      }

      case "complete_todo": {
          const id = args?.id as string;
          const todo = db.prepare("SELECT * FROM todos WHERE id = ?").get(id) as any;
          
          if (!todo) {
              return { content: [{ type: "text", text: `Todo '${id}' not found.` }], isError: true };
          }
          
          // 1. Mark as completed
          db.prepare("UPDATE todos SET status = 'completed' WHERE id = ?").run(id);
          
          // 2. Convert to memory
          const memId = uuidv4();
          const memContent = `Completed task: ${todo.content}`;
          db.prepare("INSERT INTO memories (id, content, tags) VALUES (?, ?, ?)").run(memId, memContent, JSON.stringify(["task", "completion"]));
          
          return {
              content: [{ type: "text", text: `Todo completed and saved to memory.` }]
          };
      }

      case "list_todos": {
          const status = (args?.status as string) || 'pending';
          const limit = (args?.limit as number) || 20;
          
          const todos = db.prepare("SELECT * FROM todos WHERE status = ? ORDER BY created_at DESC LIMIT ?").all(status, limit) as any[];
          
          const list = todos.map(t => `- [${t.status === 'completed' ? 'x' : ' '}] ${t.content} (ID: ${t.id})`).join('\n');
          
          return {
              content: [{ type: "text", text: list || "No todos found." }]
          };
      }


      case "init_conversation":
          return {
              content: [{
                  type: "text",
                  text: JSON.stringify(taskHandlers.handleInitConversation(db, args as any), null, 2)
              }]
          };

      case "add_task":
          return {
              content: [{
                  type: "text",
                  text: JSON.stringify(taskHandlers.handleAddTask(db, args as any), null, 2)
              }]
          };

      case "update_task_status":
          return {
              content: [{
                  type: "text",
                  text: JSON.stringify(taskHandlers.handleUpdateTaskStatus(db, args as any), null, 2)
              }]
          };

      case "list_tasks":
          return {
              content: [{
                  type: "text",
                  text: taskHandlers.handleListTasks(db, args as any).tasks
              }]
          };

      case "delete_task":
          return {
              content: [{
                  type: "text",
                  text: JSON.stringify(taskHandlers.handleDeleteTask(db, args as any), null, 2)
              }]
          };

      case "delete_relation": {
          const source = args?.source as string;
          const target = args?.target as string;
          const relation = args?.relation as string;

          const res = db.prepare("DELETE FROM relations WHERE source = ? AND target = ? AND relation = ?").run(source, target, relation);
          
          if (res.changes === 0) {
              return { content: [{ type: "text", text: `Relation not found: ${source} --[${relation}]--> ${target}` }], isError: true };
          }
          
          return {
              content: [{ type: "text", text: `Deleted relation: ${source} --[${relation}]--> ${target}` }]
          };
      }

      case "delete_entity": {
          const name = args?.name as string;
          
          const entity = db.prepare("SELECT id FROM entities WHERE name = ?").get(name) as any;
          if (!entity) {
               return { content: [{ type: "text", text: `Entity '${name}' not found.` }], isError: true };
          }
          
          const tx = db.transaction(() => {
              // 1. Delete observations
              db.prepare("DELETE FROM entity_observations WHERE entity_id = ?").run(entity.id);
              // 2. Delete relations
              db.prepare("DELETE FROM relations WHERE source = ? OR target = ?").run(name, name);
              // 3. Delete vector embedding
              const rowid = db.prepare("SELECT rowid FROM entities WHERE id = ?").get(entity.id) as any;
              if (rowid) {
                   db.prepare("DELETE FROM vec_entities WHERE rowid = ?").run(rowid.rowid);
              }
              // 4. Delete entity
              db.prepare("DELETE FROM entities WHERE id = ?").run(entity.id);
          });
          tx();
          
          return {
              content: [{ type: "text", text: `Deleted entity '${name}' and all associated data.` }]
          };
      }
      
      case "update_entity": {
          const currentName = args?.current_name as string;
          const newName = args?.new_name as string | undefined;
          const newType = args?.new_type as string | undefined;
          
          const entity = db.prepare("SELECT id, name, type FROM entities WHERE name = ?").get(currentName) as any;
          if (!entity) {
               return { content: [{ type: "text", text: `Entity '${currentName}' not found.` }], isError: true };
          }
          
          const updates: string[] = [];
          const params: (string | undefined)[] = [];
          
          if (newName && newName !== currentName) {
              updates.push("name = ?");
              params.push(newName);
          }
          if (newType && newType !== entity.type) {
              updates.push("type = ?");
              params.push(newType);
          }
          
          if (updates.length > 0) {
              const tx = db.transaction(() => {
                  db.prepare(`UPDATE entities SET ${updates.join(", ")} WHERE id = ?`).run(...params, entity.id);
                  
                  if (newName && newName !== currentName) {
                      db.prepare("UPDATE relations SET source = ? WHERE source = ?").run(newName, currentName);
                      db.prepare("UPDATE relations SET target = ? WHERE target = ?").run(newName, currentName);
                  }
                  
                  // Re-embed if necessary
                  if ((newName && newName !== currentName) || (newType && newType !== entity.type)) {
                       const finalName = newName || currentName;
                       const finalType = newType || entity.type;
                       
                       embedder.embed(finalName + " " + finalType).then(vec => {
                           const float32 = new Float32Array(vec);
                           try {
                               const rowid = db.prepare("SELECT rowid FROM entities WHERE id = ?").get(entity.id) as any;
                               if (rowid) {
                                   db.prepare("DELETE FROM vec_entities WHERE rowid = ?").run(rowid.rowid);
                                   db.prepare("INSERT INTO vec_entities (rowid, embedding) VALUES (?, ?)").run(rowid.rowid, Buffer.from(float32.buffer));
                               }
                           } catch(e) { console.error("Re-embedding failed", e); }
                      }).catch(e => console.error("Re-embedding generation failed", e));
                  }
              });
              tx();
              
              return {
                  content: [{ type: "text", text: `Updated entity '${currentName}'` }]
              };
          } else {
              return { content: [{ type: "text", text: "No changes requested." }] };
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
