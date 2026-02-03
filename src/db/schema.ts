import { Database } from 'better-sqlite3';

export function initSchema(db: Database) {
  // Enable Write-Ahead Logging (WAL) for better concurrency and performance
  db.pragma('journal_mode = WAL');

  // Create memories table
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      source TEXT,
      tags TEXT, -- JSON string array
      importance FLOAT DEFAULT 0.5,
      last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP,
      access_count INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
  `);

  // Migration: Add importance to memories if missing
  const memoriesInfo = db.pragma('table_info(memories)') as any[];
  if (!memoriesInfo.some(col => col.name === 'importance')) {
      console.error("[Schema] Migrating: Adding 'importance' to memories table");
      db.exec('ALTER TABLE memories ADD COLUMN importance FLOAT DEFAULT 0.5');
  }
  if (!memoriesInfo.some(col => col.name === 'last_accessed')) {
      console.error("[Schema] Migrating: Adding 'last_accessed' to memories table");
      // Note: SQLite doesn't allow expressions like CURRENT_TIMESTAMP as defaults in ALTER TABLE on older versions
      db.exec('ALTER TABLE memories ADD COLUMN last_accessed DATETIME');
      db.exec('UPDATE memories SET last_accessed = created_at WHERE last_accessed IS NULL');
  }
  if (!memoriesInfo.some(col => col.name === 'access_count')) {
      console.error("[Schema] Migrating: Adding 'access_count' to memories table");
      db.exec('ALTER TABLE memories ADD COLUMN access_count INTEGER DEFAULT 0');
  }

  // Create vector table (Memory Embeddings)
  // Note: dimension is hardcoded to 384 (all-MiniLM-L6-v2) 
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_items USING vec0(
        embedding float[384]
      );
    `);
  } catch (error) {
    console.warn("Failed to create virtual vector table for Memories using 'vec0'. Falling back to standard table (No Semantic Search, but Clustering will work).", error);
    db.exec(`CREATE TABLE IF NOT EXISTS vec_items (rowid INTEGER PRIMARY KEY, embedding BLOB)`);
  }

  // Create vector table (Entity Embeddings) for Feature 6.1
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_entities USING vec0(
        embedding float[384]
      );
    `);
  } catch (error) {
     console.warn("Failed to create virtual vector table for Entities using 'vec0'. Falling back to standard table.", error);
     db.exec(`CREATE TABLE IF NOT EXISTS vec_entities (rowid INTEGER PRIMARY KEY, embedding BLOB)`);
  }

  // Create FTS5 virtual table for full-text search
  // content='memories' means it's an "external content" FTS table, saving space
  // But for simplicity and better compatibility with triggers, we'll use a standard FTS table 
  // and sync it with triggers.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      tags
    );
  `);

  // Triggers to keep FTS index in sync with memories table
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
    END;
    
    DROP TRIGGER IF EXISTS memories_ad;
    CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
      DELETE FROM memories_fts WHERE rowid = old.rowid;
    END;

    DROP TRIGGER IF EXISTS memories_au;
    CREATE TRIGGER memories_au AFTER UPDATE OF content, tags ON memories BEGIN
      DELETE FROM memories_fts WHERE rowid = old.rowid;
      INSERT INTO memories_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
    END;
  `);

  // Create entities table (Phase 2)
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      type TEXT,
      observations TEXT, -- JSON array of strings (optional, to store facts about the entity)
      importance FLOAT DEFAULT 0.5
    );
  `);

  // Migration: Add importance to entities if missing
  const entitiesInfo = db.pragma('table_info(entities)') as any[];
  if (!entitiesInfo.some(col => col.name === 'importance')) {
      console.error("[Schema] Migrating: Adding 'importance' to entities table");
      db.exec('ALTER TABLE entities ADD COLUMN importance FLOAT DEFAULT 0.5');
  }

  // Create relations table (Phase 2)
  db.exec(`
    CREATE TABLE IF NOT EXISTS relations (
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      relation TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(source) REFERENCES entities(name) ON DELETE CASCADE,
      FOREIGN KEY(target) REFERENCES entities(name) ON DELETE CASCADE,
      PRIMARY KEY (source, target, relation)
    );
     CREATE TABLE IF NOT EXISTS entity_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(entity_id) REFERENCES entities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      due_date DATETIME,
      status TEXT CHECK(status IN ('pending', 'completed')) DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migration: Move JSON observations to new table if needed
  try {
     const hasObsTable = db.prepare("SELECT count(*) as c FROM entity_observations").get() as any;
     if (hasObsTable.c === 0) {
         // Attempt to migrate old JSON observations
         const entities = db.prepare("SELECT id, observations FROM entities WHERE observations IS NOT NULL AND observations != '[]'").all() as any[];
         if (entities.length > 0) {
             console.log("Migrating entity observations...");
             const insert = db.prepare("INSERT INTO entity_observations (entity_id, content) VALUES (?, ?)");
             const transaction = db.transaction((list) => {
                 for (const ent of list) {
                     try {
                         const obs = JSON.parse(ent.observations);
                         if (Array.isArray(obs)) {
                             for (const o of obs) insert.run(ent.id, o);
                         }
                     } catch (e) { /* ignore parse errors */ }
                 }
             });
             transaction(entities);
             console.log(`Migrated observations for ${entities.length} entities.`);
         }
     }
  } catch (e) {
      console.warn("Migration of observations failed (non-critical):", e);
  }

  // Create conversations table for task scoping
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_active DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_last_active ON conversations(last_active);
  `);

  // Create tasks table (conversation-scoped or global)
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      section TEXT,
      content TEXT NOT NULL,
      status TEXT CHECK(status IN ('pending', 'in-progress', 'complete')) DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_conversation ON tasks(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  `);
}
