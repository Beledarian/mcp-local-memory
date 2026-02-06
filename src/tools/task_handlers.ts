
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
    
    return {
        conversation_id: id,
        name: name,
        message: `Conversation initialized with ID: ${id}. Content has been offloaded to 'read_resource("memory://current-context")' to prevent output truncation.`
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

// --- Todo Handlers ---

export function handleAddTodo(db: Database, args: { content: string; due_date?: string }) {
    const { content, due_date } = args;
    const id = randomUUID();
    
    db.prepare("INSERT INTO todos (id, content, due_date) VALUES (?, ?, ?)").run(id, content, due_date || null);
    
    return {
        content: [{ type: "text", text: `Todo added (ID: ${id})` }]
    };
}

export function handleCompleteTodo(db: Database, args: { id: string }) {
    const { id } = args;
    const todo = db.prepare("SELECT * FROM todos WHERE id = ?").get(id) as any;
    
    if (!todo) {
        // Return error object compatible with partial result or throw
        throw new Error(`Todo '${id}' not found.`);
    }
    
    // 1. Mark as completed
    db.prepare("UPDATE todos SET status = 'completed' WHERE id = ?").run(id);
    
    // 2. Convert to memory
    const memId = randomUUID();
    const memContent = `Completed task: ${todo.content}`;
    db.prepare("INSERT INTO memories (id, content, tags) VALUES (?, ?, ?)").run(memId, memContent, JSON.stringify(["task", "completion"]));
    
    return {
        content: [{ type: "text", text: `Todo completed and saved to memory.` }]
    };
}

export function handleListTodos(db: Database, args: { status?: string; limit?: number }) {
    const status = args.status || 'pending';
    const limit = args.limit || 20;
    
    const todos = db.prepare("SELECT * FROM todos WHERE status = ? ORDER BY created_at DESC LIMIT ?").all(status, limit) as any[];
    
    const list = todos.map(t => `- [${t.status === 'completed' ? 'x' : ' '}] ${t.content} (ID: ${t.id})`).join('\\n');
    
    return {
        content: [{ type: "text", text: list || "No todos found." }]
    };
}
