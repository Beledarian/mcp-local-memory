import { Database } from 'better-sqlite3';
import nlp from 'compromise';

type EmbedderFn = (text: string) => Promise<number[]>;

export interface ExtractedFact {
    text: string;
    importance: number;
    tags: string[];
}

export class Consolidator {
    private db: Database;
    private embedder?: EmbedderFn;

    constructor(db: Database, embedder?: EmbedderFn) {
        this.db = db;
        this.embedder = embedder;
    }

    async extract(text: string, strategy: string = 'nlp', limit: number = 5): Promise<ExtractedFact[]> {
        if (strategy === 'llm') {
            return await this.extractWithLLM(text, limit);
        } else {
            return await this.extractWithNLP(text, limit);
        }
    }

    private async extractWithNLP(text: string, limit: number): Promise<ExtractedFact[]> {
        console.error(`[Consolidator:NLP] Analyzing text (${text.length} chars)...`);
        
        const doc = nlp(text);
        const facts: ExtractedFact[] = [];

        // Extract entities
        const people = doc.people().out('array');
        const places = doc.places().out('array');
        const orgs = doc.organizations().out('array');
        const projects = doc.match('(project|operation|initiative) .').out('array');

        // Build facts from entities
        for (const person of people.slice(0, 3)) {
            facts.push({
                text: `User mentioned person: ${person}`,
                importance: 0.5,
                tags: ['person', person.toLowerCase()]
            });
        }

        for (const project of projects.slice(0, 2)) {
            facts.push({
                text: `User is working on ${project}`,
                importance: 0.7,
                tags: ['project', project.toLowerCase()]
            });
        }

        // Extract preference patterns
        const preferences = doc.match('(prefer*|like*|love*|hate*|dislike*) .+').out('array');
        for (const pref of preferences.slice(0, 3)) {
            facts.push({
                text: pref.trim(),
                importance: 0.6,
                tags: ['preference']
            });
        }

        // Deduplicate
        const deduplicated = await this.deduplicate(facts);
        
        console.error(`[Consolidator:NLP] Extracted ${deduplicated.length} facts`);
        return deduplicated.slice(0, limit);
    }

    private async extractWithLLM(text: string, limit: number): Promise<ExtractedFact[]> {
        console.error(`[Consolidator:LLM] Analyzing text (${text.length} chars)...`);

        // Fetch recent memories for deduplication
        const recentMemories = this.db.prepare(`
            SELECT content FROM memories 
            ORDER BY created_at DESC 
            LIMIT 10
        `).all() as any[];

        const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';

        const prompt = `Extract 3-5 specific, memorable facts from this conversation summary.

RULES:
- Extract SPECIFIC facts (e.g., "User prefers Python for data science" not "User likes programming")
- SKIP facts already in memory
- Focus on: preferences, goals, projects, decisions, key learnings

Existing memories (do not duplicate):
${recentMemories.map(m => `- ${m.content}`).join('\n')}

Conversation summary:
${text}

Return JSON:
{
  "facts": [
    {"text": "User prefers Python for data science work", "importance": 0.7, "tags": ["python", "data-science", "preference"]}
  ]
}`;

        try {
            const response = await fetch(ollamaUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'llama3',
                    prompt: prompt,
                    stream: false,
                    format: 'json'
                })
            });

            if (!response.ok) {
                console.error(`[Consolidator:LLM] Failed: ${response.statusText}`);
                return [];
            }

            const data = await response.json();
            const json = JSON.parse(data.response);

            if (!json.facts || !Array.isArray(json.facts)) {
                console.error('[Consolidator:LLM] Invalid response format');
                return [];
            }

            // Deduplicate against existing memories
            const deduplicated = await this.deduplicate(json.facts);

            console.error(`[Consolidator:LLM] Extracted ${deduplicated.length} facts`);
            return deduplicated.slice(0, limit);
        } catch (error) {
            console.error('[Consolidator:LLM] Error:', error);
            return [];
        }
    }

    private async deduplicate(facts: ExtractedFact[]): Promise<ExtractedFact[]> {
        if (!this.embedder) {
            // No embedder available, return as-is
            return facts;
        }

        try {
            // Fetch recent memories
            const existingRows = this.db.prepare(`
                SELECT m.content, v.embedding
                FROM vec_items v
                JOIN memories m ON v.rowid = m.rowid
                ORDER BY m.created_at DESC
                LIMIT 20
            `).all() as any[];

            const existingEmbeddings = existingRows.map(r => ({
                content: r.content,
                vector: new Float32Array(r.embedding.buffer)
            }));

            // Filter out duplicates
            const novel: ExtractedFact[] = [];
            for (const fact of facts) {
                const factEmbedding = await this.embedder(fact.text);
                const factVector = new Float32Array(factEmbedding);

                let isDuplicate = false;
                for (const existing of existingEmbeddings) {
                    const similarity = this.cosineSimilarity(factVector, existing.vector);
                    if (similarity > 0.85) {
                        console.error(`[Consolidator] Skipping duplicate: "${fact.text}" (similarity: ${similarity.toFixed(2)} with "${existing.content}")`);
                        isDuplicate = true;
                        break;
                    }
                }

                if (!isDuplicate) {
                    novel.push(fact);
                }
            }

            return novel;
        } catch (error) {
            console.error('[Consolidator] Deduplication failed:', error);
            return facts; // Return all if dedup fails
        }
    }

    private cosineSimilarity(a: Float32Array, b: Float32Array): number {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
}
