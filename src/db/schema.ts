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
  `);

  // Migration: Add importance to memories if missing
  const memoriesInfo = db.pragma('table_info(memories)') as any[];
  if (!memoriesInfo.some(col => col.name === 'importance')) {
      console.error("[Schema] Migrating: Adding 'importance' to memories table");
      db.exec('ALTER TABLE memories ADD COLUMN importance FLOAT DEFAULT 0.5');
  }
  if (!memoriesInfo.some(col => col.name === 'last_accessed')) {
      console.error("[Schema] Migrating: Adding 'last_accessed' to memories table");
      db.exec('ALTER TABLE memories ADD COLUMN last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP');
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
  `);
}
