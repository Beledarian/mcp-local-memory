import { Database } from 'better-sqlite3';

export function initSchema(db: Database) {
  db.pragma('foreign_keys = ON');

  // Enable Write-Ahead Logging (WAL) for better concurrency and performance
  try {
    db.pragma('journal_mode = WAL');
  } catch (err) {
    console.warn("[Schema] Failed to enable WAL mode. This is expected if the database is on a Windows mount in WSL. Falling back to DELETE mode.", err);
    try {
      db.pragma('journal_mode = DELETE');
    } catch (fallbackErr) {
      console.error("[Schema] Failed to fall back to DELETE mode:", fallbackErr);
    }
  }

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
      access_count INTEGER DEFAULT 0,
      last_reinforced_at DATETIME,
      reinforcement_count INTEGER NOT NULL DEFAULT 0,
      lifecycle_state TEXT NOT NULL DEFAULT 'active'
        CHECK(lifecycle_state IN ('active', 'outdated', 'incorrect'))
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
  if (!memoriesInfo.some(col => col.name === 'last_reinforced_at')) {
      console.error("[Schema] Migrating: Adding explicit reinforcement timestamp");
      db.exec('ALTER TABLE memories ADD COLUMN last_reinforced_at DATETIME');
  }
  if (!memoriesInfo.some(col => col.name === 'reinforcement_count')) {
      console.error("[Schema] Migrating: Adding explicit reinforcement count");
      db.exec('ALTER TABLE memories ADD COLUMN reinforcement_count INTEGER NOT NULL DEFAULT 0');
  }
  if (!memoriesInfo.some(col => col.name === 'lifecycle_state')) {
      console.error("[Schema] Migrating: Adding auditable memory lifecycle state");
      db.exec(`
        ALTER TABLE memories
        ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'active'
          CHECK(lifecycle_state IN ('active', 'outdated', 'incorrect'))
      `);
  }
  // Historical recall logic could push importance above 1.0. Keep stored and
  // scored values within the documented range.
  db.exec(`
    UPDATE memories
    SET importance = CASE
      WHEN importance IS NULL THEN 0.5
      WHEN importance < 0 THEN 0
      WHEN importance > 1 THEN 1
      ELSE importance
    END
  `);
  // Enforce the cap for every writer, including third-party extensions.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_importance_cap_insert
    AFTER INSERT ON memories
    WHEN new.importance IS NULL OR new.importance < 0 OR new.importance > 1
    BEGIN
      UPDATE memories
      SET importance = CASE
        WHEN new.importance IS NULL THEN 0.5
        WHEN new.importance < 0 THEN 0
        ELSE 1
      END
      WHERE rowid = new.rowid;
    END;

    CREATE TRIGGER IF NOT EXISTS memories_importance_cap_update
    AFTER UPDATE OF importance ON memories
    WHEN new.importance IS NULL OR new.importance < 0 OR new.importance > 1
    BEGIN
      UPDATE memories
      SET importance = CASE
        WHEN new.importance IS NULL THEN 0.5
        WHEN new.importance < 0 THEN 0
        ELSE 1
      END
      WHERE rowid = new.rowid;
    END;

    CREATE TABLE IF NOT EXISTS memory_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      signal TEXT NOT NULL
        CHECK(signal IN (
          'used', 'important', 'irrelevant', 'incorrect', 'outdated', 'restore'
        )),
      delta FLOAT NOT NULL,
      reason TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_memory_feedback_recent
      ON memory_feedback(memory_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_memories_lifecycle_state
      ON memories(lifecycle_state);

    CREATE TABLE IF NOT EXISTS memory_recall_exposures (
      memory_id TEXT NOT NULL,
      query_hash TEXT NOT NULL,
      recalled_on TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(memory_id, query_hash, recalled_on),
      FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_memory_recall_exposures_date
      ON memory_recall_exposures(recalled_on);
  `);

  const feedbackSchema = db.prepare(`
    SELECT sql FROM sqlite_master
    WHERE type = 'table' AND name = 'memory_feedback'
  `).get() as { sql?: string } | undefined;
  if (
    feedbackSchema?.sql &&
    (!feedbackSchema.sql.includes("'outdated'") ||
      !feedbackSchema.sql.includes("'restore'"))
  ) {
    console.error("[Schema] Migrating: Expanding memory feedback signals");
    db.exec(`
      ALTER TABLE memory_feedback RENAME TO memory_feedback_legacy;
      CREATE TABLE memory_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL,
        signal TEXT NOT NULL
          CHECK(signal IN (
            'used', 'important', 'irrelevant', 'incorrect', 'outdated', 'restore'
          )),
        delta FLOAT NOT NULL,
        reason TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );
      INSERT INTO memory_feedback(id, memory_id, signal, delta, reason, created_at)
      SELECT id, memory_id, signal, delta, reason, created_at
      FROM memory_feedback_legacy;
      DROP TABLE memory_feedback_legacy;
      CREATE INDEX idx_memory_feedback_recent
        ON memory_feedback(memory_id, created_at);
    `);
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
    console.warn("[Vector] vec0 memory table unavailable; using non-searchable fallback storage.");
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
     console.warn("[Vector] vec0 entity table unavailable; using non-searchable fallback storage.");
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
  // Creating FTS after memories already exist does not backfill old rows.
  db.exec(`
    INSERT INTO memories_fts(rowid, content, tags)
    SELECT memories.rowid, memories.content, memories.tags
    FROM memories
    WHERE NOT EXISTS (
      SELECT 1 FROM memories_fts
      WHERE memories_fts.rowid = memories.rowid
    )
  `);

  // Create entities table (Phase 2)
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      type TEXT,
      observations TEXT, -- JSON array of strings (optional, to store facts about the entity)
      importance FLOAT DEFAULT 0.5,
      auto_generated INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Migration: Add importance to entities if missing
  const entitiesInfo = db.pragma('table_info(entities)') as any[];
  if (!entitiesInfo.some(col => col.name === 'importance')) {
      console.error("[Schema] Migrating: Adding 'importance' to entities table");
      db.exec('ALTER TABLE entities ADD COLUMN importance FLOAT DEFAULT 0.5');
  }
  if (!entitiesInfo.some(col => col.name === 'auto_generated')) {
      console.error("[Schema] Migrating: Adding provenance marker to entities table");
      db.exec('ALTER TABLE entities ADD COLUMN auto_generated INTEGER NOT NULL DEFAULT 0');
  }
  db.exec(`
    UPDATE entities
    SET importance = CASE
      WHEN importance IS NULL THEN 0.5
      WHEN importance < 0 THEN 0
      WHEN importance > 1 THEN 1
      ELSE importance
    END;

    CREATE TRIGGER IF NOT EXISTS entities_importance_cap_insert
    AFTER INSERT ON entities
    WHEN new.importance IS NULL OR new.importance < 0 OR new.importance > 1
    BEGIN
      UPDATE entities
      SET importance = CASE
        WHEN new.importance IS NULL THEN 0.5
        WHEN new.importance < 0 THEN 0
        ELSE 1
      END
      WHERE rowid = new.rowid;
    END;

    CREATE TRIGGER IF NOT EXISTS entities_importance_cap_update
    AFTER UPDATE OF importance ON entities
    WHEN new.importance IS NULL OR new.importance < 0 OR new.importance > 1
    BEGIN
      UPDATE entities
      SET importance = CASE
        WHEN new.importance IS NULL THEN 0.5
        WHEN new.importance < 0 THEN 0
        ELSE 1
      END
      WHERE rowid = new.rowid;
    END;
  `);

  // Create relations table (Phase 2)
  db.exec(`
    CREATE TABLE IF NOT EXISTS relations (
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      relation TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      auto_generated INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(source) REFERENCES entities(name) ON DELETE CASCADE ON UPDATE CASCADE,
      FOREIGN KEY(target) REFERENCES entities(name) ON DELETE CASCADE ON UPDATE CASCADE,
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

  const relationsInfo = db.pragma('table_info(relations)') as any[];
  if (!relationsInfo.some(col => col.name === 'auto_generated')) {
      console.error("[Schema] Migrating: Adding provenance marker to relations table");
      db.exec('ALTER TABLE relations ADD COLUMN auto_generated INTEGER NOT NULL DEFAULT 0');
  }

  // Migration: Add ON UPDATE CASCADE to relations if missing
  // We can check if we can run a dummy update or checking SQL
  // Easier: check sql from sqlite_master
  const relationsSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='relations'").get() as any;
      if (relationsSql && !relationsSql.sql.includes('ON UPDATE CASCADE')) {
      console.error("[Schema] Migrating: Recreating relations table with ON UPDATE CASCADE");
      db.transaction(() => {
          db.exec("ALTER TABLE relations RENAME TO relations_old");
          db.exec(`
            CREATE TABLE relations (
              source TEXT NOT NULL,
              target TEXT NOT NULL,
              relation TEXT NOT NULL,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              auto_generated INTEGER NOT NULL DEFAULT 0,
              FOREIGN KEY(source) REFERENCES entities(name) ON DELETE CASCADE ON UPDATE CASCADE,
              FOREIGN KEY(target) REFERENCES entities(name) ON DELETE CASCADE ON UPDATE CASCADE,
              PRIMARY KEY (source, target, relation)
            )
          `);
          db.exec(`
            INSERT INTO relations(source, target, relation, created_at, auto_generated)
            SELECT source, target, relation, created_at,
                   COALESCE(auto_generated, 0)
            FROM relations_old
          `);
          db.exec("DROP TABLE relations_old");
      })();
  }

  // Track which graph facts came from which source memory so forget can remove
  // only auto-generated knowledge that no other memory still supports.
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_entities (
      memory_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      PRIMARY KEY(memory_id, entity_id),
      FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY(entity_id) REFERENCES entities(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_memory_entities_entity
      ON memory_entities(entity_id);

    CREATE TABLE IF NOT EXISTS memory_relations (
      memory_id TEXT NOT NULL,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      relation TEXT NOT NULL,
      PRIMARY KEY(memory_id, source, target, relation),
      FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY(source, target, relation)
        REFERENCES relations(source, target, relation) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_memory_relations_relation
      ON memory_relations(source, target, relation);
  `);

  // Migration: Move JSON observations to new table if needed
  try {
     const hasObsTable = db.prepare("SELECT count(*) as c FROM entity_observations").get() as any;
     if (hasObsTable.c === 0) {
         // Attempt to migrate old JSON observations
         const entities = db.prepare("SELECT id, observations FROM entities WHERE observations IS NOT NULL AND observations != '[]'").all() as any[];
         if (entities.length > 0) {
             console.error("Migrating entity observations...");
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
             console.error(`Migrated observations for ${entities.length} entities.`);
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
