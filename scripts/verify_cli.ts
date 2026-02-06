
import { Database } from 'better-sqlite3';
import DatabaseConstructor from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { handleCLI } from '../src/tools/cli.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock DB path - assume running from root
const DB_PATH = path.resolve(__dirname, '../memory.db'); // Adjust if needed
console.log("Using DB:", DB_PATH);

const db = new DatabaseConstructor(DB_PATH);

// Mock Embedder/Archivist (we just want to test CLI routing logic mostly)
const mockEmbedder = { embed: async (t: string) => new Array(384).fill(0.1) };
const mockArchivist = { process: async (t: string, id: string) => console.log(`[MockArchivist] Processed ${id}`) };

async function run(cmd: string) {
    console.log(`\n>>> Running: "${cmd}"`);
    try {
        const result = await handleCLI(db, mockEmbedder, mockArchivist, cmd);
        if (result.isError) {
             console.error("ERROR:", result.content[0].text);
        } else {
             console.log("SUCCESS:", result.content[0].text);
        }
    } catch (e: any) {
        console.error("EXCEPTION:", e.message);
    }
}

async function main() {
    // 1. Help
    await run("help");

    // 2. Generic Task Flow
    await run('task add "Test Task from Verify Script" --section testing');
    await run('task list --section testing');
    
    // 3. Close by Name
    await run('task done "Test Task from Verify Script"');
    
    // 4. Verify Closed
    await run('task list --section testing');

    // 5. Todo Flow
    await run('todo add "Buy Milk"');
    await run('todo done "Milk"');
    
    // 6. Entity
    await run('entity create "TestEntity" --type "Test"');
}

main();
