// Enhanced FTS test to verify multi-word query tokenization
import Database from 'better-sqlite3';
import { initSchema } from '../src/db/schema.js';
import { v4 as uuidv4 } from "uuid";
import fs from 'fs';

async function runEnhancedTest() {
  console.log("=== Enhanced FTS Recall Test ===\n");
  
  // Use a dedicated test database
  const testDbPath = './tests/test_fts_enhanced.db';
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
  
  console.log("Setting up test DB...");
  const db = new Database(testDbPath);
  initSchema(db);

  // Clean up test data
  db.prepare(`DELETE FROM memories WHERE content LIKE '%test memory%'`).run();

  console.log("Adding test memories...\n");
  
  const testMemories = [
    {
      id: uuidv4(),
      content: "User loves performance optimizations that keep all functionality intact but make everything go fast.",
      tags: '["preference", "performance", "optimization"]'
    },
    {
      id: uuidv4(),
      content: "The user prefers Python for coding on rainy days.",
      tags: '["hobbies", "programming"]'
    },
    {
      id: uuidv4(),
      content: "Remember to optimize database queries for better performance.",
      tags: '["technical", "database"]'
    }
  ];

  const insertTx = db.transaction(() => {
    for (const mem of testMemories) {
      db.prepare(`INSERT INTO memories (id, content, tags) VALUES (?, ?, ?)`).run(
        mem.id, mem.content, mem.tags
      );
    }
  });
  insertTx();

  console.log(`Inserted ${testMemories.length} test memories.\n`);

  // Helper function matching the one in index.ts
  const tokenizeFTSQuery = (q: string): string => {
    const tokens = q
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 0)
      .map(t => `"${t}"`);
    return tokens.length > 0 ? tokens.join(' OR ') : q;
  };

  // Test cases
  const testQueries = [
    { query: "performance optimizations preference", expected: true, description: "Multi-word query matching" },
    { query: "Python coding", expected: true, description: "Two-word query" },
    { query: "database performance", expected: true, description: "Cross-memory term matching" },
    { query: "nonexistentterm12345", expected: false, description: "No match expected" }
  ];

  console.log("Running FTS tests with tokenization...\n");
  let passed = 0;
  let failed = 0;

  for (const test of testQueries) {
    const ftsQuery = tokenizeFTSQuery(test.query);
    console.log(`Test: ${test.description}`);
    console.log(`  Query: "${test.query}"`);
    console.log(`  FTS Query: ${ftsQuery}`);
    
    const ftsResults = db.prepare(`
      SELECT 
        id, 
        memories.content, 
        created_at,
        rank as score
      FROM memories_fts 
      JOIN memories ON memories_fts.rowid = memories.rowid
      WHERE memories_fts MATCH ? 
      ORDER BY rank
      LIMIT 5
    `).all(ftsQuery) as any[];

    const foundResults = ftsResults.length > 0;
    const testPassed = foundResults === test.expected;

    if (testPassed) {
      console.log(`  ✓ PASS: Found ${ftsResults.length} result(s) as expected`);
      if (ftsResults.length > 0) {
        console.log(`    Top result: "${ftsResults[0].content.substring(0, 60)}..."`);
      }
      passed++;
    } else {
      console.log(`  ✗ FAIL: Expected ${test.expected ? 'results' : 'no results'}, got ${ftsResults.length}`);
      failed++;
    }
    console.log();
  }

  // Cleanup
  try {
    const deleteSql = `DELETE FROM memories WHERE id IN (${testMemories.map(() => '?').join(',')})`;
    db.prepare(deleteSql).run(...testMemories.map(m => m.id));
  } catch (e) {
    // Already cleaned up, ignore
  }
  db.close();
  
  console.log("=== Test Summary ===");
  console.log(`Passed: ${passed}/${testQueries.length}`);
  console.log(`Failed: ${failed}/${testQueries.length}`);
  
  if (failed === 0) {
    console.log("\n✓ All tests passed!");
    process.exit(0);
  } else {
    console.log("\n✗ Some tests failed!");
    process.exit(1);
  }
}

runEnhancedTest().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
