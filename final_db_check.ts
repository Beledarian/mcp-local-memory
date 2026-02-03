
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = process.env.MEMORY_DB_PATH || path.join(process.cwd(), 'memory.db');
console.log('Inspecting:', dbPath);
const db = new Database(dbPath);

try {
    const counts = db.prepare('SELECT count(*) as count FROM memories').get() as any;
    console.log('Memory count:', counts.count);
    
    if (counts.count > 0) {
        const samples = db.prepare('SELECT content FROM memories LIMIT 3').all();
        console.log('Sample content:', JSON.stringify(samples, null, 2));
    }

    const relCounts = db.prepare('SELECT count(*) as count FROM relations').get() as any;
    console.log('Relation count:', relCounts.count);
} catch (err: any) {
    console.error('Error querying DB:', err.message);
}
