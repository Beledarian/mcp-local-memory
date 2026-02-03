import { getDb } from '../src/db/client.js';
import { initSchema } from '../src/db/schema.js';
import { Consolidator } from '../src/lib/consolidator.js';
import { getEmbedder } from '../src/lib/embeddings.js';

async function testConsolidation() {
    console.log("=== Testing Consolidation ===\n");

    const db = getDb();
    initSchema(db);

    const embedder = getEmbedder();
    const consolidator = new Consolidator(db, async (text) => {
        const vectors = await embedder.embed(text);
        return Array.from(vectors);
    });

    // Clear existing data
    db.prepare('DELETE FROM memories').run();
    db.prepare('DELETE FROM vec_items').run();

    // Add some existing memories
    console.log("Adding existing memories...");
    const memory1 = {
        id: 'mem-1',
        content: 'User prefers Python for scripting',
        tags: JSON.stringify(['python', 'preference']),
        importance: 0.7
    };

    db.prepare(`INSERT INTO memories (id, content, tags, importance) VALUES (?, ?, ?, ?)`).run(
        memory1.id, memory1.content, memory1.tags, memory1.importance
    );

    const vectors1 = await embedder.embed(memory1.content);
    const rowid1 = db.prepare('SELECT rowid FROM memories WHERE id = ?').get(memory1.id) as any;
    db.prepare('INSERT INTO vec_items (rowid, embedding) VALUES (?, ?)').run(
        rowid1.rowid,
        Buffer.from(new Float32Array(vectors1).buffer)
    );

    console.log("✓ Added 1 existing memory\n");

    // Test NLP extraction
    console.log("--- Testing NLP Extraction ---");
    const summary1 = "Discussed: User loves TypeScript for type safety. User is building CEOSim, an economy simulation game. User prefers Python for data science.";
    
    const nlpResults = await consolidator.extract(summary1, 'nlp', 5);
    console.log(`Extracted ${nlpResults.length} facts with NLP:`);
    nlpResults.forEach((fact, i) => {
        console.log(`  ${i+1}. ${fact.text} (importance: ${fact.importance}, tags: ${fact.tags.join(', ')})`);
    });
    console.log();

    // Test LLM extraction (if Ollama available)
    if (process.env.ARCHIVIST_STRATEGY?.includes('llm')) {
        console.log("--- Testing LLM Extraction ---");
        const summary2 = "Discussed: User prefers Rust for systems programming. User is working on WebGPU shaders. User dislikes JavaScript build tooling.";
        
        try {
            const llmResults = await consolidator.extract(summary2, 'llm', 5);
            console.log(`Extracted ${llmResults.length} facts with LLM:`);
            llmResults.forEach((fact, i) => {
                console.log(`  ${i+1}. ${fact.text} (importance: ${fact.importance}, tags: ${fact.tags.join(', ')})`);
            });
        } catch (err: any) {
            console.log(`⚠ LLM extraction failed (Ollama may not be running): ${err.message}`);
        }
        console.log();
    } else {
        console.log("--- Skipping LLM Test (ARCHIVIST_STRATEGY does not include 'llm') ---\n");
    }

    // Test deduplication
    console.log("--- Testing Deduplication ---");
    const duplicateSummary = "User really loves Python for all scripting tasks";
    const dedupResults = await consolidator.extract(duplicateSummary, 'nlp', 5);
    console.log(`Extracted ${dedupResults.length} facts (should filter duplicate about Python):`);
    dedupResults.forEach((fact, i) => {
        console.log(`  ${i+1}. ${fact.text}`);
    });
    console.log();

    console.log("=== Test Complete ===");
    db.close();
}

testConsolidation().catch(console.error);
