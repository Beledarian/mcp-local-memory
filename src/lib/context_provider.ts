
import { Database } from 'better-sqlite3';

export interface ContextConfig {
    windowLimit: number; // in tokens
    maxEntities: number;
    maxMemories: number;
    todoLimit: number;
}

export const getConfig = (): ContextConfig => {
    const limitEnv = process.env.CONTEXT_WINDOW_LIMIT;
    const tokenLimit = limitEnv ? parseInt(limitEnv, 10) : 2500; // Default 2.5k tokens (~10k chars)
    
    return {
        windowLimit: tokenLimit,
        maxEntities: parseInt(process.env.CONTEXT_MAX_ENTITIES || '10', 10),
        maxMemories: parseInt(process.env.CONTEXT_MAX_MEMORIES || '10', 10),
        todoLimit: parseInt(process.env.CONTEXT_TODO_LIMIT || '5', 10)
    };
};

export const getCurrentContext = (db: Database, config: ContextConfig = getConfig()): string => {
    const charLimit = config.windowLimit * 4;

    // 0. Todo Context (Pending & Overdue)
    const todos = db.prepare(`SELECT * FROM todos WHERE status = 'pending' ORDER BY created_at DESC LIMIT ?`).all(config.todoLimit) as any[];

    // 1. Recent Memories
    const recentMemories = db.prepare(`SELECT content, created_at FROM memories ORDER BY created_at DESC LIMIT ?`).all(config.maxMemories) as any[];
    
    // 2. Active Entities
    let importantEntities: any[] = [];
    try {
            importantEntities = db.prepare(`SELECT id, name, type, observations FROM entities ORDER BY importance DESC LIMIT ?`).all(config.maxEntities) as any[];
    } catch (e) {
            importantEntities = db.prepare(`SELECT id, name, type, observations FROM entities LIMIT ?`).all(config.maxEntities) as any[];
    }

    // 3. Recently Active Entities
    const recentContent = recentMemories.map(m => m.content).join(' ');
    const allEntities = db.prepare('SELECT id, name, type, observations FROM entities').all() as any[];
    const activeEntities = allEntities.filter(e => recentContent.includes(e.name)).slice(0, config.maxEntities);
    
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
        combinedEntities.forEach(e => {
            context += `- ${e.name} [${e.type}]\n`;
            
            try {
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
            } catch (e) {
                // Ignore observation errors
            }
        });
        context += "\n";
    }
    
    // --- ENTITY CONTEXT (User & Agent) ---
    try {
        const userEntity = db.prepare(`
            SELECT id, name, type FROM entities 
            WHERE type IN ('User', 'Person') 
            ORDER BY importance DESC LIMIT 1
        `).get() as any;
        
        if (userEntity) {
            context += `=== USER INFO ===\nName: ${userEntity.name} (${userEntity.type})\n`;
            const observations = db.prepare(`
                SELECT content FROM entity_observations 
                WHERE entity_id = ?
                ORDER BY created_at DESC LIMIT 5
            `).all(userEntity.id) as any[];
            
            if (observations.length > 0) {
                    context += "Observations:\n";
                    observations.forEach((obs: any) => context += `- ${obs.content}\n`);
            }
            context += "\n";
        }
    } catch (e) {
        // Ignore specific user entity errors
    }
    
    try {
        const agentEntity = db.prepare(`
            SELECT id, name, type FROM entities 
            WHERE type = 'AI Agent' OR name = 'I'
            ORDER BY importance DESC
            LIMIT 1
        `).get() as any;
        
        if (agentEntity) {
            context += `=== AGENT INFO ===\nName: ${agentEntity.name} (${agentEntity.type})\n`;
                const observations = db.prepare(`
                SELECT content FROM entity_observations 
                WHERE entity_id = ?
                ORDER BY created_at DESC LIMIT 5
            `).all(agentEntity.id) as any[];
            
                if (observations.length > 0) {
                    context += "Observations:\n";
                    observations.forEach((obs: any) => context += `- ${obs.content}\n`);
            }
                context += "\n";
        }
    } catch (e) {
        // Ignore specific agent entity errors
    }

    // === PROMINENT RELATIONS ===
    try {
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
    } catch (e) {
        // Ignore relation errors
    }
    
    context += "Recent Memories:\n";
    recentMemories.forEach(m => {
        context += `- ${m.content} (${m.created_at})\n`;
    });
    
    // Truncate if needed
    if (context.length > charLimit) {
        context = context.substring(0, charLimit) + "... (truncated)";
    }
    
    return context;
};

export const getTurnContext = (db: Database, config: ContextConfig = getConfig()): string => {
    const charLimit = config.windowLimit * 4;
    
    // Get recent tasks (both global and conversation-specific)
    let recentTasks: any[] = [];
    try {
        recentTasks = db.prepare(`
            SELECT * FROM tasks 
            WHERE status != 'complete'
            ORDER BY created_at DESC LIMIT 5
        `).all() as any[];
    } catch(e) {
        // Ignore task errors (table might not exist yet in tests)
    }

    const recentMemories = db.prepare(`
        SELECT content, created_at FROM memories 
        ORDER BY created_at DESC LIMIT ?
    `).all(config.maxMemories) as any[];
    
    let activeEntities: any[] = [];
    try {
        activeEntities = db.prepare(`
            SELECT name, type FROM entities 
            ORDER BY importance DESC LIMIT ?
        `).all(config.maxEntities) as any[];
    } catch(e) {
         activeEntities = db.prepare(`
            SELECT name, type FROM entities 
            LIMIT ?
        `).all(config.maxEntities) as any[];
    }
    
    let topRelations: any[] = [];
    try {
        topRelations = db.prepare(`
            SELECT source, relation, target 
            FROM relations 
            GROUP BY source, relation, target
            ORDER BY COUNT(*) DESC LIMIT 10
        `).all() as any[];
    } catch(e) {
        // Ignore relation errors
    }
    
    
    let context = "=== TURN CONTEXT (Dynamic Refresh) ===\n\n";
    
    if (recentTasks.length > 0) {
        context += "Active Tasks:\n";
        recentTasks.forEach((t: any) => {
            const status = t.status === 'in-progress' ? '[/]' : '[ ]';
            const section = t.section ? ` (${t.section})` : '';
            context += `${status} ${t.content}${section} (ID: ${t.id})\n`;
        });
        context += "\n";
    }
    
    context += "Active Entities:\n";
    activeEntities.forEach((e: any) => {
        context += `- ${e.name} [${e.type}]\n`;
    });
    context += "\n";
    
    if (topRelations.length > 0) {
        context += "Key Relations:\n";
        topRelations.forEach((r: any) => {
            context += `- ${r.source} --[${r.relation}]--> ${r.target}\n`;
        });
        context += "\n";
    }
    
    context += "Recent Activity:\n";
    recentMemories.forEach((m: any) => {
        const truncated = m.content.length > 80 ? m.content.substring(0, 80) + '...' : m.content;
        context += `- ${truncated}\n`;
    });

    // Truncate if needed
    if (context.length > charLimit) {
        context = context.substring(0, charLimit) + "... (truncated)";
    }
    
    return context;
};
