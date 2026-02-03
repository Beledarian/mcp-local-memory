
import { getDb } from './src/db/client.js'; 
import { getArchivist } from './src/lib/archivist.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs-extra';
 
// Default to sync logic verification for stability in dev environment
// Set to 'true' to text actual threading (requires build or correct loader args)
process.env.USE_WORKER = process.env.TEST_WORKER_THREAD || 'false';
process.env.ARCHIVIST_STRATEGY = 'nlp';
process.env.MEMORY_DB_PATH = './test_worker.db';

async function run() {
    console.log(`Setting up test DB (Worker Enabled: ${process.env.USE_WORKER})...`);
    
    if (fs.existsSync('./test_worker.db')) fs.unlinkSync('./test_worker.db');
    
    const db = getDb('./test_worker.db');
    const { initSchema } = await import('./src/db/schema.js');
    initSchema(db);
    
    const info = db.pragma('table_info(memories)') as any[];
    const hasImp = info.some(c => c.name === 'importance');
    console.log(`Schema check: 'importance' column exists? ${hasImp}`);
    
    if (!hasImp) {
        console.error("Schema migration failed!");
        process.exit(1);
    }

    console.log("Initializing Archivist...");
    const archivist = getArchivist(db);
    
    const memoryId = uuidv4();
    const text = "Elon Musk founded SpaceX in 2002.";
    
    console.log(`Sending text to archivist: "${text}"`);
    
    // Insert memory first
    db.prepare('INSERT INTO memories (id, content, importance) VALUES (?, ?, ?)').run(memoryId, text, 0.9);
    
    await archivist.process(text, memoryId);
    
    console.log("Waiting for processing...");
    await new Promise(r => setTimeout(r, 2000));
    
    const entities = db.prepare('SELECT * FROM entities').all() as any[];
    console.log(`Entities found: ${entities.length}`);
    entities.forEach(e => console.log(`- ${e.name} (${e.type})`));
    
    if (entities.length > 0) {
        console.log("SUCCESS: Entities extracted.");
    } else {
        console.error("FAILURE: No entities found.");
    }
    
    process.exit(0);
}

run().catch(console.error);
