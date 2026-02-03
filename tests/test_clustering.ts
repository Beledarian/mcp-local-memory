
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs-extra';
// @ts-ignore
import { MemoryClusterer } from './src/lib/clustering.js';

process.env.USE_WORKER = 'false';

// Mocks
const mockEmbeddings = [
    // Cluster A: "Tech" (High Dim 0)
    { id: '1', content: 'Apple released a new iPhone', vector: [0.9, 0.1, 0.0] },
    { id: '2', content: 'Google AI is advancing', vector: [0.85, 0.2, 0.1] },
    { id: '3', content: 'Microsoft updates Windows', vector: [0.88, 0.15, 0.05] },
    
    // Cluster B: "Food" (High Dim 1)
    { id: '4', content: 'I love pizza', vector: [0.1, 0.9, 0.0] },
    { id: '5', content: 'Sushi is great for dinner', vector: [0.2, 0.85, 0.1] },
    
    // Cluster C: "Nature" (High Dim 2)
    { id: '6', content: 'The forest is green', vector: [0.0, 0.1, 0.9] },
    { id: '7', content: 'Hiking in the mountains', vector: [0.1, 0.2, 0.85] },
];

async function run() {
    console.log("Setting up test DB for Clustering...");
    if (fs.existsSync('./test_clustering.db')) fs.unlinkSync('./test_clustering.db');
    
    const Database = (await import('better-sqlite3')).default;
    // @ts-ignore
    const db = new Database('./test_clustering.db');
    
    // Create Tables
    db.exec(`
        CREATE TABLE memories (
          rowid INTEGER PRIMARY KEY,
          id TEXT,
          content TEXT
        );
        CREATE TABLE vec_items (
          rowid INTEGER PRIMARY KEY,
          embedding BLOB
        );
    `);
    
    // Insert Mock Data
    const insertMem = db.prepare('INSERT INTO memories (id, content) VALUES (:id, :content)');
    const insertVec = db.prepare('INSERT INTO vec_items (rowid, embedding) VALUES (:rowid, :embedding)');

    mockEmbeddings.forEach((m, i) => {
        const rowid = i + 1;
        insertMem.run({ id: m.id, content: m.content });
        const float32 = new Float32Array(m.vector);
        insertVec.run({ rowid: rowid, embedding: Buffer.from(float32.buffer) });
    });

    console.log("Running Clustering (k=3)...");
    const clusterer = new MemoryClusterer(db);
    const results = await clusterer.cluster(3);

    console.log("\n--- Clusters ---");
    console.log(JSON.stringify(results, null, 2));

    // Verify logic: Tech, Food, Nature should be separate
    const cluster1 = results.find(c => c.items.some(i => i.includes('Apple')));
    const cluster2 = results.find(c => c.items.some(i => i.includes('pizza')));

    if (results.length === 3 && cluster1 && cluster2 && cluster1.id !== cluster2.id) {
        console.log("\nSUCCESS: Clusters separated correctly.");
    } else {
        console.error("\nFAILURE: Clusters mixed or incorrect count.");
    }
    
    process.exit(0);
}

run().catch(console.error);
