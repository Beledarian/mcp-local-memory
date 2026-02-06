
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
