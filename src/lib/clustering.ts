import { Database } from 'better-sqlite3';

interface ClusterPoint {
    id: string;
    // Keep raw buffer or Float32Array. Float32Array is better for math.
    // Avoid re-creating Array<number> which is huge overhead.
    vector: Float32Array; 
    norm: number; // Precompute norm for faster cosine
    content: string;
    type: 'memory' | 'entity';
}

interface ClusterResult {
    id: number;
    label: string;
    items: string[];
    size: number;
}

// Optimized Cosine Distance
// If we precompute norms, we save 2x SQRTs per distance check.
// Distance = 1 - (dot / (normA * normB))
const cosineDistance = (a: Float32Array, normA: number, b: Float32Array, normB: number): number => {
    let dot = 0;
    // Unrolled loop for slight boost (or just trust V8)
    const len = a.length;
    for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
    }
    return 1.0 - (dot / (normA * normB));
};

// Compute Magnitute (Norm)
const computeNorm = (v: Float32Array): number => {
    let sum = 0;
    for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
    return Math.sqrt(sum);
};

// K-Means Implementation
export class MemoryClusterer {
    private db: Database;
    
    constructor(db: Database) {
        this.db = db;
    }

    async cluster(k: number = 5): Promise<ClusterResult[]> {
        console.error(`[Clusterer] Starting High-Perf Mixed K-Means with k=${k}...`);

        // 1. Fetch vectors
        
        // Memories
        let memoryRows: any[] = [];
        try {
            memoryRows = this.db.prepare(`
                SELECT m.id, m.content, v.embedding
                FROM vec_items v
                JOIN memories m ON v.rowid = m.rowid
            `).all();
        } catch (e) { console.warn("[Clusterer] Failed to fetch memories:", e); }

        // Entities
        let entityRows: any[] = [];
        try {
             entityRows = this.db.prepare(`
                SELECT e.id, e.name as content, v.embedding
                FROM vec_entities v
                JOIN entities e ON v.rowid = e.rowid
            `).all();
        } catch (e) {
             console.warn("[Clusterer] Failed to fetch entities:", e);
        }

        // Convert to optimized points
        const points: ClusterPoint[] = [];
        
        const processRow = (r: any, type: 'memory' | 'entity') => {
            const f32 = new Float32Array(r.embedding.buffer);
            points.push({
                id: r.id,
                content: r.content,
                vector: f32,
                norm: computeNorm(f32),
                type: type
            });
        };

        memoryRows.forEach(r => processRow(r, 'memory'));
        entityRows.forEach(r => processRow(r, 'entity'));

        if (points.length === 0) return [];
        if (points.length < k) k = points.length;

        const dim = points[0].vector.length;

        // 2. Initialize Centroids
        // We use Float32Array for centroids too
        let centroids: { vec: Float32Array, norm: number }[] = [];
        const indices = new Set<number>();
        while (indices.size < k) {
            indices.add(Math.floor(Math.random() * points.length));
        }
        
        indices.forEach(i => {
           // Clone vector to avoid linking by reference
           const vec = new Float32Array(points[i].vector);
           centroids.push({ vec, norm: points[i].norm });
        });

        let assignments: number[] = new Array(points.length).fill(-1);
        let iterations = 0;
        const maxIter = 15; // Increased iter slightly as it's faster
        let changed = true;

        // 3. Loop
        while (changed && iterations < maxIter) {
            changed = false;
            iterations++;

            // E-Step: Assign points to nearest centroid
            for (let i = 0; i < points.length; i++) {
                let minDist = Infinity;
                let clusterIdx = -1;
                
                const pVec = points[i].vector;
                const pNorm = points[i].norm;

                for (let c = 0; c < k; c++) {
                    const dist = cosineDistance(pVec, pNorm, centroids[c].vec, centroids[c].norm);
                    if (dist < minDist) {
                        minDist = dist;
                        clusterIdx = c;
                    }
                }
                if (assignments[i] !== clusterIdx) {
                    assignments[i] = clusterIdx;
                    changed = true;
                }
            }

            // M-Step: Update centroids
            for (let c = 0; c < k; c++) {
                // Find all points in this cluster
                // (Optimization: we could track indices in E-step to avoid filter)
                let count = 0;
                const newCentroid = new Float32Array(dim); // Init 0
                
                for(let i=0; i<points.length; i++) {
                    if (assignments[i] === c) {
                        const vec = points[i].vector;
                        for(let d=0; d<dim; d++) newCentroid[d] += vec[d];
                        count++;
                    }
                }

                if (count > 0) {
                    for(let d=0; d<dim; d++) newCentroid[d] /= count;
                    centroids[c] = { vec: newCentroid, norm: computeNorm(newCentroid) };
                }
            }
        }

        // 4. Generate Results
        const results: ClusterResult[] = [];
        const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';

        for (let c = 0; c < k; c++) {
            const clusterPoints = points.filter((_, i) => assignments[i] === c);
            if (clusterPoints.length === 0) continue;

            // Find representative (closest to centroid) to Label
            let minCenDist = Infinity;
            let centerPoint = clusterPoints[0];
            
            // Collect top 3 for labeling
            const sortedPoints = clusterPoints.map(p => ({
                ...p,
                dist: cosineDistance(p.vector, p.norm, centroids[c].vec, centroids[c].norm)
            })).sort((a, b) => a.dist - b.dist);
            
            centerPoint = sortedPoints[0];
            const examples = sortedPoints.slice(0, 3).map(p => p.content);

            let label = `Topic: ${centerPoint.content.substring(0, 20)}...`;

            // Try LLM Labeling
            if (process.env.ARCHIVIST_STRATEGY?.includes('llm')) {
                try {
                    const prompt = `
                        Generate a short 2-3 word TITLE for this cluster of memories.
                        Examples:
                        ${examples.map(e => `- ${e}`).join('\n')}
                        
                        Return JSON: { "title": "My Title" }
                    `;
                    const res = await fetch(ollamaUrl, {
                         method: 'POST',
                         headers: { 'Content-Type': 'application/json' },
                         body: JSON.stringify({
                             model: 'llama3', // Configurable?
                             prompt: prompt,
                             stream: false,
                             format: 'json'
                         })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        const json = JSON.parse(data.response);
                        if (json.title) label = json.title;
                    }
                } catch (e) {
                    console.error("LLM Labeling failed", e);
                }
            }

            results.push({
                id: c,
                label: label,
                items: examples,
                size: clusterPoints.length
            });
        }

        return results;
    }
}
