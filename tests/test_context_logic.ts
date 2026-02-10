
import test from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { getTurnContext, getCurrentContext } from '../src/lib/context_provider.js';

test('Context Logic Refactor', async (t) => {
    const db = new Database(':memory:');
    
    // Setup Schema
    db.exec(`
        CREATE TABLE memories (
            id TEXT PRIMARY KEY,
            content TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE entities (
            id TEXT PRIMARY KEY, 
            name TEXT, 
            type TEXT, 
            observations TEXT,
            importance REAL DEFAULT 0.5
        );
        CREATE TABLE relations (
            source TEXT, 
            target TEXT, 
            relation TEXT
        );
         CREATE TABLE tasks (
            id TEXT PRIMARY KEY,
            content TEXT,
            status TEXT DEFAULT 'pending',
            conversation_id TEXT,
            section TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE todos (
            id TEXT PRIMARY KEY,
            content TEXT,
            status TEXT DEFAULT 'pending',
            due_date TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP
        );
        CREATE TABLE entity_observations (
            id TEXT PRIMARY KEY,
            entity_id TEXT,
            content TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Seed Data
    db.prepare("INSERT INTO tasks (id, content, status) VALUES ('1', 'Task A', 'pending')").run();
    db.prepare("INSERT INTO tasks (id, content, status) VALUES ('2', 'Task B', 'in-progress')").run();
    
    db.prepare("INSERT INTO memories (id, content) VALUES ('m1', 'Memory 1')").run();
    db.prepare("INSERT INTO memories (id, content) VALUES ('m2', 'Memory 2')").run();
    
    db.prepare("INSERT INTO entities (id, name, type) VALUES ('e1', 'Entity A', 'Person')").run();
    
    await t.test('Turn Context should list tasks first', () => {
        const context = getTurnContext(db, {
            windowLimit: 1000,
            maxEntities: 5,
            maxMemories: 5,
            todoLimit: 3
        });
        
        console.log("Turn Context:\n", context);
        
        const lines = context.split('\n');
        // Check if "Active Tasks" appears early
        const taskIndex = lines.findIndex(l => l.includes("Active Tasks:"));
        const memoryIndex = lines.findIndex(l => l.includes("Recent Activity:"));
        
        assert.ok(taskIndex !== -1, "Should contain Active Tasks");
        assert.ok(memoryIndex !== -1, "Should contain Recent Activity");
        assert.ok(taskIndex < memoryIndex, "Tasks should appear before memories in Turn Context");
        
        assert.ok(context.includes("[ ] Task A"), "Should verify Task A");
        assert.ok(context.includes("[/] Task B"), "Should verify Task B");
    });
    
    await t.test('Token Limit Truncation', () => {
         const longContext = getTurnContext(db, {
            windowLimit: 10, // 40 chars limit
            maxEntities: 5,
            maxMemories: 5,
            todoLimit: 3
        });
        
        assert.ok(longContext.length <= 40 + 15, "Should be roughly truncated (allow for suffix)");
        assert.ok(longContext.includes("... (truncated)"), "Should include truncated marker");
    });
});
