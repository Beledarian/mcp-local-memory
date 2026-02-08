#!/usr/bin/env node
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
import { getDb, RESOLVED_DB_PATH } from "./db/client.js";
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
import { loadExtensions } from "./lib/extensions.js";
import * as core from './tools/core.js';

// Load extensions
const EXTENSIONS_PATH = process.env.EXTENSIONS_PATH;
const extensions = await loadExtensions(EXTENSIONS_PATH);

// Initialize DB
const db = getDb();

console.error(`[Server] Database initialized at: ${RESOLVED_DB_PATH}`);

// Initialize Extensions (Startup Hooks)
(async () => {
    for (const ext of extensions) {
        if (ext.init) {
            try {
                console.error(`[Server] Running init hook for ${ext.tool.name}...`);
                await ext.init(db);
                console.error(`[Server] Init hook complete for ${ext.tool.name}`);
            } catch (err: any) {
                console.error(`[Server] Init hook failed for ${ext.tool.name}:`, err.message);
            }
        }
    }
})();

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
        
        // --- ENTITY CONTEXT (User & Agent) ---
        // 1. User Info: Find entity representing the user (type='User' or 'Person')
        const userEntity = db.prepare(`
            SELECT name, type FROM entities 
            WHERE type IN ('User', 'Person') 
            ORDER BY importance DESC LIMIT 1
        `).get() as any;
        
        if (userEntity) {
            context += `=== USER INFO ===\nName: ${userEntity.name} (${userEntity.type})\n`;
            const observations = db.prepare(`
                SELECT content FROM entity_observations 
                WHERE entity_id = (SELECT id FROM entities WHERE name = ? LIMIT 1)
                ORDER BY created_at DESC LIMIT 5
            `).all(userEntity.name) as any[];
            
            if (observations.length > 0) {
                 context += "Observations:\n";
                 observations.forEach((obs: any) => context += `- ${obs.content}\n`);
            }
            context += "\n";
        }
        
        // 1b. Agent Info: Find entity representing the agent (type='AI Agent' or name in ['Antigravity', 'I'])
        const agentEntity = db.prepare(`
            SELECT name, type FROM entities 
            WHERE type = 'AI Agent' OR name = 'I'
            ORDER BY importance DESC
            LIMIT 1
        `).get() as any;
        
        if (agentEntity) {
            context += `=== AGENT INFO ===\nName: ${agentEntity.name} (${agentEntity.type})\n`;
             const observations = db.prepare(`
                SELECT content FROM entity_observations 
                WHERE entity_id = (SELECT id FROM entities WHERE name = ? LIMIT 1)
                ORDER BY created_at DESC LIMIT 5
            `).all(agentEntity.name) as any[];
            
             if (observations.length > 0) {
                 context += "Observations:\n";
                 observations.forEach((obs: any) => context += `- ${obs.content}\n`);
            }
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
    {
      name: "cli",
      description: "Single entry point for all tools using a simplified command-line syntax. Saves tokens by replacing strict JSON schemas. commands: remember, recall, graph, todo, task, entity...",
      inputSchema: {
          type: "object",
          properties: {
              command: { type: "string", description: "The command string to execute." }
          },
          required: ["command"]
      }
    }
  ];

  // Add extensions
  for (const ext of extensions) {
    tools.push(ext.tool);
  }

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
      case "cli": {
        const { handleCLI } = await import('./tools/cli.js');
        return handleCLI(db, embedder, archivist, args?.command as string, extensions);
      }

      case "remember_fact": {
        return await core.handleRememberFact(db, embedder, archivist, args);
      }

      case "remember_facts": {
        return await core.handleRememberFacts(db, embedder, archivist, args);
      }

      case "recall": {
        return await core.handleRecall(db, embedder, args);
      }

      case "forget": {
        return core.handleForget(db, args);
      }

      case "list_recent_memories": {
        return core.handleListRecent(db, args);
      }

      case "export_memories": {
          const { handleExportMemories } = await import('./tools/advanced_ops.js');
          return await handleExportMemories(db, args);
      }

      case "create_entity": {
        const { handleCreateEntity } = await import('./tools/graph_ops.js');
        return handleCreateEntity(db, args, embedder);
      }

      case "create_relation": {
        const { handleCreateRelation } = await import('./tools/graph_ops.js');
        return handleCreateRelation(db, args);
      }

      case "read_graph": {
        const { handleReadGraph } = await import('./tools/graph_reader.js');
        return handleReadGraph(db, args);
      }

      case "cluster_memories": {
        const { handleClusterMemories } = await import('./tools/advanced_ops.js');
        return await handleClusterMemories(db, args);
      }

      case "consolidate_context": {
        const { handleConsolidateContext } = await import('./tools/advanced_ops.js');
        return await handleConsolidateContext(db, args, embedder);
      }

      case "delete_observation": {
        const { handleDeleteObservation } = await import('./tools/graph_ops.js');
        return handleDeleteObservation(db, args);
      }

      case "add_todo": {
        return taskHandlers.handleAddTodo(db, args as any);
      }

      case "complete_todo": {
        return taskHandlers.handleCompleteTodo(db, args as any);
      }

      case "list_todos": {
        return taskHandlers.handleListTodos(db, args as any);
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
          const { handleDeleteRelation } = await import('./tools/graph_ops.js');
          return handleDeleteRelation(db, args);
      }

      case "delete_entity": {
          const { handleDeleteEntity } = await import('./tools/graph_ops.js');
          return handleDeleteEntity(db, args);
      }
      
      case "update_entity": {
          const { handleUpdateEntity } = await import('./tools/graph_ops.js');
          return handleUpdateEntity(db, args, embedder);
      }

      default: {
        // Check if it's an extension tool
        const extension = extensions.find(ext => ext.tool.name === name);
        if (extension) {
            const result = extension.handler(db, args);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        }
        throw new Error(`Unknown tool: ${name}`);
      }
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
