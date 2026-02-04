import Database from 'better-sqlite3';
import { handleInitConversation } from '../src/tools/task_handlers.js';
import { randomUUID } from 'crypto';

const db = new Database(':memory:');

// Setup Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    observations TEXT,
    importance REAL
  );
  CREATE TABLE IF NOT EXISTS relations (
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    relation TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source, target, relation)
  );
  CREATE TABLE IF NOT EXISTS entity_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(entity_id) REFERENCES entities(id)
  );
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    tags TEXT,
    importance REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_accessed DATETIME,
    access_count INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_active DATETIME
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    section TEXT,
    content TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
  );
  CREATE TABLE IF NOT EXISTS todos (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    due_date TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
  );
`);

async function run() {
    console.log("=== Test: Dynamic Agent Identity Lookup ===");

    // Insert Test Entities
    const idAntigravity = randomUUID();
    const idI = randomUUID();
    const idAgentX = randomUUID();

    const insertEntity = db.prepare("INSERT INTO entities (id, name, type, importance) VALUES (?, ?, ?, ?)");
    
    // Scenario 1: 'I' has higher importance
    insertEntity.run(idAntigravity, 'Antigravity', 'AI Agent', 0.5);
    insertEntity.run(idI, 'I', 'Person', 0.9); // 'I' is not type 'AI Agent' but should be found by name 'I'
    insertEntity.run(idAgentX, 'Agent X', 'AI Agent', 0.3);

    console.log("Scenario 1: 'I' (importance 0.9) vs Antigravity (0.5)");
    let result = handleInitConversation(db, { name: "Test 1" });
    
    // We check the agent_info in the returned context
    // console.log("Result Agent:", result.context.agent_info);
    
    if (result.context.agent_info?.name === 'I') {
        console.log("✅ Correctly identified 'I' as the agent.");
    } else {
        console.error(`❌ Failed: Expected 'I', got '${result.context.agent_info?.name}'`);
    }

    // Scenario 2: 'Antigravity' has higher importance
    // Update importance
    db.prepare("UPDATE entities SET importance = 1.0 WHERE name = 'Antigravity'").run();
    
    console.log("\nScenario 2: Antigravity (importance 1.0) vs 'I' (0.9)");
    result = handleInitConversation(db, { name: "Test 2" });
    
    if (result.context.agent_info?.name === 'Antigravity') {
        console.log("✅ Correctly identified 'Antigravity' as the agent based on importance.");
    } else {
        console.error(`❌ Failed: Expected 'Antigravity', got '${result.context.agent_info?.name}'`);
    }

     // Scenario 3: Pure AI Agent check
    db.prepare("DELETE FROM entities WHERE name = 'I'").run();
    db.prepare("UPDATE entities SET importance = 0.2 WHERE name = 'Antigravity'").run();
    db.prepare("UPDATE entities SET importance = 0.8 WHERE name = 'Agent X'").run();

    console.log("\nScenario 3: Agent X (0.8) vs Antigravity (0.2), no 'I'");
    result = handleInitConversation(db, { name: "Test 3" });

     if (result.context.agent_info?.name === 'Agent X') {
        console.log("✅ Correctly identified 'Agent X' as the most important AI Agent.");
    } else {
        console.error(`❌ Failed: Expected 'Agent X', got '${result.context.agent_info?.name}'`);
    }

}

run().catch(console.error);
