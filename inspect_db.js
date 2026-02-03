const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), '.memory/memory.db');

try {
    const db = new Database(dbPath);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log('--- Database Audit ---');
    for (const t of tables) {
        try {
            const count = db.prepare(`SELECT count(*) as c FROM "${t.name}"`).get().c;
            console.log(`${t.name}: ${count} rows`);
            if (count > 0 && !t.name.startsWith('sqlite_') && !t.name.includes('vec_')) {
                const cols = db.pragma(`table_info("${t.name}")`).map(c => c.name);
                const sample = db.prepare(`SELECT * FROM "${t.name}" LIMIT 1`).get();
                console.log(`  Cols: ${cols.join(', ')}`);
                console.log(`  Sample: ${JSON.stringify(sample).substring(0, 100)}...`);
            }
        } catch (e) {
            console.log(`${t.name}: ERROR (${e.message})`);
        }
    }
    db.close();
} catch (err) {
    console.error('Audit failed:', err);
    process.exit(1);
}
