import { Database } from 'better-sqlite3';

export const handleReadGraph = (db: Database, args: any) => {
    const center = args?.center as string;
    const depth = (args?.depth as number) || 1;
    const returnJson = args?.json === true;

    let nodes = [];
    let edges = [];
    let relatedMemories = [];

    if (center) {
        // 1. Find Center Entity
        const centerEntity = db.prepare('SELECT * FROM entities WHERE name = ? OR id = ?').get(center, center) as any;
        
        if (!centerEntity) {
            return {
                content: [{ type: "text", text: `Entity "${center}" not found.` }],
                isError: true
            };
        }

        nodes.push(centerEntity);

        // 2. Find 1st Degree Connections
        const directEdges = db.prepare(`
            SELECT * FROM relations 
            WHERE source = ? OR target = ?
        `).all(centerEntity.name, centerEntity.name) as any[];

        edges.push(...directEdges);

        const connectedNames = new Set(directEdges.map(e => e.source === centerEntity.name ? e.target : e.source));
        
        // 3. Find connected Nodes
        if (connectedNames.size > 0) {
            const placeholders = Array.from(connectedNames).map(() => '?').join(',');
            const connectedNodes = db.prepare(`SELECT * FROM entities WHERE name IN (${placeholders})`).all(...Array.from(connectedNames)) as any[];
            nodes.push(...connectedNodes);
        }

        // 4. (Optional) Depth 2 (Friends of Friends)
        if (depth > 1 && connectedNames.size > 0) {
             const placeholders = Array.from(connectedNames).map(() => '?').join(',');
             const secondaryEdges = db.prepare(`
                SELECT * FROM relations 
                WHERE (source IN (${placeholders}) OR target IN (${placeholders}))
                AND source != ? AND target != ? -- Avoid loops back to center
             `).all(...Array.from(connectedNames), ...Array.from(connectedNames), centerEntity.name, centerEntity.name) as any[];

             // Filter edges to only include those where BOTH ends are interesting? 
             // Or at least one end is in our current set.
             // For simplicity, just add them and their nodes.
             edges.push(...secondaryEdges);
             
             const secondaryNames = new Set<string>();
             secondaryEdges.forEach(e => {
                 if (!connectedNames.has(e.source) && e.source !== centerEntity.name) secondaryNames.add(e.source);
                 if (!connectedNames.has(e.target) && e.target !== centerEntity.name) secondaryNames.add(e.target);
             });
             
             if (secondaryNames.size > 0) {
                 const ph2 = Array.from(secondaryNames).map(() => '?').join(',');
                 const secondaryNodes = db.prepare(`SELECT * FROM entities WHERE name IN (${ph2})`).all(...Array.from(secondaryNames)) as any[];
                 nodes.push(...secondaryNodes);
             }
        }
        
        // Fetch top 5 important memories related to center (simple FTS fallback)
        relatedMemories = db.prepare(`
            SELECT content, importance, tags 
            FROM memories 
            WHERE id IN (SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?) 
            ORDER BY importance DESC LIMIT 5
        `).all(`"${centerEntity.name}"`) as any[];

        if (relatedMemories.length === 0) {
             relatedMemories = db.prepare(`SELECT content, importance, tags FROM memories WHERE content LIKE ? ORDER BY importance DESC LIMIT 5`).all(`%${centerEntity.name}%`) as any[];
        }
        
    } else {
         nodes = db.prepare(`SELECT * FROM entities ORDER BY importance DESC LIMIT 50`).all() as any[];
         const names = nodes.map(n => n.name);
         if (names.length > 0) {
             const ph = names.map(() => '?').join(',');
             edges = db.prepare(`SELECT * FROM relations WHERE source IN (${ph}) AND target IN (${ph}) LIMIT 100`).all(...names, ...names) as any[];
         }
    }
    
    // Enrich nodes with observations from new table
    const nodeIds = nodes.map(n => n.id);
    if (nodeIds.length > 0) {
        const ph = nodeIds.map(() => '?').join(',');
        const allObs = db.prepare(`SELECT entity_id, content FROM entity_observations WHERE entity_id IN (${ph})`).all(...nodeIds) as any[];
        
        // Attach to nodes
        nodes.forEach(n => {
            const myObs = allObs.filter(o => o.entity_id === n.id).map(o => o.content);
            // Merge with legacy observations if present
            let legacyObs = [];
            try { legacyObs = JSON.parse(n.observations || '[]'); } catch (e) {}
            n.observations = [...new Set([...legacyObs, ...myObs])];
        });
    }

    if (returnJson) {
        return { content: [{ type: "text", text: JSON.stringify({ nodes, edges, relatedMemories }, null, 2) }] };
    }

    let output = center ? `Knowledge Graph for "${center}":\n` : `Knowledge Graph Overview:\n`;
    
    if (edges.length > 0) {
        output += "\n--- Relations ---\n";
        output += edges.map(e => `- ${e.source} --(${e.relation})--> ${e.target}`).join('\n');

        // Mermaid Graph
        output += "\n\n```mermaid\ngraph TD\n";
        
        // Helper to sanitize IDs
        const safeId = (name: string) => name.replace(/[^a-zA-Z0-9]/g, '_');
        const safeLabel = (name: string) => name.replace(/"/g, "'");

        // Nodes
        const relevantNodes = new Set<string>();
        edges.forEach(e => {
            relevantNodes.add(e.source);
            relevantNodes.add(e.target);
        });
        
        // Add styled nodes
        relevantNodes.forEach(nName => {
            const node = nodes.find(n => n.name === nName);
            const type = node?.type || 'Unknown';
            output += `  ${safeId(nName)}["${safeLabel(nName)} (${type})"]\n`;
        });

        // Edges
        output += edges.map(e => `  ${safeId(e.source)} -->|${safeLabel(e.relation)}| ${safeId(e.target)}`).join('\n');
        output += "\n```\n";

    } else {
        output += "\nNo relations found in this range.";
    }

    if (nodes.length > 1) {
        output += "\n\n--- Key Entities ---\n";
        output += nodes.map(n => `- ${n.name} (${n.type})${n.importance >= 0.8 ? " ⭐" : ""}`).join('\n');
    }

    if (relatedMemories.length > 0) {
        output += "\n\n--- Top Related Memories ---\n";
        output += relatedMemories.map(m => {
             const tags = JSON.parse(m.tags || '[]');
             return `- ${m.content}${tags.length > 0 ? ` [${tags.join(', ')}]` : ''}`;
        }).join('\n');
    }

    return { content: [{ type: "text", text: output }] };
};
