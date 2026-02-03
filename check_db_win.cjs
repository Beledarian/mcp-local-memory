
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = 'C:\\Users\\Laurin\\.memory\\memory.db';
console.log('Inspecting:', dbPath);
const db = new Database(dbPath, { readonly: true });

try {
    const counts = db.prepare('SELECT count(*) as count FROM memories').get();
    console.log('Memory count:', counts.count);
    
    if (counts.count > 0) {
        const samples = db.prepare('SELECT content FROM memories LIMIT 3').all();
        console.log('Sample content:', JSON.stringify(samples, null, 2));
    }

    const relCounts = db.prepare('SELECT count(*) as count FROM relations').get();
    console.log('Relation count:', relCounts.count);
} catch (err) {
    console.error('Error querying DB:', err.message);
}
