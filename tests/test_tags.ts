/**
 * Test Tag-Enhanced Search (Option 1 + 3)
 * Verifies that tags are embedded with content AND exact matches are boosted
 */

import Database from "better-sqlite3";
import { getDb } from "./src/db/client";
import { initSchema } from "./src/db/schema";
import { getEmbedder } from "./src/lib/embeddings";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";

const TEST_DB = "test_tags.db";

async function main() {
    console.log("=== Tag-Enhanced Search Test ===\n");

    // Clean slate
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

    const db = getDb(TEST_DB);
    initSchema(db);
    const embedder = getEmbedder();

    // Wait for embedder to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log("1. Creating test memories with tags...");

    const memories = [
        { content: "The mission was successful", tags: ["Apollo", "NASA"] },
        { content: "Budget was approved for next year", tags: ["Finance", "Apollo"] },
        { content: "Team meeting scheduled for Monday", tags: ["Schedule", "Team"] },
        { content: "Rocket launch postponed due to weather", tags: ["SpaceX", "Launch"] }
    ];

    for (const mem of memories) {
        const id = uuidv4();
        // Option 1: Embed with tags
        const tagText = mem.tags.length > 0 ? ` [Tags: ${mem.tags.join(', ')}]` : '';
        const fullText = mem.content + tagText;
        
        const embedding = await embedder.embed(fullText);
        const float32 = new Float32Array(embedding);

        db.prepare('INSERT INTO memories (id, content, tags) VALUES (?, ?, ?)')
          .run(id, mem.content, JSON.stringify(mem.tags));

        try {
            db.prepare('INSERT INTO vec_items (rowid, embedding) VALUES ((SELECT rowid FROM memories WHERE id = ?), ?)')
              .run(id, Buffer.from(float32.buffer));
        } catch (err) {
            console.warn("sqlite-vec not available, skipping vector insert");
        }
    }

    console.log("   ✅ Created 4 test memories\n");

    console.log("2. Testing semantic tag search (Option 1)...");
    console.log("   Query: 'space missions'");
    
    const query1 = await embedder.embed("space missions");
    const q1Float = new Float32Array(query1);

    try {
        const results1 = db.prepare(`
            SELECT m.content, m.tags, vec_distance_cosine(v.embedding, ?) as distance
            FROM vec_items v
            JOIN memories m ON v.rowid = m.rowid
            ORDER BY distance ASC
            LIMIT 2
        `).all(Buffer.from(q1Float.buffer));

        console.log("   Results:");
        results1.forEach((r: any, i: number) => {
            console.log(`     ${i+1}. "${r.content}" [${r.tags}] (distance: ${r.distance.toFixed(3)})`);
        });

        // Should find Apollo/NASA tagged items due to embedded tags
        const foundApollo = results1.some((r: any) => r.tags.includes("Apollo"));
        console.log(foundApollo ? "   ✅ Semantic search found tagged content\n" : "   ❌ Failed to find tagged content\n");

    } catch (err) {
        console.log("   ⚠️  Vector search not available (sqlite-vec missing)\n");
    }

    console.log("3. Testing exact tag boost (Option 3)...");
    console.log("   Query: 'Apollo budget'");

    const query2 = await embedder.embed("Apollo budget");
    const q2Float = new Float32Array(query2);

    try {
        let results2 = db.prepare(`
            SELECT m.content, m.tags, vec_distance_cosine(v.embedding, ?) as distance
            FROM vec_items v
            JOIN memories m ON v.rowid = m.rowid
            ORDER BY distance ASC
            LIMIT 4
        `).all(Buffer.from(q2Float.buffer)) as any[];

        console.log("   Before boosting:");
        results2.forEach((r, i) => {
            const score = 1 - r.distance; // Convert distance to similarity
            console.log(`     ${i+1}. "${r.content}" (score: ${score.toFixed(3)})`);
        });

        // Apply Option 3 boost
        const queryLower = "apollo budget".toLowerCase();
        results2 = results2.map(r => {
            const tags = JSON.parse(r.tags || '[]') as string[];
            const hasExactMatch = tags.some(tag => queryLower.includes(tag.toLowerCase()));
            const score = (1 - r.distance) + (hasExactMatch ? 0.15 : 0);
            return { ...r, score };
        }).sort((a, b) => b.score - a.score);

        console.log("\n   After boosting:");
        results2.forEach((r, i) => {
            const tags = JSON.parse(r.tags);
            const boosted = tags.some(t => queryLower.includes(t.toLowerCase()));
            console.log(`     ${i+1}. "${r.content}" (score: ${r.score.toFixed(3)}) ${boosted ? '⬆️' : ''}`);
        });

        const topResult = results2[0];
        const topTags = JSON.parse(topResult.tags);
        const hasApollo = topTags.includes("Apollo");
        
        console.log(hasApollo ? "\n   ✅ Exact tag match boosted to top\n" : "\n   ❌ Tag boost didn't work as expected\n");

    } catch (err) {
        console.log("   ⚠️  Vector search not available (sqlite-vec missing)\n");
    }

    db.close();
    console.log("=== Test Complete ===");
}

main().catch(console.error);
