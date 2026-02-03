
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs-extra';

process.env.USE_WORKER = 'false';
process.env.MEMORY_HALF_LIFE_WEEKS = '4'; // 4 weeks
process.env.MEMORY_CONSOLIDATION_FACTOR = '1.0';

// Mock Score Function logic exactly as in index.ts for testing isolated DB
const decay = (importance: number, last_accessed: string | null, access_count: number, distance: number): number => {
    // 1. Config
    const halfLife = parseFloat(process.env.MEMORY_HALF_LIFE_WEEKS || '4');
    const consolidation = parseFloat(process.env.MEMORY_CONSOLIDATION_FACTOR || '1.0');
    
    // 2. Time Delta (Weeks)
    const now = new Date();
    const accessed = last_accessed ? new Date(last_accessed) : new Date(); 
    const diffTime = Math.abs(now.getTime() - accessed.getTime());
    const weeks = diffTime / (1000 * 60 * 60 * 24 * 7);

    // 3. Stability (Consolidation)
    const stability = halfLife * (1 + (consolidation * Math.log2(access_count + 1)));
    
    // 4. Decayed Importance
    const decayedImportance = (importance || 0.5) * Math.pow(0.5, weeks / stability);
    
    // 5. Semantic Similarity (1.0 - distance)
    const similarity = 1.0 - distance;
    
    // 6. Final Score
    return (similarity * 0.7) + (decayedImportance * 0.3);
};

const levenshtein = (a: string, b: string): number => {
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
};

async function run() {
    console.log("Setting up test DB for Decay Verification...");
    if (fs.existsSync('./test_decay.db')) fs.unlinkSync('./test_decay.db');
    
    const Database = (await import('better-sqlite3')).default;
    // @ts-ignore
    const db = new Database('./test_decay.db');
    db.function('ranked_score', decay);
    
    // Create Table
    db.exec(`
        CREATE TABLE memories (
          id TEXT PRIMARY KEY,
          content TEXT,
          importance FLOAT,
          last_accessed DATETIME,
          access_count INTEGER,
          embedding_dist FLOAT -- Mocking vector distance column
        );
    `);
    
    // Helper to get date string X weeks ago
    const weeksAgo = (n: number) => {
        const d = new Date();
        d.setDate(d.getDate() - (n * 7));
        return d.toISOString();
    };

    // Scenarios (Assumption: Perfect Match, distance=0.0 -> Similarity=1.0)
    // 1. Fresh Memory (Now)
    db.prepare('INSERT INTO memories VALUES (?, ?, ?, ?, ?, ?)').run('fresh', 'Fresh', 1.0, weeksAgo(0), 0, 0.0);
    // 2. Old Memory (4 weeks ago), Never accessed
    db.prepare('INSERT INTO memories VALUES (?, ?, ?, ?, ?, ?)').run('old_forgotten', 'Old Forgotten', 1.0, weeksAgo(4), 0, 0.0);
    // 3. Old Memory (4 weeks ago), Accessed 3 times (Consolidated)
    // log2(3+1) = 2. Stability = 4 * (1 + 2) = 12 weeks.
    // Decay: 0.5 ^ (4 / 12) = 0.5 ^ 0.33 = ~0.79 retention
    db.prepare('INSERT INTO memories VALUES (?, ?, ?, ?, ?, ?)').run('old_stable', 'Old Stable', 1.0, weeksAgo(4), 3, 0.0);
    
    // 4. Ancient Memory (16 weeks ago), Highly Consolidated (15 accesses)
    // log2(15+1) = 4. Stability = 4 * (1 + 4) = 20 weeks.
    // Decay: 0.5 ^ (16 / 20) = 0.5 ^ 0.8 = ~0.57 retention
    db.prepare('INSERT INTO memories VALUES (?, ?, ?, ?, ?, ?)').run('ancient_hero', 'Ancient Hero', 1.0, weeksAgo(16), 15, 0.0);

    // Calculate Scores using SQL
    console.log("\n--- Decay Results (HalfLife=4w) ---");
    const results = db.prepare(`
        SELECT id, importance, last_accessed, access_count, 
               ranked_score(importance, last_accessed, access_count, embedding_dist) as score
        FROM memories
        ORDER BY score DESC
    `).all() as any[];

    results.forEach(r => {
        // Reverse engineer decay factor for clarity
        // Score = 0.7 + (0.3 * Decay) -> Decay = (Score - 0.7) / 0.3
        const decayFactor = (r.score - 0.7) / 0.3;
        console.log(`[${r.id.padEnd(12)}] Score: ${r.score.toFixed(4)} (Retained: ${(decayFactor*100).toFixed(1)}%) | Age: ${r.last_accessed.substring(0,10)} | Count: ${r.access_count}`);
    });

    // Verification Logic
    // Fresh should be ~1.0
    // Old Forgotten should be ~0.5 (Half Life) -> Score: 0.7 + 0.15 = 0.85
    // Old Stable should be > Old Forgotten
    
    if (results[0].id === 'fresh' && results[1].id === 'old_stable') {
        console.log("\nSUCCESS: Ranking matches expectation (Fresh > Stable > Forgotten)");
    } else {
        console.error("\nFAILURE: Ranking mismatch.");
    }
    
    process.exit(0);
}

run().catch(console.error);
