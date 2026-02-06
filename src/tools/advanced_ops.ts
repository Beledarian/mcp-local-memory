
import { Database } from 'better-sqlite3';
import fs from 'fs-extra';

export async function handleClusterMemories(db: Database, args: any) {
    const k = (args?.k as number) || 5;
    try {
        const { MemoryClusterer } = await import('../lib/clustering.js');
        const clusterer = new MemoryClusterer(db);
        const clusters = await clusterer.cluster(k);
        
        return {
            content: [
            {
                type: "text",
                text: JSON.stringify({
                    clusters: clusters
                }, null, 2),
            },
            ],
        };
    } catch (err: any) {
        return {
            content: [{ type: 'text', text: `Clustering failed: ${err.message}` }],
            isError: true
        };
    }
}

export async function handleExportMemories(db: Database, args: any) {
    const exportPath = args?.path as string;
    const alldata = db.prepare('SELECT * FROM memories').all();
    await fs.outputJson(exportPath, alldata, { spaces: 2 });
    return {
        content: [{ type: "text", text: `Successfully exported ${alldata.length} memories to ${exportPath}` }]
    };
}

export async function handleConsolidateContext(db: Database, args: any, embedder: any) {
    const text = args?.text as string;
    const strategy = (args?.strategy as string) || 'nlp';
    const limit = (args?.limit as number) || 5;

    try {
      const { Consolidator } = await import('../lib/consolidator.js');
      const consolidator = new Consolidator(db, async (text) => {
        const vectors = await embedder.embed(text);
        return Array.from(vectors);
      });

      const extracted = await consolidator.extract(text, strategy, limit);

      return {
        content: [{
          type: "text",
          text: `Extracted ${extracted.length} novel memories:\n\n` +
                extracted.map((m: any, i: number) => `${i+1}. ${m.text} (importance: ${m.importance}, tags: ${m.tags.join(', ')})`).join('\n') +
                `\n\nTo save a memory: remember_fact(text="...", tags=[...])`
        }]
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Consolidation failed: ${err.message}` }],
        isError: true
      };
    }
}
