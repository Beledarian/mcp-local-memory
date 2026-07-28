
import assert from 'node:assert/strict';
import DatabaseConstructor from 'better-sqlite3';
import { handleCLI } from '../src/tools/cli.js';
import { initSchema } from '../src/db/schema.js';

const db = new DatabaseConstructor(':memory:');
db.function('levenshtein', (left: unknown, right: unknown) =>
    String(left).localeCompare(String(right)) === 0 ? 0 : 99
);
initSchema(db);

// Mock Embedder/Archivist (we just want to test CLI routing logic mostly)
const mockEmbedder = { embed: async (t: string) => new Array(384).fill(0.1) };
const mockArchivist = { process: async (t: string, id: string) => console.log(`[MockArchivist] Processed ${id}`) };

async function run(cmd: string): Promise<string> {
    console.log(`\n>>> Running: "${cmd}"`);
    const result = await handleCLI(db, mockEmbedder, mockArchivist, cmd);
    assert.equal(result.isError, undefined, result.content?.[0]?.text);
    assert.ok(Array.isArray(result.content), 'CLI result must contain MCP content');
    const text = result.content[0].text;
    console.log("SUCCESS:", text);
    return text;
}

async function main() {
    // 1. Help
    await run("help");

    // 2. Generic Task Flow
    await run('task add "Test Task from Verify Script" --section testing');
    assert.match(await run('task list --section testing'), /Test Task from Verify Script/);
    
    // 3. Close by Name
    await run('task done "Test Task from Verify Script"');
    
    // 4. Verify Closed
    assert.doesNotMatch(await run('task list --status pending'), /Test Task from Verify Script/);

    // 5. Todo Flow
    await run('todo add "Buy Milk"');
    await run('todo done "Milk"');
    
    // 6. Entity
    assert.match(await run('entity create "TestEntity" --type "Test"'), /Created entity/);
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => db.close());
