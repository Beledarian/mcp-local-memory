
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { initSchema } from '../src/db/schema.js';
import { getDb } from '../src/db/client.js';
import fs from 'fs-extra';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'test_graph_ops.db');

// Mock helpers
function createApi(db: any) {
    return {
        delete_relation: (source: string, target: string, relation: string) => {
             const res = db.prepare("DELETE FROM relations WHERE source = ? AND target = ? AND relation = ?").run(source, target, relation);
             return res.changes;
        },
        delete_entity: (name: string) => {
            const entity = db.prepare("SELECT id FROM entities WHERE name = ?").get(name) as any;
            if (!entity) return 0;
            
            let changes = 0;
            const tx = db.transaction(() => {
                db.prepare("DELETE FROM entity_observations WHERE entity_id = ?").run(entity.id);
                // Cascade relations
                db.prepare("DELETE FROM relations WHERE source = ? OR target = ?").run(name, name);
                
                const rowid = db.prepare("SELECT rowid FROM entities WHERE id = ?").get(entity.id) as any;
                if (rowid) db.prepare("DELETE FROM vec_entities WHERE rowid = ?").run(rowid.rowid);
                
                changes = db.prepare("DELETE FROM entities WHERE id = ?").run(entity.id).changes;
            });
            tx();
            return changes;
        },
        update_entity: (currentName: string, newName?: string, newType?: string) => {
            const entity = db.prepare("SELECT id, name, type FROM entities WHERE name = ?").get(currentName) as any;
            if (!entity) return 0;
            
            const updates: string[] = [];
            const params: any[] = [];
            
            if (newName && newName !== currentName) {
                updates.push("name = ?");
                params.push(newName);
            }
            if (newType && newType !== entity.type) {
                updates.push("type = ?");
                params.push(newType);
            }
            
            if (updates.length > 0) {
                 db.prepare(`UPDATE entities SET ${updates.join(", ")} WHERE id = ?`).run(...params, entity.id);
                 if (newName && newName !== currentName) {
                      db.prepare("UPDATE relations SET source = ? WHERE source = ?").run(newName, currentName);
                      db.prepare("UPDATE relations SET target = ? WHERE target = ?").run(newName, currentName);
                 }
                 return 1;
            }
            return 0;
        }
    };
}

async function runTests() {
    console.log("Setting up test DB...");
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    
    // Initialize
    const db = new Database(TEST_DB_PATH);
    process.env.MEMORY_DB_PATH = TEST_DB_PATH; // Hack for schema if needed, but we call initSchema directly
    initSchema(db);
    
    const api = createApi(db);
    
    // --- Setup Data ---
    const idA = uuidv4();
    const idB = uuidv4();
    const idNot = uuidv4();
    
    db.prepare("INSERT INTO entities (id, name, type, observations) VALUES (?, ?, ?, ?)").run(idA, 'Jules', 'Persona', '[]');
    db.prepare("INSERT INTO entities (id, name, type, observations) VALUES (?, ?, ?, ?)").run(idB, 'User', 'Person', '[]');
    db.prepare("INSERT INTO entities (id, name, type, observations) VALUES (?, ?, ?, ?)").run(idNot, 'NOT', 'Concept', '[]');
    
    db.prepare("INSERT INTO relations (source, target, relation) VALUES (?, ?, ?)").run('Jules', 'NOT', 'is');
    db.prepare("INSERT INTO relations (source, target, relation) VALUES (?, ?, ?)").run('Jules', 'User', 'helps');
    
    console.log("Initial state created.");
    
    // --- Test 1: Delete Relation ---
    console.log("Test 1: Delete Relation ('Jules' --is--> 'NOT')...");
    const d1 = api.delete_relation('Jules', 'NOT', 'is');
    if (d1 !== 1) throw new Error("Failed to delete relation");
    
    const check1 = db.prepare("SELECT * FROM relations WHERE source = 'Jules' AND target = 'NOT'").get();
    if (check1) throw new Error("Relation still exists!");
    console.log("✅ Custom relation delete passed.");
    
    // --- Test 2: Cascade Delete Entity ---
    // Re-add relation for cascade test
    db.prepare("INSERT INTO relations (source, target, relation) VALUES (?, ?, ?)").run('Jules', 'NOT', 'is_related_to');
    
    console.log("Test 2: Delete Entity ('NOT') with cascade...");
    const d2 = api.delete_entity('NOT');
    if (d2 !== 1) throw new Error("Failed to delete entity");
    
    const checkEntity = db.prepare("SELECT * FROM entities WHERE name = 'NOT'").get();
    if (checkEntity) throw new Error("Entity 'NOT' still exists!");
    
    const checkRel = db.prepare("SELECT * FROM relations WHERE target = 'NOT'").get();
    if (checkRel) throw new Error("Cascade delete failed! Relation to 'NOT' still exists.");
    console.log("✅ Entity delete with cascade passed.");
    
    // --- Test 3: Update Entity ---
    console.log("Test 3: Update Entity ('Jules' -> 'Jules_Agent') and relations...");
    const d3 = api.update_entity('Jules', 'Jules_Agent', 'AI');
    if (d3 !== 1) throw new Error("Failed to update entity");
    
    const checkUpdate = db.prepare("SELECT * FROM entities WHERE name = 'Jules_Agent' AND type = 'AI'").get();
    if (!checkUpdate) throw new Error("Entity update failed values.");
    
    const checkRelUpdate = db.prepare("SELECT * FROM relations WHERE source = 'Jules_Agent'").get();
    if (!checkRelUpdate) throw new Error("Relation update (source name) failed.");
    console.log("✅ Entity update passed.");

    console.log("🎉 All tests passed!");
    
    // Cleanup
    db.close();
    fs.unlinkSync(TEST_DB_PATH);
}

runTests().catch(e => {
    console.error("❌ Test failed:", e);
    process.exit(1);
});
