
import { Database } from 'better-sqlite3';
import DatabaseConstructor from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

// Mock DB
const db = new DatabaseConstructor(':memory:');
db.exec(`
  CREATE TABLE memories (id TEXT PRIMARY KEY, content TEXT, tags TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE todos (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      due_date DATETIME,
      status TEXT CHECK(status IN ('pending', 'completed')) DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

console.log("1. Add Todo...");
const id = uuidv4();
db.prepare("INSERT INTO todos (id, content, due_date) VALUES (?, ?, ?)").run(id, "Finish Phase 6", "2026-10-01");

const todos = db.prepare("SELECT * FROM todos").all() as any[];
console.log("Todos:", todos);

if (todos.length === 1 && todos[0].content === "Finish Phase 6") {
    console.log("✅ Add Todo success");
} else {
    console.log("❌ Add Todo failed");
}

console.log("2. Complete Todo...");
db.prepare("UPDATE todos SET status = 'completed' WHERE id = ?").run(id);
const completed = db.prepare("SELECT * FROM todos WHERE id = ?").get(id) as any;
console.log("Updated:", completed);

// Mock memory creation
const memId = uuidv4();
db.prepare("INSERT INTO memories (id, content, tags) VALUES (?, ?, ?)").run(memId, `Completed task: ${completed.content}`, JSON.stringify(["task"]));
const memory = db.prepare("SELECT * FROM memories").get() as any;
console.log("Memory:", memory);

if (completed.status === 'completed' && memory.content.includes("Finish Phase 6")) {
    console.log("✅ Complete Todo success");
} else {
    console.log("❌ Complete Todo failed");
}
