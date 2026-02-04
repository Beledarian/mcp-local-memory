
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs-extra';
import { getArchivist } from '../src/lib/archivist.js';

// Configuration
process.env.USE_WORKER = 'false';
process.env.MEMORY_HALF_LIFE_WEEKS = '4';
process.env.ARCHIVIST_STRATEGY = 'nlp';
process.env.EXTRACT_COMPLEX_CONCEPTS = 'false';

// Mock Embeddings for Clustering Test
const MOCK_VECTORS: Record<string, number[]> = {
    'tech_1': [0.9, 0.1, 0.0],
    'tech_2': [0.85, 0.2, 0.1],
    'food_1': [0.1, 0.9, 0.0],
    'food_2': [0.2, 0.85, 0.1]
};

async function runIntegrationTest() {
    console.log("=== Starting Integration Test: Features v2 ===");
    
    // 1. Setup DB
    const dbPath = './test_features.db';
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    const Database = (await import('better-sqlite3')).default;
    // @ts-ignore
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    
    // Initialize Schema manually for full control (Bypass initSchema to avoid partial state)
    // const { initSchema } = await import('./src/db/schema.js');
    // try { initSchema(db); } catch(e) { console.log("Schema init warning:", e); }

    // Register Custom Functions (Levenshtein required for NlpArchivist)
    const levenshtein = (a: string, b: string): number => {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;
        const matrix = [];
        for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
        for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) == a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
                }
            }
        }
        return matrix[b.length][a.length];
    };
    db.function('levenshtein', levenshtein);

    const decay = (importance: number, last_accessed: string | null, access_count: number, distance: number): number => {
         return (importance || 0.5); // Mock decay
    };
    db.function('ranked_score', decay);

    // Setup Schema
    try {
        db.exec("CREATE TABLE IF NOT EXISTS vec_items (rowid INTEGER PRIMARY KEY, embedding BLOB)");
        db.exec("CREATE TABLE IF NOT EXISTS vec_entities (rowid INTEGER PRIMARY KEY, embedding BLOB)"); // Added for Mixed Clustering
        db.exec(`
            CREATE TABLE IF NOT EXISTS memories (
              id TEXT PRIMARY KEY,
              content TEXT NOT NULL,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              source TEXT,
              tags TEXT DEFAULT '[]', 
              importance FLOAT DEFAULT 0.5,
              last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP,
              access_count INTEGER DEFAULT 0
            );
        `);
        db.exec(`
            CREATE TABLE IF NOT EXISTS entities (
                id TEXT PRIMARY KEY,
                name TEXT UNIQUE,
                type TEXT,
                observations TEXT,
                importance FLOAT DEFAULT 0.5
            );
        `);
        db.exec(`
            CREATE TABLE IF NOT EXISTS relations (
                source TEXT NOT NULL,
                target TEXT NOT NULL,
                relation TEXT NOT NULL,
                FOREIGN KEY(source) REFERENCES entities(name) ON DELETE CASCADE ON UPDATE CASCADE,
                FOREIGN KEY(target) REFERENCES entities(name) ON DELETE CASCADE ON UPDATE CASCADE,
                PRIMARY KEY (source, target, relation)
            );
        `);
        db.exec(`
             CREATE TABLE IF NOT EXISTS entity_observations (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              entity_id TEXT NOT NULL,
              content TEXT NOT NULL,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY(entity_id) REFERENCES entities(id) ON DELETE CASCADE
            );
        `);
    } catch (e) { console.error("Manual table creation failed:", e); }

    // Mock Embedder

    

    
    // ---------------------------------------------------------
    // TEST 1: Project Tagging (NLP Archivist)
    // ---------------------------------------------------------
    console.log("\n[Test 1] Project Tagging...");
    
    // Debug: Verify we can update tags locally
    try {
        const testId = 'test_update';
        db.prepare("INSERT INTO memories (id, content, tags) VALUES (?, ?, ?)").run(testId, "test", "[]");
        db.prepare("UPDATE memories SET tags = ? WHERE id = ?").run('["updated"]', testId);
        // console.log("✅ Local Update Verified");
        db.prepare("DELETE FROM memories WHERE id = ?").run(testId);
    } catch (e: any) {
        console.error("❌ Local Update Failed:", e.message);
    }
    
    // Mock Embedder for Testing
    const mockEmbedder = async (text: string) => {
        // Return deterministic vector based on text content
        if (text.includes("Apollo")) return new Array(384).fill(0.1); 
        if (text.includes("Mars")) return new Array(384).fill(0.1);          
        if (text.includes("Italian")) return new Array(384).fill(0.9);   
        return new Array(384).fill(0.5);
    };

    const archivist = getArchivist(db, mockEmbedder);

    // ... (rest of test 1)

    // ---------------------------------------------------------
    // TEST 1: Project Tagging (NLP Archivist)
    // ---------------------------------------------------------
    console.log("\n[Test 1] Project Tagging...");
    // const archivist = getArchivist(db); // Already declared above
    const memId1 = uuidv4();
    const text1 = "Project Apollo was a success.";
    
    db.prepare("INSERT INTO memories (id, content, tags) VALUES (?, ?, ?)").run(memId1, text1, "[]");
    
    // Process -> Should create Entity "Project Apollo" -> Should Embed it (0.1)
    await archivist.process(text1, memId1);
    
    const entity1 = db.prepare("SELECT rowid, * FROM entities WHERE name = 'Project Apollo' AND type = 'Project'").get() as any;
    if (entity1) {
        console.log("✅ Project Apollo Entity created.");
        // Check Vector
        try {
            const vec = db.prepare("SELECT * FROM vec_entities WHERE rowid = ?").get(entity1.rowid);
            if (vec) console.log("✅ Entity Vector created.");
            else console.error("❌ Entity Vector MISSING.");
        } catch (e) {
            console.error("❌ Failed to query vec_entities:", e);
        }
    } else {
        console.error("❌ Failed to create Project entity.");
    }
    
    // ...

    // ---------------------------------------------------------
    // TEST 3: Mixed Clustering
    // ---------------------------------------------------------
    console.log("\n[Test 3] Mixed Clustering...");
    
    // Clear and Insert Cluster Data
    db.prepare("DELETE FROM memories").run();
    db.prepare("DELETE FROM vec_items").run();
    db.prepare("DELETE FROM entities").run();
    db.prepare("DELETE FROM vec_entities").run();
    
    // Cluster 1: Space (Apollo)
    // - Memory: "Apollo landing" (0.1)
    // - Entity: "Project Apollo" (0.1)
    
    // Cluster 2: Food (Italian)
    // - Memory: "Italian Pizza" (0.9)
    
    // 1. Insert Memory 1 (Space)
    const m1Id = uuidv4();
    db.prepare("INSERT INTO memories (id, content) VALUES (?, ?)").run(m1Id, "Apollo landing");
    db.prepare("INSERT INTO vec_items (rowid, embedding) VALUES ((SELECT rowid FROM memories WHERE id=?), ?)").run(m1Id, Buffer.from(new Float32Array(384).fill(0.1).buffer));

    // 2. Insert Entity 1 (Space) - Manually or via Archivist mock
    const e1Id = uuidv4();
    db.prepare("INSERT INTO entities (id, name, type) VALUES (?, ?, 'Project')").run(e1Id, "Project Apollo");
    db.prepare("INSERT INTO vec_entities (rowid, embedding) VALUES ((SELECT rowid FROM entities WHERE id=?), ?)").run(e1Id, Buffer.from(new Float32Array(384).fill(0.1).buffer));

    // 3. Insert Memory 2 (Food)
    const m2Id = uuidv4();
    db.prepare("INSERT INTO memories (id, content) VALUES (?, ?)").run(m2Id, "Italian Pizza");
    db.prepare("INSERT INTO vec_items (rowid, embedding) VALUES ((SELECT rowid FROM memories WHERE id=?), ?)").run(m2Id, Buffer.from(new Float32Array(384).fill(0.9).buffer));

    const { MemoryClusterer } = await import('../src/lib/clustering.js');
    const clusterer = new MemoryClusterer(db);
    const clusters = await clusterer.cluster(2);
    
    console.log(`Clusters found: ${clusters.length}`);
    clusters.forEach(c => {
        console.log(`- Cluster ${c.id}: ${c.label} (${c.size} items)`);
        c.items.forEach(i => console.log(`  * ${i}`));
    });

    if (clusters.length === 2) {
        console.log("✅ Correct number of clusters.");
        // Verify Content
        const spaceCluster = clusters.find(c => c.items.some(i => i.includes('Apollo')));
        if (spaceCluster && spaceCluster.size >= 2) console.log("✅ Space Cluster merged Entity + Memory.");
        else console.error("❌ Failed to merge Space Memory + Entity.");
    } else {
        console.error(`❌ Expected 2 clusters, got ${clusters.length}`);
    }
    
    // ---------------------------------------------------------
    // TEST 4: Entity Normalization & Relation Extraction
    // ---------------------------------------------------------
    console.log("\n[Test 4] Normalization & Relations...");
    const memId4 = uuidv4();
    const text4 = "User loves perfectly written and efficient WGSL compute shaders.";
    
    db.prepare("INSERT INTO memories (id, content) VALUES (?, ?)").run(memId4, text4);
    
    // Process
    await archivist.process(text4, memId4);
    
    // Check Entities
    const userEntity = db.prepare("SELECT * FROM entities WHERE name = 'User'").get();
    const wgslEntity = db.prepare("SELECT * FROM entities WHERE name = 'WGSL'").get();
    const efficientWgsl = db.prepare("SELECT * FROM entities WHERE name LIKE '%efficient WGSL%'").get();
    
    if (userEntity && wgslEntity && !efficientWgsl) {
        console.log("✅ Entities Normalized: Found 'User' & 'WGSL', avoided complex noun phrase.");
    } else {
        console.error("❌ Entity Normalization Failed:", { 
            User: !!userEntity, 
            WGSL: !!wgslEntity, 
            ComplexDetected: !!efficientWgsl 
        });
    }
    
    // Check Relation
    const relation = db.prepare("SELECT * FROM relations WHERE source = 'User' AND target = 'WGSL' AND relation = 'loves'").get();
    if (relation) {
        console.log("✅ Relation 'User -> loves -> WGSL' extracted.");
    } else {
        // Debug what WAS found
        const allRels = db.prepare("SELECT * FROM relations").all();
        console.error("❌ Relation Missing. Found:", allRels);
    }
    
    // ---------------------------------------------------------
    // TEST 5: Graph Management (Delete/Update)
    // ---------------------------------------------------------
    console.log("\n[Test 5] Graph Management Tools...");
    
    // Setup Graph Data for Test 5
    const idA = uuidv4();
    const idB = uuidv4();
    const idC = uuidv4();
    
    // Note: Manual mock API for tools logic (duplicating logic from index.ts for integration check)
    // In a real e2e we'd call the MCP tool handler, but here we verify the logic directly against DB constraints
    
    db.prepare("INSERT INTO entities (id, name, type) VALUES (?, ?, ?)").run(idA, 'EntityA', 'Test');
    db.prepare("INSERT INTO entities (id, name, type) VALUES (?, ?, ?)").run(idB, 'EntityB', 'Test');
    db.prepare("INSERT INTO entities (id, name, type) VALUES (?, ?, ?)").run(idC, 'EntityC', 'Test');
    
    db.prepare("INSERT INTO relations (source, target, relation) VALUES (?, ?, ?)").run('EntityA', 'EntityB', 'relates_to');
    db.prepare("INSERT INTO relations (source, target, relation) VALUES (?, ?, ?)").run('EntityA', 'EntityC', 'links_to');
    
    // 1. Test Delete Relation
    console.log("-> Testing Delete Relation...");
    db.prepare("DELETE FROM relations WHERE source = ? AND target = ? AND relation = ?").run('EntityA', 'EntityB', 'relates_to');
    const checkRel1 = db.prepare("SELECT * FROM relations WHERE source = 'EntityA' AND target = 'EntityB'").get();
    if (!checkRel1) console.log("✅ Relation deleted.");
    else console.error("❌ Relation delete failed.");

    // 2. Test Cascade Delete Entity
    console.log("-> Testing Delete Entity (Cascade)...");
    // Logic: Delete observations + relations + vec + entity
    db.transaction(() => {
        db.prepare("DELETE FROM relations WHERE source = ? OR target = ?").run('EntityC', 'EntityC');
        db.prepare("DELETE FROM entities WHERE id = ?").run(idC);
    })();
    
    const checkEntityC = db.prepare("SELECT * FROM entities WHERE name = 'EntityC'").get();
    const checkRelC = db.prepare("SELECT * FROM relations WHERE target = 'EntityC'").get();
    
    if (!checkEntityC && !checkRelC) console.log("✅ Entity delete cascaded correctly.");
    else console.error("❌ Entity delete cascade failed:", { entity: !!checkEntityC, rel: !!checkRelC });
    
    // Add a surviving relation for Step 3 verification
    db.prepare("INSERT INTO relations (source, target, relation) VALUES (?, ?, ?)").run('EntityA', 'EntityB', 'survives');
    
    // 3. Test Update Entity (Rename + Cascade)
    console.log("-> Testing Update Entity (Rename)...");
    try {
        const currentName = 'EntityA';
        const newName = 'EntityNewA';
        const entityA = db.prepare("SELECT id FROM entities WHERE name = ?").get(currentName) as any;
        
        // Update Entity
        db.prepare("UPDATE entities SET name = ? WHERE id = ?").run(newName, entityA.id);
        
        // Verify Relations updated automatically (via ON UPDATE CASCADE)? 
        // Note: better-sqlite3 by default enables foreign keys if configured? 
        // We need to enable it explicitly usually: db.pragma('foreign_keys = ON');
        // Let's check if our schema setup enables it. schema.ts does NOT enable it globally, 
        // but let's see if sqlite handles it. If not, our tool logic handles it manually.
        // INTEGRATION CHECK: Does the tool logic (manual update) work?
        
        // Manual update simulation as per tool implementation:
        // Note: If CASCADE is on, these manual updates update nothing (0 changes) but that's fine.
        db.prepare("UPDATE relations SET source = ? WHERE source = ?").run(newName, currentName);
        db.prepare("UPDATE relations SET target = ? WHERE target = ?").run(newName, currentName);
        
        const checkRenamed = db.prepare("SELECT * FROM entities WHERE name = ?").get(newName);
        const checkRelRenamed = db.prepare("SELECT * FROM relations WHERE source = ?").get(newName);
        
        if (!checkRenamed || !checkRelRenamed) {
            console.log("DEBUG: Entities:", db.prepare("SELECT * FROM entities").all());
            console.log("DEBUG: Relations:", db.prepare("SELECT * FROM relations").all());
        }

        if (checkRenamed && checkRelRenamed) console.log("✅ Entity update verified.");
        else console.error("❌ Update failed:", { entity: !!checkRenamed, rel: !!checkRelRenamed });
        
    } catch (e: any) {
        console.error("❌ Update test error:", e.message);
    }

    
    console.log("\n=== Integration Test Complete ===");
    process.exit(0);
}

runIntegrationTest().catch(console.error);
