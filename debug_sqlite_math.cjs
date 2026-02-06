const Database = require('better-sqlite3');
const db = new Database(':memory:');
try {
    const results = db.prepare(`
        SELECT 
            log(2) as log2,
            log(2.718281828) as logE,
            log10(100) as log10_100
    `).get();
    console.log('SQLite Math Test:', results);
} catch (e) {
    console.error('SQLite Math Error:', e.message);
}
