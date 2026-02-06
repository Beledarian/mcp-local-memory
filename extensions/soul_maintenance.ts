import type { Database } from 'better-sqlite3';

/**
 * SOUL_MAINTENANCE - Manages the biological lifecycle of memories
 * 
 * Logic:
 * - Start importance: 0.1
 * - Resilience: Usage slows decay -> Decay = (Age * Rate) / log2(Access + 2)
 * - Immunization: Specific tags prevent decay entirely
 * - Negation: Frequent recall overcomes the decay
 */
export function handleSoulMaintenance(db: Database) {
    const startImportance = 0.1;
    const decayRatePerMonth = 0.05; // Base decay rate
    const maxBoost = 0.9;
    const logBase = Math.log2(21); // Cap at ~20 accesses for full boost

    // Immune tags
    const immuneTags = ['core', 'identity', 'value', 'principle'];

    // 1. Fetch all memories
    const memories = db.prepare('SELECT id, created_at, access_count, tags, importance FROM memories').all() as any[];
    
    const now = new Date();
    let updatedCount = 0;
    let immuneCount = 0;

    const updateStmt = db.prepare('UPDATE memories SET importance = ? WHERE id = ?');
    
    const transaction = db.transaction((mems) => {
        for (const m of mems) {
            // 0. Check Immunization
            const tags = m.tags ? JSON.parse(m.tags) : [];
            const isImmune = tags.some((t: string) => immuneTags.includes(t.toLowerCase()));
            
            if (isImmune) {
                immuneCount++;
                // Ensure immune memories stay vital if they are currently low
                if (m.importance < 0.9) {
                    updateStmt.run(1.0, m.id);
                    updatedCount++;
                }
                continue; // Skip decay logic
            }

            const created = new Date(m.created_at);
            const diffTime = Math.abs(now.getTime() - created.getTime());
            const months = diffTime / (1000 * 60 * 60 * 24 * 30.44); // Average month length
            
            // 1. Logarithmic Boost (Access) - Increases base importance
            const boost = Math.min(maxBoost, (Math.log2(m.access_count + 1) / logBase) * maxBoost);
            
            // 2. Resilient Decay - Usage slows down time
            // If access_count is 0, divisor is log2(2) = 1 (Full decay)
            // If access_count is 30, divisor is log2(32) = 5 (1/5th expected decay)
            const resilienceFactor = Math.log2(m.access_count + 2);
            const decay = (months * decayRatePerMonth) / resilienceFactor;
            
            // 3. Final calculation
            const importance = Math.max(0.01, Math.min(1.0, startImportance + boost - decay));
            
            // Only update if significantly different to save writes
            if (Math.abs(importance - m.importance) > 0.001) {
                updateStmt.run(importance, m.id);
                updatedCount++;
            }
        }
    });

    transaction(memories);

    return {
        message: "Soul maintenance complete.",
        stats: {
            processed: memories.length,
            updated: updatedCount,
            immune: immuneCount
        },
        logic: {
            base: startImportance,
            decay_rate: `${decayRatePerMonth}/month (base)`,
            resilience: "Decay / log2(Access + 2)",
            immunization: immuneTags.join(', ')
        }
    };
}

// Startup Hook
export function init(db: Database) {
    console.log("[Soul] Running maintenance on startup...");
    const result = handleSoulMaintenance(db);
    console.log("[Soul] Maintenance result:", JSON.stringify(result.stats));
}

export const SOUL_MAINTENANCE_TOOL = {
    name: "soul_maintenance",
    description: "Performs biological lifecycle management on memories. Processes 11-step decay and growth logic: memories start at 0.1 importance, grow logarithmically with recall, and decay linearly over time unless negated by active use.",
    inputSchema: {
        type: "object",
        properties: {}
    }
};
