/**
 * SOUL_MAINTENANCE - Manages the biological lifecycle of memories
 * 
 * Logic:
 * - Start importance: 0.1
 * - Resilience: Explicit reinforcement slows decay
 * - Immunization: Specific tags prevent decay entirely
 * - Passive recall never changes importance
 */
export function handleSoulMaintenance(db) {
    const startImportance = 0.1;
    const decayRatePerMonth = 0.05; // Base decay rate
    const maxBoost = 0.9;
    const logBase = Math.log2(21); // Cap at ~20 explicit reinforcements

    // Immune tags
    const immuneTags = ['core', 'identity', 'value', 'principle'];

    // 1. Fetch all memories
    const memories = db.prepare(`
        SELECT id, created_at, last_reinforced_at, reinforcement_count,
               tags, importance
        FROM memories
    `).all();
    
    const now = new Date();
    let updatedCount = 0;
    let immuneCount = 0;

    const updateStmt = db.prepare('UPDATE memories SET importance = ? WHERE id = ?');
    
    const transaction = db.transaction((mems) => {
        for (const m of mems) {
            // 0. Check Immunization
            let tags = [];
            try {
                tags = m.tags ? JSON.parse(m.tags) : [];
            } catch {}
            const isImmune = tags.some((t) => immuneTags.includes(t.toLowerCase()));
            
            if (isImmune) {
                immuneCount++;
                // Ensure immune memories stay vital if they are currently low
                if (m.importance < 0.9) {
                    updateStmt.run(1.0, m.id);
                    updatedCount++;
                }
                continue; // Skip decay logic
            }

            const anchor = new Date(m.last_reinforced_at || m.created_at);
            const diffTime = Math.max(0, now.getTime() - anchor.getTime());
            const months = diffTime / (1000 * 60 * 60 * 24 * 30.44); // Average month length
            
            // 1. Only explicit reinforcement increases the lifecycle base.
            const confirmedUses = Math.max(0, Math.min(20, m.reinforcement_count || 0));
            const boost = Math.min(maxBoost, (Math.log2(confirmedUses + 1) / logBase) * maxBoost);
            
            // 2. Confirmed use slows decay, with bounded diminishing returns.
            const resilienceFactor = Math.log2(confirmedUses + 2);
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
            resilience: "Decay / log2(Explicit reinforcement + 2)",
            immunization: immuneTags.join(', ')
        }
    };
}

// Startup Hook
export function init(db) {
    console.error("[Soul] Running maintenance on startup...");
    const result = handleSoulMaintenance(db);
    console.error("[Soul] Maintenance result:", JSON.stringify(result.stats));
}

export const SOUL_MAINTENANCE_TOOL = {
    name: "soul_maintenance",
    description: "Maintains memory lifecycle importance using explicit reinforcement, bounded decay, and immune tags. Passive recall has no effect.",
    inputSchema: {
        type: "object",
        properties: {}
    }
};
