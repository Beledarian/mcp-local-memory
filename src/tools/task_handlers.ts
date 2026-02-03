// Tool handlers for conversation and task management
import { randomUUID } from 'crypto';
import { Database } from 'better-sqlite3';

export function handleInitConversation(db: Database, args: { name?: string }) {
    const id = randomUUID();
    const name = args.name || null;
    
    db.prepare(`
        INSERT INTO conversations (id, name, created_at, last_active)
        VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(id, name);
    
    // Gather startup context
    const context: any = {};
    
    // 1. User Info: Find entity representing the user (type='User' or 'Person')
    const userEntity = db.prepare(`
        SELECT name, type FROM entities 
        WHERE type IN ('User', 'Person') 
        ORDER BY importance DESC LIMIT 1
    `).get() as any;
    
    if (userEntity) {
        const observations = db.prepare(`
            SELECT content FROM entity_observations 
            WHERE entity_id = (SELECT id FROM entities WHERE name = ? LIMIT 1)
            ORDER BY created_at DESC LIMIT 5
        `).all(userEntity.name) as any[];
        
        context.user_info = {
            name: userEntity.name,
            type: userEntity.type,
            observations: observations.map(o => o.content)
        };
    } else {
        context.user_info = null;
    }
    
    // 2. Recent Memories: Last 5 memories
    context.recent_memories = db.prepare(`
        SELECT content, created_at FROM memories 
        ORDER BY created_at DESC LIMIT 5
    `).all();
    
    // 3. Important Relations: Top 5 user-related relations
    context.important_relations = db.prepare(`
        SELECT source, relation, target FROM relations
        WHERE source = ? OR target = ?
        LIMIT 5
    `).all(userEntity?.name || '', userEntity?.name || '');
    
    // 4. Active Tasks: Global and conversation tasks
    context.active_tasks = db.prepare(`
        SELECT id, content, status, section FROM tasks
        WHERE status != 'complete'
        ORDER BY created_at DESC LIMIT 10
    `).all();
    
    // 5. Pending Todos
    context.pending_todos = db.prepare(`
        SELECT id, content, due_date FROM todos
        WHERE status = 'pending'
        ORDER BY created_at DESC LIMIT 5
    `).all();
    
    return {
        conversation_id: id,
        name: name,
        message: `Conversation initialized with ID: ${id}`,
        context: context
    };
}

export function handleAddTask(db: Database, args: { content: string; section?: string; conversation_id?: string }) {
    const id = randomUUID();
    const { content, section, conversation_id } = args;
    
    db.prepare(`
        INSERT INTO tasks (id, conversation_id, section, content, status, created_at)
        VALUES (?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
    `).run(id, conversation_id || null, section || null, content);
    
    // Update conversation last_active if conversation_id provided
    if (conversation_id) {
        db.prepare(`UPDATE conversations SET last_active = CURRENT_TIMESTAMP WHERE id = ?`).run(conversation_id);
    }
    
    return {
        task_id: id,
        message: `Task added with ID: ${id}`
    };
}

export function handleUpdateTaskStatus(db: Database, args: { id: string; status: string }) {
    const { id, status } = args;
    
    // Get task to check if it exists and get conversation_id
    const task = db.prepare(`SELECT conversation_id FROM tasks WHERE id = ?`).get(id) as any;
    
    if (!task) {
        throw new Error(`Task with ID ${id} not found`);
    }
    
    const completed_at = status === 'complete' ? new Date().toISOString() : null;
    
    db.prepare(`
        UPDATE tasks 
        SET status = ?, completed_at = ?
        WHERE id = ?
    `).run(status, completed_at, id);
    
    // Update conversation last_active if conversation_id exists
    if (task.conversation_id) {
        db.prepare(`UPDATE conversations SET last_active = CURRENT_TIMESTAMP WHERE id = ?`).run(task.conversation_id);
    }
    
    return {
        message: `Task ${id} updated to status: ${status}`
    };
}

export function handleListTasks(db: Database, args: { conversation_id?: string; status?: string }) {
    const { conversation_id, status } = args;
    
    let query = 'SELECT * FROM tasks WHERE 1=1';
    const params: any[] = [];
    
    if (conversation_id === '__all__') {
        // Show all tasks
    } else if (conversation_id) {
        query += ' AND conversation_id = ?';
        params.push(conversation_id);
    } else {
        // Show global tasks (conversation_id IS NULL)
        query += ' AND conversation_id IS NULL';
    }
    
    if (status) {
        query += ' AND status = ?';
        params.push(status);
    }
    
    query += ' ORDER BY created_at DESC';
    
    const tasks = db.prepare(query).all(...params) as any[];
    
    // Format as markdown checklist
    let output = '# Task List\\n\\n';
    
    if (tasks.length === 0) {
        output += 'No tasks found.\\n';
        return { tasks: output };
    }
    
    // Group by section if applicable
    const sections = new Map<string, any[]>();
    tasks.forEach(task => {
        const section = task.section || 'Uncategorized';
        if (!sections.has(section)) {
            sections.set(section, []);
        }
        sections.get(section)!.push(task);
    });
    
    sections.forEach((taskList, section) => {
        output += `## ${section}\\n`;
        taskList.forEach(task => {
            const checkbox = task.status === 'complete' ? '[x]' : task.status === 'in-progress' ? '[/]' : '[ ]';
            output += `- ${checkbox} ${task.content} (ID: ${task.id})\\n`;
        });
        output += '\\n';
    });
    
    return { tasks: output };
}

export function handleDeleteTask(db: Database, args: { id: string }) {
    const { id } = args;
    
    const result = db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
    
    if (result.changes === 0) {
        throw new Error(`Task with ID ${id} not found`);
    }
    
    return {
        message: `Task ${id} deleted successfully`
    };
}
