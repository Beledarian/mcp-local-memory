import { Database } from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import * as chrono from 'chrono-node';
import { Archivist } from "../lib/archivist.js";

interface Embedder {
    embed(text: string): Promise<number[]>;
}

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

    // 2. Background Processing (ASYNC - Don't wait)
    (async () => {
        try {
            // Get embedding
            const embedding = await embedder.embed(text);
            const float32Embedding = new Float32Array(embedding);

            // Insert embedding
            db.prepare(
                `INSERT INTO vec_items (rowid, embedding) VALUES ((SELECT rowid FROM memories WHERE id = ?), ?)`
            ).run(id, Buffer.from(float32Embedding.buffer));
            
            // Trigger Archivist
            await archivist.process(text, id);
        } catch (err) {
            console.error(`Error processing background task for fact ${id}:`, err);
       }
    })();

    return {
      content: [
        {
          type: "text",
          text: `Remembered fact with ID: ${id}`,
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
    const results = [];

    // Transactionally insert all text first (Fast)
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

    // Background Processing (PARALLEL with concurrency limit)
    const EMBEDDING_CONCURRENCY = parseInt(process.env.EMBEDDING_CONCURRENCY || '5');
    
    (async () => {
        // Process in batches to limit concurrency
        for (let i = 0; i < facts.length; i += EMBEDDING_CONCURRENCY) {
            const batch = facts.slice(i, i + EMBEDDING_CONCURRENCY);
            await Promise.all(batch.map(async (f) => {
                try {
                    // 1. Embedding (concurrent within batch)
                    const embedding = await embedder.embed(f.text);
                    const float32Embedding = new Float32Array(embedding);
                    db.prepare(
                        `INSERT INTO vec_items (rowid, embedding) VALUES ((SELECT rowid FROM memories WHERE id = ?), ?)`
                    ).run(f.id, Buffer.from(float32Embedding.buffer));
                    
                    // 2. Archivist (concurrent within batch)
                    await archivist.process(f.text, f.id);
                } catch (e) {
                    console.error(`Error processing background task for fact ${f.id}:`, e);
                }
            }));
        }
    })();

    return {
        content: [{ type: "text", text: `Queued ${facts.length} facts for memory.` }]
    };
};

export const handleRecall = async (
    db: Database,
    embedder: Embedder,
    args: any
) => {
    const query = args?.query as string;
    const limit = (args?.limit as number) || 5;
    const returnJson = (args?.json as boolean) || false;
    const showDebug = (args?.debug as boolean) || false;
    
    let startDate: Date | null = args?.startDate ? new Date(args.startDate as string) : null;
    let endDate: Date | null = args?.endDate ? new Date(args.endDate as string) : null;

    let debugSteps = [];
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
                     semanticQuery = semanticQuery.replace(/\s+/, " ").trim();
                     debugSteps.push(`Time Tunnel: Cleaned query: "${semanticQuery}"`);
                }
            }
        }
    } catch (err) {
        console.warn("Chrono parsing failed", err);
    }

    try {
        // 1. Get query embedding
        debugSteps.push(`Embedding query: "${semanticQuery}"...`);
        const embedding = await embedder.embed(semanticQuery);
        const float32Embedding = new Float32Array(embedding);

        // 2. Search
        let results: any[] = [];
        let usedSearchMethod = "vector";

        try {
            debugSteps.push("Attempting vector search...");
            let whereClause = "WHERE 1=1";
            const params: any[] = [Buffer.from(float32Embedding.buffer), Buffer.from(float32Embedding.buffer)];

            if (startDate) {
                whereClause += " AND m.created_at >= ?";
                params.push(startDate.toISOString());
            }
            if (endDate) {
                whereClause += " AND m.created_at <= ?";
                params.push(endDate.toISOString());
            }

            params.push(limit * 2);

            results = db
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
                vec_distance_cosine(v.embedding, ?) as distance,
                ranked_score(m.importance, m.last_accessed, m.access_count, vec_distance_cosine(v.embedding, ?)) as score
                FROM vec_items v
                JOIN memories m ON v.rowid = m.rowid
                ${whereClause}
                ORDER BY score DESC
                LIMIT ?
                `
            )
            .all(...params) as any[];
            debugSteps.push(`Vector search success. Got ${results.length} results.`);
        } catch (err: any) {
            const msg = `Vector search failed: ${err.message}`;
            console.warn(msg);
            debugSteps.push(msg);
            usedSearchMethod = "fts-fallback";
        }

        // 3. Fallback/Hybrid using FTS
        if (results.length === 0 || usedSearchMethod === "fts-fallback") {
            debugSteps.push("Entering FTS fallback...");
            try {
                const tokenizeFTSQuery = (q: string): string => {
                    const tokens = q.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(t => t.length > 0).map(t => `"${t}"`);
                    return tokens.length > 0 ? tokens.join(' OR ') : q;
                };
                
                let ftsWhere = "WHERE memories_fts MATCH ?";
                const ftsParams: any[] = [tokenizeFTSQuery(query)];

                if (startDate) {
                    ftsWhere += " AND memories.created_at >= ?";
                    ftsParams.push(startDate.toISOString());
                }
                if (endDate) {
                    ftsWhere += " AND memories.created_at <= ?";
                    ftsParams.push(endDate.toISOString());
                }
                ftsParams.push(limit);
                
                const ftsResults = db.prepare(`
                    SELECT 
                        id, 
                        memories.content,
                        memories.tags,
                        memories.importance,
                        created_at,
                        rank as score
                    FROM memories_fts 
                    JOIN memories ON memories_fts.rowid = memories.rowid
                    ${ftsWhere} 
                    ORDER BY rank
                    LIMIT ?
                `).all(...ftsParams) as any[];
                
                results = ftsResults;
                usedSearchMethod = (usedSearchMethod === "vector") ? "fts-hybrid" : "fts-only";
                debugSteps.push(`FTS search success. Got ${results.length} results.`);
            } catch (ftsErr: any) {
                const msg = `FTS search failed: ${ftsErr.message}`;
                console.error(msg);
                debugSteps.push(msg);
                throw new Error(`Both Vector and FTS search failed. Debug: ${debugSteps.join(' -> ')}`);
            }
        }

        // Post-process boosting
        debugSteps.push("Post-processing...");
        const tagBoost = parseFloat(process.env.TAG_MATCH_BOOST || '0.15');
        const queryLower = query.toLowerCase();
        results = results.map(r => {
            try {
                const tags = JSON.parse(r.tags || '[]') as string[];
                const hasExactMatch = tags.some((tag: string) => queryLower.includes(tag.toLowerCase()));
                return { ...r, score: (r.score || 0) + (hasExactMatch ? tagBoost : 0) };
            } catch { return r; }
        }).sort((a, b) => b.score - a.score).slice(0, limit);

        // Update Access Stats
        if (results.length > 0) {
            try {
                debugSteps.push("Updating access stats...");
                const ids = results.map(r => r.id);
                const ph = ids.map(() => '?').join(',');
                
                // Update access count first
                db.prepare(`
                    UPDATE memories 
                    SET last_accessed = CURRENT_TIMESTAMP, 
                        access_count = access_count + 1
                    WHERE id IN (${ph})
                `).run(...ids);
                
                // Then calculate logarithmic importance (Updated for Resilience Logic integration if needed later)
                // For now, sticking to current logic, relying on Soul Maintenance for deep retention.
                // Formula: importance = 0.5 + 0.5 * (ln(access_count + 1) / ln(21))
                db.prepare(`
                    UPDATE memories
                    SET importance = 0.5 + 0.5 * (log(access_count + 1) / log(21))
                    WHERE id IN (${ph})
                `).run(...ids);
                
            } catch (e: any) {
                console.warn(`Failed to update access stats: ${e.message}`);
            }
        }

        if (returnJson) {
            return {
                content: [{ type: "text", text: JSON.stringify({ results, debug: showDebug ? debugSteps : undefined }, null, 2) }]
            };
        }

        let output = `Found ${results.length} relevant memories via ${usedSearchMethod}:\n\n`;
        results.forEach((r, i) => {
            const score = r.score ? ` (Score: ${r.score.toFixed(2)})` : '';
            const importance = r.importance ? ` [Imp: ${r.importance.toFixed(2)}]` : '';
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

export const handleForget = (db: Database, args: any) => {
    const memory_id = args?.memory_id as string;
    const info = db.prepare('SELECT rowid FROM memories WHERE id = ?').get(memory_id) as any;
    
    if (info) {
        const tx = db.transaction(() => {
            db.prepare('DELETE FROM memories WHERE id = ?').run(memory_id);
            // Also delete vector index
            db.prepare('DELETE FROM vec_items WHERE rowid = ?').run(info.rowid);
        });
        tx();
        return { content: [{ type: "text", text: `Memory ${memory_id} forgotten.` }] };
    }
    return { content: [{ type: "text", text: `Memory ${memory_id} not found.` }], isError: true };
};

export const handleListRecent = (db: Database, args: any) => {
    const limit = (args?.limit as number) || 10;
    const returnJson = (args?.json as boolean) || false;
    
    const results = db.prepare(`
        SELECT id, content, tags, created_at FROM memories 
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
