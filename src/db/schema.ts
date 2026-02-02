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
      tags TEXT -- JSON string array
    );
  `);

  // Create vector table using vec0
  // Note: dimension is hardcoded to 384 (all-MiniLM-L6-v2) 
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_items USING vec0(
        embedding float[384]
      );
    `);
  } catch (error) {
    // If table exists but with different schema or generic verification failure, we might catch here.
    // However, CREATE VIRTUAL TABLE IF NOT EXISTS usually handles existing tables gracefully 
    // UNLESS the extensions isn't loaded.
    console.warn("Failed to create virtual vector table. sqlite-vec might not be loaded. Semantic search will fail.", error);
    // Do NOT throw error, so the rest of the server (basic memory) can still work
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
    
    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES('delete', old.rowid, old.content, old.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES('delete', old.rowid, old.content, old.tags);
      INSERT INTO memories_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
    END;
  `);

  // Create entities table (Phase 2)
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      type TEXT,
      observations TEXT -- JSON array of strings (optional, to store facts about the entity)
    );
  `);

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
  `);
}
