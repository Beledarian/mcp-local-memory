
import { Database } from 'better-sqlite3';
import DatabaseConstructor from 'better-sqlite3';
import { NlpArchivist } from '../src/lib/archivist.js';

// Mock DB
const db = new DatabaseConstructor(':memory:');
db.exec(`
  CREATE TABLE memories (id TEXT, tags TEXT);
  CREATE TABLE entities (id TEXT, name TEXT, type TEXT, observations TEXT, importance FLOAT);
  CREATE TABLE vec_entities (rowid INTEGER PRIMARY KEY, embedding BLOB);
  CREATE TABLE relations (source TEXT, target TEXT, relation TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(source, target, relation));
  CREATE TABLE vec_items (rowid INTEGER PRIMARY KEY, embedding BLOB);
`);

// Register levenshtein for tests
db.function('levenshtein', (a: any, b: any) => {
    a = String(a); b = String(b);
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
});

const archivist = new NlpArchivist(db);

async function testSentence(text: string, expectedSource: string, expectedTarget: string, expectedRel: string) {
    console.log(`\nProcessing: "${text}"`);
    await archivist.process(text, "mem-id");
    
    // Check relations
    const rels = db.prepare('SELECT * FROM relations').all() as any[];
    const match = rels.find(r => r.source === expectedSource && r.target === expectedTarget && (r.relation === expectedRel || r.relation.includes(expectedRel)));
    
    if (match) {
        console.log(`✅ Success: ${match.source} --[${match.relation}]--> ${match.target}`);
    } else {
        console.log(`❌ Failed. Found:`, rels);
        console.log(`   Expected: ${expectedSource} --[${expectedRel}]--> ${expectedTarget}`);
    }
    
    // Cleanup
    db.exec('DELETE FROM relations; DELETE FROM entities;');
}

async function run() {
    await testSentence("Alice uses Python.", "Alice", "Python", "uses");
    await testSentence("Python is used by Alice.", "Alice", "Python", "uses");
    await testSentence("The server runs on Linux.", "The server", "Linux", "runs_on");
    await testSentence("Project X requires generic verbs.", "Project X", "generic verbs", "requires"); // Testing non-restricted verb
    console.log("Done.");
}

run();
