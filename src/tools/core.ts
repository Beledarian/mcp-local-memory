import { Database } from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import * as chrono from 'chrono-node';
import { createHash } from "node:crypto";
import { Archivist } from "../lib/archivist.js";
import {
    MAX_REINFORCED_IMPORTANCE,
    clampImportance,
    getRecallScoringConfig,
    rankRecallCandidates,
    tokenizeRecallQuery,
} from "../lib/scoring.js";

interface Embedder {
    embed(text: string): Promise<number[]>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const utcDate = (date: Date): string => date.toISOString().slice(0, 10);

const loadRecallFamiliarity = (
    db: Database,
    candidates: any[],
    windowDays: number,
    now = new Date(),
) => {
    const ids = [...new Set(
        candidates
            .filter((candidate) => candidate.lifecycle_state === "active")
            .map((candidate) => candidate.id as string),
    )];
    if (ids.length === 0) return;

    const cutoff = utcDate(
        new Date(now.getTime() - Math.max(1, windowDays) * DAY_MS),
    );
    const placeholders = ids.map(() => "?").join(",");
    const counts = db.prepare(`
        SELECT memory_id, COUNT(*) AS familiarity_count
        FROM memory_recall_exposures
        WHERE recalled_on >= ?
          AND memory_id IN (${placeholders})
        GROUP BY memory_id
    `).all(cutoff, ...ids) as Array<{
        memory_id: string;
        familiarity_count: number;
    }>;
    const byId = new Map(
        counts.map((row) => [row.memory_id, row.familiarity_count]),
    );
    for (const candidate of candidates) {
        candidate.familiarity_count =
            candidate.lifecycle_state === "active"
                ? (byId.get(candidate.id) ?? 0)
                : 0;
    }
};

const recordRecallFamiliarity = (
    db: Database,
    results: any[],
    queryTokens: string[],
    windowDays: number,
    now = new Date(),
): number => {
    const memoryIds = [...new Set(
        results
            .filter((result) => result.lifecycle_state === "active")
            .map((result) => result.id as string),
    )];
    if (memoryIds.length === 0 || queryTokens.length === 0) return 0;

    const normalizedQuery = [...queryTokens].sort().join("\u001f");
    const queryHash = createHash("sha256")
        .update(normalizedQuery)
        .digest("hex");
    const recalledOn = utcDate(now);
    const cutoff = utcDate(
        new Date(now.getTime() - Math.max(1, windowDays) * DAY_MS),
    );
    const insert = db.prepare(`
        INSERT OR IGNORE INTO memory_recall_exposures(
          memory_id, query_hash, recalled_on
        ) VALUES (?, ?, ?)
    `);
    const transaction = db.transaction(() => {
        db.prepare(`
            DELETE FROM memory_recall_exposures
            WHERE recalled_on < ?
        `).run(cutoff);
        let inserted = 0;
        for (const memoryId of memoryIds) {
            inserted += insert.run(memoryId, queryHash, recalledOn).changes;
        }
        return inserted;
    });
    return transaction();
};

const memoryStillExists = (db: Database, id: string): boolean =>
    Boolean(db.prepare("SELECT 1 FROM memories WHERE id = ?").get(id));

const insertMemoryEmbedding = (
    db: Database,
    id: string,
    embedding: number[],
): boolean => {
    const result = db.prepare(`
        INSERT INTO vec_items (rowid, embedding)
        SELECT rowid, ? FROM memories WHERE id = ?
    `).run(Buffer.from(new Float32Array(embedding).buffer), id);
    return result.changes > 0;
};

const enrichMemory = async (
    db: Database,
    embedder: Embedder,
    archivist: Archivist,
    id: string,
    text: string,
): Promise<string[]> => {
    const warnings: string[] = [];

    try {
        const embedding = await embedder.embed(text);
        if (!insertMemoryEmbedding(db, id, embedding)) {
            return ["enrichment cancelled because the memory was forgotten"];
        }
    } catch (error: any) {
        warnings.push(`embedding unavailable: ${error.message}`);
    }

    if (!memoryStillExists(db, id)) {
        return ["enrichment cancelled because the memory was forgotten"];
    }

    try {
        await archivist.process(text, id);
    } catch (error: any) {
        warnings.push(`archivist unavailable: ${error.message}`);
    }

    return warnings;
};

export const handleRememberFact = async (
    db: Database, 
    embedder: Embedder, 
    archivist: Archivist, 
    args: any
) => {
    const text = args?.text as string;
    const tags = (args?.tags as string[]) || [];
    const id = uuidv4();
    
    // 1. Insert text into DB immediately (FAST)
    const insertTx = db.transaction(() => {
        db.prepare(
            `INSERT INTO memories (id, content, tags, last_accessed, importance) VALUES (?, ?, ?, CURRENT_TIMESTAMP, 0.5)`
        ).run(id, text, JSON.stringify(tags));
    });
    insertTx();

    // Finish derived writes before acknowledging the memory. This avoids
    // orphan entities/vectors if the process exits or forget runs immediately.
    const warnings = await enrichMemory(db, embedder, archivist, id, text);
    return {
      content: [
        {
          type: "text",
          text: warnings.length > 0
              ? `Remembered fact with ID: ${id}. Enrichment warning: ${warnings.join("; ")}.`
              : `Remembered fact with ID: ${id}`,
        },
      ],
    };
};

export const handleRememberFacts = async (
    db: Database,
    embedder: Embedder,
    archivist: Archivist,
    args: any
) => {
    const facts = (args?.facts as any[]) || [];
    // Transactionally insert all source text first.
    const insertTx = db.transaction(() => {
        for (const f of facts) {
            const id = uuidv4();
            f.id = id; // Store for post-processing
            db.prepare(
                `INSERT INTO memories (id, content, tags, last_accessed, importance) VALUES (?, ?, ?, CURRENT_TIMESTAMP, 0.5)`
            ).run(id, f.text, JSON.stringify(f.tags || []));
        }
    });
    insertTx();

    const parsedConcurrency = Number.parseInt(
        process.env.EMBEDDING_CONCURRENCY || "5",
        10,
    );
    const concurrency = Number.isFinite(parsedConcurrency)
        ? Math.min(32, Math.max(1, parsedConcurrency))
        : 5;
    const warnings: string[] = [];

    for (let i = 0; i < facts.length; i += concurrency) {
        const batch = facts.slice(i, i + concurrency);
        const batchWarnings = await Promise.all(
            batch.map(async (fact) => ({
                id: fact.id,
                warnings: await enrichMemory(
                    db,
                    embedder,
                    archivist,
                    fact.id,
                    fact.text,
                ),
            })),
        );
        for (const result of batchWarnings) {
            if (result.warnings.length > 0) {
                warnings.push(`${result.id}: ${result.warnings.join("; ")}`);
            }
        }
    }

    return {
        content: [{
            type: "text",
            text: warnings.length > 0
                ? `Remembered ${facts.length} facts. Enrichment warnings: ${warnings.join(" | ")}`
                : `Remembered ${facts.length} facts.`,
        }]
    };
};

export const handleRecall = async (
    db: Database,
    embedder: Embedder,
    args: any
) => {
    const query = args?.query as string;
    const requestedLimit = Number(args?.limit ?? 5);
    const limit = Number.isFinite(requestedLimit)
        ? Math.min(100, Math.max(1, Math.trunc(requestedLimit)))
        : 5;
    const returnJson = (args?.json as boolean) || false;
    const showDebug = (args?.debug as boolean) || false;
    const includeOutdated = (args?.include_outdated as boolean) || false;
    
    let startDate: Date | null = args?.startDate ? new Date(args.startDate as string) : null;
    let endDate: Date | null = args?.endDate ? new Date(args.endDate as string) : null;

    const debugSteps: string[] = [];
    let semanticQuery = query;

    // 0. Time Tunnel Parsing (Chrono)
    try {
        if (!startDate && !endDate && query) {
            const parsed = chrono.parse(query, new Date(), { forwardDate: false });
            if (parsed.length > 0) {
                const result = parsed[0];
                if (result.start) {
                    startDate = result.start.date();
                    debugSteps.push(`Time Tunnel: Parsed start date: ${startDate.toISOString()}`);
                }
                if (result.end) {
                    endDate = result.end.date();
                    debugSteps.push(`Time Tunnel: Parsed end date: ${endDate.toISOString()}`);
                }
                
                if (startDate || endDate) {
                     semanticQuery = query.replace(result.text, "").trim();
                     semanticQuery = semanticQuery.replace(/\s+/g, " ").trim();
                     debugSteps.push(`Time Tunnel: Cleaned query: "${semanticQuery}"`);
                }
            }
        }
    } catch (err) {
        console.warn("Chrono parsing failed", err);
    }

    try {
        const candidateLimit = Math.min(200, Math.max(20, limit * 4));
        const vectorResults: any[] = [];
        const keywordResults: any[] = [];
        let vectorFailure: string | null = null;
        let keywordFailure: string | null = null;
        const relevanceQuery = semanticQuery;
        const queryTokens = tokenizeRecallQuery(relevanceQuery);

        // Vector and FTS are independent candidate sources. A vector hit must
        // not suppress an exact keyword match.
        if (queryTokens.length > 0) {
            try {
                debugSteps.push(`Embedding query: "${relevanceQuery}"...`);
                const embedding = await embedder.embed(relevanceQuery);
                const float32Embedding = new Float32Array(embedding);
                debugSteps.push("Attempting vector search...");
                let whereClause = includeOutdated
                    ? "WHERE 1=1"
                    : "WHERE m.lifecycle_state = 'active'";
                const params: any[] = [Buffer.from(float32Embedding.buffer)];

                if (startDate) {
                    whereClause += " AND m.created_at >= ?";
                    params.push(startDate.toISOString());
                }
                if (endDate) {
                    whereClause += " AND m.created_at <= ?";
                    params.push(endDate.toISOString());
                }

                params.push(candidateLimit);

                vectorResults.push(...db
                .prepare(
                    `
                    SELECT
                    m.id,
                    m.content,
                    m.tags,
                    m.created_at,
                    m.importance,
                    m.last_accessed,
                    m.access_count,
                    m.last_reinforced_at,
                    m.reinforcement_count,
                    m.lifecycle_state,
                    vec_distance_cosine(v.embedding, ?) as distance
                    FROM vec_items v
                    JOIN memories m ON v.rowid = m.rowid
                    ${whereClause}
                    ORDER BY distance ASC
                    LIMIT ?
                    `
                )
                .all(...params) as any[]);
                debugSteps.push(`Vector search success. Got ${vectorResults.length} candidates.`);
            } catch (err: any) {
                vectorFailure = err.message;
                debugSteps.push(`Vector search unavailable: ${vectorFailure}`);
            }
        } else {
            debugSteps.push("Skipping vector search for a date-only query.");
        }

        if (queryTokens.length > 0) {
            try {
                debugSteps.push("Attempting FTS keyword search...");
                let ftsWhere = includeOutdated
                    ? "WHERE memories_fts MATCH ?"
                    : "WHERE memories_fts MATCH ? AND memories.lifecycle_state = 'active'";
                const ftsParams: any[] = [
                    queryTokens
                        .map((token) => `"${token.replaceAll('"', '""')}"`)
                        .join(" OR "),
                ];

                if (startDate) {
                    ftsWhere += " AND memories.created_at >= ?";
                    ftsParams.push(startDate.toISOString());
                }
                if (endDate) {
                    ftsWhere += " AND memories.created_at <= ?";
                    ftsParams.push(endDate.toISOString());
                }
                ftsParams.push(candidateLimit);
                
                keywordResults.push(...db.prepare(`
                    SELECT 
                        id, 
                        memories.content,
                        memories.tags,
                        memories.importance,
                        memories.last_accessed,
                        memories.access_count,
                        memories.last_reinforced_at,
                        memories.reinforcement_count,
                        memories.lifecycle_state,
                        created_at,
                        rank as ftsRank
                    FROM memories_fts 
                    JOIN memories ON memories_fts.rowid = memories.rowid
                    ${ftsWhere} 
                    ORDER BY rank
                    LIMIT ?
                `).all(...ftsParams) as any[]);
                debugSteps.push(`FTS search success. Got ${keywordResults.length} candidates.`);
            } catch (ftsErr: any) {
                keywordFailure = ftsErr.message;
                debugSteps.push(`FTS search unavailable: ${keywordFailure}`);
            }
        } else if (startDate || endDate) {
            try {
                let timeWhere = includeOutdated
                    ? "WHERE 1=1"
                    : "WHERE lifecycle_state = 'active'";
                const timeParams: any[] = [];
                if (startDate) {
                    timeWhere += " AND created_at >= ?";
                    timeParams.push(startDate.toISOString());
                }
                if (endDate) {
                    timeWhere += " AND created_at <= ?";
                    timeParams.push(endDate.toISOString());
                }
                timeParams.push(candidateLimit);
                keywordResults.push(...db.prepare(`
                    SELECT id, content, tags, importance, last_accessed,
                           access_count, last_reinforced_at,
                           reinforcement_count, lifecycle_state, created_at,
                           0 as ftsRank
                    FROM memories
                    ${timeWhere}
                    ORDER BY created_at DESC
                    LIMIT ?
                `).all(...timeParams) as any[]);
                debugSteps.push(`Time-only search got ${keywordResults.length} candidates.`);
            } catch (timeErr: any) {
                keywordFailure = timeErr.message;
                debugSteps.push(`Time-only search unavailable: ${keywordFailure}`);
            }
        }

        if (
            vectorResults.length === 0 &&
            keywordResults.length === 0 &&
            vectorFailure &&
            keywordFailure
        ) {
            throw new Error(
                `Vector and FTS search failed: ${vectorFailure}; ${keywordFailure}`,
            );
        }

        const scoringConfig = getRecallScoringConfig();
        loadRecallFamiliarity(
            db,
            [...vectorResults, ...keywordResults],
            scoringConfig.familiarityWindowDays,
        );
        const results = rankRecallCandidates(
            vectorResults,
            keywordResults,
            relevanceQuery,
            limit,
            scoringConfig,
        );
        const usedSearchMethod =
            vectorResults.length > 0 && keywordResults.length > 0
                ? "hybrid"
                : vectorResults.length > 0
                  ? "vector"
                  : keywordResults.length > 0
                    ? queryTokens.length > 0
                        ? "fts"
                        : "time"
                    : "none";
        debugSteps.push(
            `Scoring config: relevance=${scoringConfig.relevanceWeight.toFixed(2)}, ` +
            `importance=${(1 - scoringConfig.relevanceWeight).toFixed(2)}, ` +
            `minimumRelevance=${scoringConfig.minimumRelevance.toFixed(2)}, ` +
            `semanticOnlyMinimum=${scoringConfig.semanticOnlyMinimumRelevance.toFixed(2)}, ` +
            `dedupSimilarity=${scoringConfig.deduplicationThreshold.toFixed(2)}, ` +
            `tagBoost=${scoringConfig.tagMatchBoost.toFixed(2)}, ` +
            `keywordCoverageBoost=${scoringConfig.keywordCoverageBoost.toFixed(2)}, ` +
            `familiarityMaxBoost=${scoringConfig.familiarityMaxBoost.toFixed(2)}, ` +
            `familiarityWindowDays=${scoringConfig.familiarityWindowDays.toFixed(0)}`,
        );
        debugSteps.push(`Ranked ${results.length} results via ${usedSearchMethod}.`);
        debugSteps.push(
            includeOutdated
                ? "Lifecycle filter: including active, outdated, and incorrect memories."
                : "Lifecycle filter: active memories only.",
        );
        let familiarityWrites = 0;
        if (scoringConfig.familiarityMaxBoost > 0) {
            try {
                familiarityWrites = recordRecallFamiliarity(
                    db,
                    results,
                    queryTokens,
                    scoringConfig.familiarityWindowDays,
                );
            } catch (error: any) {
                debugSteps.push(
                    `Familiarity telemetry unavailable: ${error?.message ?? String(error)}`,
                );
            }
        }
        debugSteps.push(
            `Familiarity telemetry: ${familiarityWrites} new daily exposure(s); ` +
            "importance and decay anchors unchanged.",
        );
        debugSteps.push(
            "Recall preserves lifecycle state; use reinforce_memory for confirmed feedback.",
        );

        if (returnJson) {
            return {
                content: [{ type: "text", text: JSON.stringify({
                    results,
                    method: usedSearchMethod,
                    debug: showDebug ? debugSteps : undefined,
                }, null, 2) }]
            };
        }

        let output = `Found ${results.length} relevant memories via ${usedSearchMethod}:\n\n`;
        results.forEach((r, i) => {
            const score = Number.isFinite(r.score) ? ` (Score: ${r.score.toFixed(2)})` : '';
            const importance = Number.isFinite(r.importance)
                ? ` [Imp: ${Number(r.importance).toFixed(2)}]`
                : '';
            const tags = r.tags && r.tags !== '[]' ? ` Tags: ${r.tags}` : '';
            output += `${i + 1}. ${r.content}${score}${importance}${tags}\n`;
        });
        
        if (showDebug) {
            output += `\n[Debug] Steps:\n${debugSteps.join('\n')}`;
        }

        return {
            content: [{ type: "text", text: output }]
        };
    } catch (err: any) {
        return {
            content: [{ type: "text", text: `Error during recall: ${err.message}` }],
            isError: true
        };
    }
};

type ReinforcementSignal =
    | "used"
    | "important"
    | "irrelevant"
    | "incorrect"
    | "outdated"
    | "restore";

const REINFORCEMENT_RULES: Record<
    ReinforcementSignal,
    { direction: "positive" | "negative" | "state"; strength: number }
> = {
    used: { direction: "positive", strength: 0.08 },
    important: { direction: "positive", strength: 0.18 },
    irrelevant: { direction: "negative", strength: 0.2 },
    incorrect: { direction: "negative", strength: 0.5 },
    outdated: { direction: "state", strength: 0 },
    restore: { direction: "state", strength: 0 },
};

export const handleReinforceMemory = (db: Database, args: any) => {
    const memoryId = args?.memory_id as string;
    const signal = args?.signal as ReinforcementSignal;
    const reason = (args?.reason as string | undefined) ?? null;
    const rule = REINFORCEMENT_RULES[signal];
    if (!rule) {
        return {
            content: [{
                type: "text",
                text:
                    "Invalid reinforcement signal. Use: used, important, " +
                    "irrelevant, incorrect, outdated, or restore.",
            }],
            isError: true,
        };
    }
    const memory = db.prepare(`
        SELECT id, importance, reinforcement_count, lifecycle_state
        FROM memories
        WHERE id = ?
    `).get(memoryId) as
        | {
            id: string;
            importance: number;
            reinforcement_count: number;
            lifecycle_state: "active" | "outdated" | "incorrect";
        }
        | undefined;

    if (!memory) {
        return {
            content: [{ type: "text", text: `Memory not found: ${memoryId}` }],
            isError: true,
        };
    }
    if (
        rule.direction === "positive" &&
        memory.lifecycle_state !== "active"
    ) {
        return {
            content: [{
                type: "text",
                text:
                    `Memory ${memoryId} is ${memory.lifecycle_state}. ` +
                    "Restore it explicitly before positive reinforcement.",
            }],
            isError: true,
        };
    }

    if (rule.direction === "positive") {
        const duplicate = db.prepare(`
            SELECT 1
            FROM memory_feedback
            WHERE memory_id = ?
              AND signal = ?
              AND created_at >= datetime('now', '-1 hour')
            LIMIT 1
        `).get(memoryId, signal);
        if (duplicate) {
            return {
                content: [{
                    type: "text",
                    text: `Reinforcement unchanged for ${memoryId}: identical positive signal is in its one-hour cooldown.`,
                }],
            };
        }
    }

    const currentImportance = clampImportance(memory.importance);
    let delta: number;
    if (rule.direction === "positive") {
        const recent = db.prepare(`
            SELECT COUNT(*) AS count
            FROM memory_feedback
            WHERE memory_id = ?
              AND signal IN ('used', 'important')
              AND created_at >= datetime('now', '-7 days')
        `).get(memoryId) as { count: number };
        const headroom = Math.max(
            0,
            MAX_REINFORCED_IMPORTANCE - currentImportance,
        );
        delta = (rule.strength * headroom) / (1 + recent.count);
    } else if (rule.direction === "negative") {
        delta = -rule.strength * currentImportance;
    } else {
        delta = 0;
    }

    const nextImportance = clampImportance(currentImportance + delta);
    const appliedDelta = nextImportance - currentImportance;
    const transaction = db.transaction(() => {
        db.prepare(`
            INSERT INTO memory_feedback(memory_id, signal, delta, reason)
            VALUES (?, ?, ?, ?)
        `).run(memoryId, signal, appliedDelta, reason);

        if (rule.direction === "positive") {
            db.prepare(`
                UPDATE memories
                SET importance = ?,
                    last_reinforced_at = CURRENT_TIMESTAMP,
                    reinforcement_count = reinforcement_count + 1
                WHERE id = ?
            `).run(nextImportance, memoryId);
        } else if (rule.direction === "negative") {
            db.prepare(`
                UPDATE memories
                SET importance = ?,
                    lifecycle_state = CASE
                      WHEN ? = 'incorrect' THEN 'incorrect'
                      ELSE lifecycle_state
                    END
                WHERE id = ?
            `).run(nextImportance, signal, memoryId);
        } else {
            db.prepare(`
                UPDATE memories
                SET lifecycle_state = ?
                WHERE id = ?
            `).run(signal === "restore" ? "active" : "outdated", memoryId);
        }
    });
    transaction();

    return {
        content: [{
            type: "text",
            text:
                `Recorded ${signal} feedback for ${memoryId}. ` +
                `Importance ${currentImportance.toFixed(3)} -> ${nextImportance.toFixed(3)} ` +
                `(delta ${appliedDelta >= 0 ? "+" : ""}${appliedDelta.toFixed(3)}). ` +
                `Lifecycle state: ${
                    signal === "restore"
                        ? "active"
                        : signal === "outdated" || signal === "incorrect"
                          ? signal
                          : memory.lifecycle_state
                }.`,
        }],
    };
};

export const handleForget = (db: Database, args: any) => {
    const memory_id = args?.memory_id as string;
    const info = db.prepare('SELECT rowid FROM memories WHERE id = ?').get(memory_id) as any;
    
    if (info) {
        const tx = db.transaction(() => {
            const entityIds = db.prepare(`
                SELECT entity_id FROM memory_entities WHERE memory_id = ?
            `).all(memory_id) as Array<{ entity_id: string }>;
            const relations = db.prepare(`
                SELECT source, target, relation
                FROM memory_relations WHERE memory_id = ?
            `).all(memory_id) as Array<{
                source: string;
                target: string;
                relation: string;
            }>;

            db.prepare('DELETE FROM vec_items WHERE rowid = ?').run(info.rowid);
            db.prepare('DELETE FROM memories WHERE id = ?').run(memory_id);

            const deleteUnreferencedRelation = db.prepare(`
                DELETE FROM relations
                WHERE source = ? AND target = ? AND relation = ?
                  AND auto_generated = 1
                  AND NOT EXISTS (
                    SELECT 1 FROM memory_relations
                    WHERE source = ? AND target = ? AND relation = ?
                  )
            `);
            for (const relation of relations) {
                deleteUnreferencedRelation.run(
                    relation.source,
                    relation.target,
                    relation.relation,
                    relation.source,
                    relation.target,
                    relation.relation,
                );
            }

            const deleteUnreferencedEntity = db.prepare(`
                DELETE FROM entities
                WHERE id = ?
                  AND auto_generated = 1
                  AND NOT EXISTS (
                    SELECT 1 FROM memory_entities WHERE entity_id = ?
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM relations
                    WHERE source = entities.name OR target = entities.name
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM entity_observations
                    WHERE entity_id = entities.id
                  )
            `);
            for (const entity of entityIds) {
                const entityRow = db.prepare(
                    'SELECT rowid FROM entities WHERE id = ?'
                ).get(entity.entity_id) as any;
                const deleted = deleteUnreferencedEntity.run(
                    entity.entity_id,
                    entity.entity_id,
                );
                if (entityRow && deleted.changes > 0) {
                    db.prepare('DELETE FROM vec_entities WHERE rowid = ?')
                        .run(entityRow.rowid);
                }
            }
        });
        tx.immediate();
        return { content: [{ type: "text", text: `Memory ${memory_id} forgotten.` }] };
    }
    return { content: [{ type: "text", text: `Memory ${memory_id} not found.` }], isError: true };
};

export const handleListRecent = (db: Database, args: any) => {
    const limit = (args?.limit as number) || 10;
    const returnJson = (args?.json as boolean) || false;
    
    const results = db.prepare(`
        SELECT id, content, tags, created_at FROM memories
        WHERE lifecycle_state = 'active'
        ORDER BY created_at DESC LIMIT ?
    `).all(limit) as any[];
    
    if (returnJson) {
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }
    
    let output = "Recent Memories:\n";
    results.forEach((r: any) => {
        const tags = r.tags && r.tags !== '[]' ? ` [${r.tags}]` : '';
        output += `- ${r.content}${tags} (${r.created_at})\n`;
    });
    return { content: [{ type: "text", text: output }] };
};
