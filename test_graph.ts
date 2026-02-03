
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs-extra';

async function runGraphTest() {
    console.log("=== Starting Graph Traversal Test ===");
    
    // 1. Setup DB
    const dbPath = './test_graph.db';
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    const Database = (await import('better-sqlite3')).default;
    // @ts-ignore
    const db = new Database(dbPath);

    // Register Levenshtein
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

    // Schema
    db.exec(`
        CREATE TABLE IF NOT EXISTS entities (
            id TEXT PRIMARY KEY,
            name TEXT,
            type TEXT,
            observations TEXT
        );
        CREATE TABLE IF NOT EXISTS relations (
            source TEXT,
            target TEXT,
            relation TEXT,
            PRIMARY KEY (source, target, relation)
        );
    `);

    // 2. Seed Data (A -> B -> C -> D)
    console.log("Seeding graph...");
    const entities = ['Alice', 'Bob', 'Charlie', 'David', 'Eve'];
    entities.forEach(name => {
        db.prepare("INSERT INTO entities (id, name, type, observations) VALUES (?, ?, 'Person', '[]')").run(uuidv4(), name);
    });

    // Relations
    // Alice -> knows -> Bob
    // Bob -> knows -> Charlie
    // Charlie -> knows -> David
    // Eve is isolated
    const relations = [
        ['Alice', 'Bob', 'knows'],
        ['Bob', 'Charlie', 'knows'],
        ['Charlie', 'David', 'knows']
    ];
    relations.forEach(r => {
        db.prepare("INSERT INTO relations (source, target, relation) VALUES (?, ?, ?)").run(r[0], r[1], r[2]);
    });

    // 3. Test Recursive Query Logic
    const testTraversal = (startNode: string, maxDepth: number) => {
        console.log(`\nTraversing from '${startNode}' with depth ${maxDepth}...`);
        
        const query = `
            WITH RECURSIVE traverse(source, target, relation, depth) AS (
                -- Base case: Immediate neighbors
                SELECT source, target, relation, 1 as depth
                FROM relations 
                WHERE source = ? OR target = ?
                
                UNION
                
                -- Recursive step
                SELECT r.source, r.target, r.relation, t.depth + 1
                FROM relations r
                JOIN traverse t ON (t.target = r.source AND t.source != r.target) OR (t.source = r.target AND t.target != r.source) -- generic neighbor join?
                -- Simplified: Just follow 'target' for directed, or both for undirected usage
                -- Let's stick to the Implementation Plan logic:
                -- JOIN relations r ON (r.source = traverse.name AND r.target = t.name) ... wait, plan used entity JOIN logic.
                -- Let's refine the SQL here to match standard graph traversal.
            
                -- RETHINK SQL:
                -- We track 'current_node' to simplify
            )
            SELECT * FROM traverse;
        `;

        // Better Recursive CTE for Undirected Traversal
        const optimizedQuery = `
             WITH RECURSIVE traverse(id, depth) AS (
                -- Base: Start Node
                SELECT id, 0 as depth FROM entities WHERE name = ?
                
                UNION
                
                -- Recursive: Neighbors
                SELECT t.id, traverse.depth + 1
                FROM entities t
                JOIN relations r ON (r.source = t.name OR r.target = t.name)
                JOIN traverse ON (
                    (r.source = (SELECT name FROM entities WHERE id = traverse.id) AND r.target = t.name) OR 
                    (r.target = (SELECT name FROM entities WHERE id = traverse.id) AND r.source = t.name)
                )
                WHERE traverse.depth < ?
            )
            SELECT e.name, t.depth FROM traverse t JOIN entities e ON t.id = e.id;
        `;
        
        // Simpler implementation for the test harness to verify logic
        try {
            // Let's implement the EXACT logic we plan to put in index.ts
           const sql = `
            WITH RECURSIVE bfs(name, depth) AS (
                SELECT name, 0 FROM entities WHERE name = ?
                UNION
                SELECT 
                    CASE WHEN r.source = bfs.name THEN r.target ELSE r.source END, 
                    bfs.depth + 1
                FROM relations r
                JOIN bfs ON (r.source = bfs.name OR r.target = bfs.name)
                WHERE bfs.depth < ?
            )
            SELECT DISTINCT name, depth FROM bfs WHERE depth > 0; -- Exclude self if desired, or keep
            `;
            
            const visited = db.prepare(sql).all(startNode, maxDepth) as any[];
            console.log("Visited:", visited.map(v => `${v.name} (d=${v.depth})`).join(', '));
            return visited;
        } catch (e: any) {
            console.error("Query failed:", e.message);
            return [];
        }
    };

    const d1 = testTraversal('Alice', 1);
    if (d1.some(x => x.name === 'Bob') && !d1.some(x => x.name === 'Charlie')) console.log("✅ Depth 1 Correct");
    else console.error("❌ Depth 1 Failed");

    const d2 = testTraversal('Alice', 2);
    if (d2.some(x => x.name === 'Charlie') && !d2.some(x => x.name === 'David')) console.log("✅ Depth 2 Correct");
    else console.error("❌ Depth 2 Failed");

    const d3 = testTraversal('Alice', 3);
    if (d3.some(x => x.name === 'David')) console.log("✅ Depth 3 Correct");
    else console.error("❌ Depth 3 Failed");
    
    // 4. Test Entity Resolution (Levenshtein)
    console.log("\nTesting Entity Resolution...");
    const checkDuplicate = (name: string) => {
        const existing = db.prepare("SELECT * FROM entities WHERE levenshtein(name, ?) <= 2").get(name);
        return existing;
    };
    
    const existing = checkDuplicate('Alice'); // Exact
    const fuzzy = checkDuplicate('Alicia'); // Dist 2? Alice(5), Alicia(6). Dist is 2. (Alice -> Alici -> Alicia)
    const none = checkDuplicate('Zack');

    if (existing && fuzzy && !none) console.log("✅ Resolution Logic Verified");
    else console.log(`❌ Resolution Failed: Existing=${!!existing}, Fuzzy=${!!fuzzy}, None=${!!none}`);

    console.log("\n=== Test Complete ===");
}

runGraphTest().catch(console.error);
