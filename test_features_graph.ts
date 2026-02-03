import { getDb } from './src/db/client.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs-extra';

process.env.USE_WORKER = 'false';

// Manually register Levenshtein for test env (normally done in index.ts)
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

async function run() {
    console.log("Setting up test DB for Graph Features...");
    if (fs.existsSync('./test_graph_features.db')) fs.unlinkSync('./test_graph_features.db');
    
    const Database = (await import('better-sqlite3')).default;
    // @ts-ignore
    const db = new Database('./test_graph_features.db');
    db.function('levenshtein', levenshtein);
    
    db.exec(`
        CREATE TABLE IF NOT EXISTS entities (
          id TEXT PRIMARY KEY,
          name TEXT UNIQUE NOT NULL,
          type TEXT,
          observations TEXT,
          importance FLOAT DEFAULT 0.5
        );
        CREATE TABLE IF NOT EXISTS relations (
          source TEXT NOT NULL,
          target TEXT NOT NULL,
          relation TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (source, target, relation)
        );
    `);
    
    // 1. Populate Graph
    console.log("Populating Graph Data...");
    // A -> B -> C -> D
    const entities = ['Person A', 'Person B', 'Person C', 'Person D'];
    entities.forEach(name => {
         db.prepare(`INSERT INTO entities (id, name, type, observations) VALUES (?, ?, ?, ?)`).run(uuidv4(), name, 'Test', '[]');
    });
    
    db.prepare(`INSERT INTO relations (source, target, relation) VALUES (?, ?, ?)`).run('Person A', 'Person B', 'knows');
    db.prepare(`INSERT INTO relations (source, target, relation) VALUES (?, ?, ?)`).run('Person B', 'Person C', 'knows');
    db.prepare(`INSERT INTO relations (source, target, relation) VALUES (?, ?, ?)`).run('Person C', 'Person D', 'knows');
    
    // 2. Test Recursive Traversal
    console.log("Testing Recursive Traversal (Depth 3)...");
    const query = `
        WITH RECURSIVE traverse(source, target, relation, depth) AS (
            SELECT source, target, relation, 1 as depth FROM relations WHERE source = ?
            UNION
            SELECT r.source, r.target, r.relation, t.depth + 1 FROM relations r JOIN traverse t ON r.source = t.target WHERE t.depth < ?
        )
        SELECT * FROM traverse;
    `;
    const results = db.prepare(query).all('Person A', 3) as any[];
    console.log(`Found ${results.length} relations from Person A (Depth 3). Expected 3.`);
    results.forEach(r => console.log(`- ${r.source} -> ${r.target} (Depth ${r.depth})`));
    
    if (results.length === 3) console.log("SUCCESS: Graph traversal works.");
    else console.error("FAILURE: Graph traversal mismatch.");

    // 3. Test Levenshtein
    console.log("Testing Levenshtein Resolution...");
    db.prepare(`INSERT INTO entities (id, name, type, observations) VALUES (?, ?, ?, ?)`).run(uuidv4(), 'Elon Musk', 'Person', '[]');
    const match = db.prepare('SELECT name FROM entities WHERE levenshtein(name, ?) <= 2 LIMIT 1').get('Elon Muck') as any;
    
    if (match && match.name === 'Elon Musk') {
        console.log(`SUCCESS: Resolved 'Elon Muck' to '${match.name}'`);
    } else {
        console.error("FAILURE: Levenshtein resolution failed.");
    }

    process.exit(0);
}

run().catch(console.error);
