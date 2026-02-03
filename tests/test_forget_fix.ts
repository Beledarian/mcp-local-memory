
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { v4 as uuidv4 } from 'uuid';

/**
 * Test for the 'forget' tool fix.
 * Specifically checks that deleting a memory correctly cleans up both 
 * the 'memories' table and the 'vec_items' table without triggering
 * a "SQL logic error" from FTS5 triggers.
 */
async function testForgetFix() {
    console.log("🚀 Starting Forget Tool Fix Test...");
    
    const db = new Database(':memory:');
    sqliteVec.load(db);

    // Minimal schema for test
    db.exec(`
        CREATE TABLE memories (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            tags TEXT
        );

        CREATE VIRTUAL TABLE vec_items USING vec0(
            embedding float[4]
        );

        CREATE VIRTUAL TABLE memories_fts USING fts5(
            content,
            tags
        );

        -- Standard DELETE syntax (The Fix)
        CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
            DELETE FROM memories_fts WHERE rowid = old.rowid;
        END;

        -- We also need the AI trigger to populate FTS
        CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
            INSERT INTO memories_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
        END;
    `);

    const memoryId = uuidv4();
    const content = "The quick brown fox jumps over the lazy dog";
    const tags = JSON.stringify(["animal", "action"]);

    // 1. Insert memory
    console.log("1. Inserting memory...");
    const info = db.prepare('INSERT INTO memories (id, content, tags) VALUES (?, ?, ?)').run(memoryId, content, tags);
    const rowid = info.lastInsertRowid;

    // 2. Insert vector
    console.log("2. Inserting vector...");
    const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    db.prepare('INSERT INTO vec_items (rowid, embedding) VALUES ((SELECT rowid FROM memories WHERE id = ?), ?)').run(memoryId, Buffer.from(embedding.buffer));

    // 3. Verify FTS exists
    const ftsCheck = db.prepare('SELECT count(*) as count FROM memories_fts').get() as any;
    console.log(`FTS count before delete: ${ftsCheck.count}`);

    // 4. Perform "forget" (The fix test)
    console.log("3. Attempting to forget (delete)...");
    try {
        const deleteTx = db.transaction(() => {
            db.prepare('DELETE FROM vec_items WHERE rowid = ?').run(rowid);
            db.prepare('DELETE FROM memories WHERE id = ?').run(memoryId);
        });
        deleteTx();
        console.log("✅ Success: Memory forgotten without SQL errors.");
    } catch (err: any) {
        console.error("❌ Failure: Error during forget operation:", err.message);
        process.exit(1);
    }

    // 5. Final validation
    const memCount = db.prepare('SELECT count(*) as count FROM memories WHERE id = ?').get(memoryId) as any;
    const vecCount = db.prepare('SELECT count(*) as count FROM vec_items WHERE rowid = ?').get(rowid) as any;
    const ftsCount = db.prepare('SELECT count(*) as count FROM memories_fts').get() as any;

    if (memCount.count === 0 && vecCount.count === 0 && ftsCount.count === 0) {
        console.log("✅ Validation passed: All indices cleaned up.");
    } else {
        console.error("❌ Validation failed: Orphaned records found.");
        console.error({ memCount, vecCount, ftsCount });
        process.exit(1);
    }
}

testForgetFix().catch(err => {
    console.error(err);
    process.exit(1);
});
