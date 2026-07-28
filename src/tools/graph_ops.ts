
import { Database } from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

export async function handleCreateEntity(db: Database, args: any, embedder?: any) {
    const name = args?.name as string;
    const type = args?.type as string;
    const observations = (args?.observations as string[]) || [];

    // Check for existing entity via fuzzy match (Levenshtein <= 2)
    let existing = db.prepare(`SELECT id, name FROM entities WHERE levenshtein(name, ?) <= 2 LIMIT 1`).get(name) as any;
    
    let entityId = existing?.id;
    let message = "";

    if (existing) {
         db.prepare(
             "UPDATE entities SET auto_generated = 0 WHERE id = ?",
         ).run(existing.id);
         message = `Entity '${name}' already exists (as '${existing.name}').`;
         if (observations.length > 0) {
             const insertObs = db.prepare("INSERT INTO entity_observations (entity_id, content) VALUES (?, ?)");
             const transaction = db.transaction((obsList) => {
                 for (const obs of obsList) insertObs.run(existing.id, obs);
             });
             transaction(observations);
             message += ` Appended ${observations.length} new observations.`;
         }
    } else {
         entityId = uuidv4();
         db.prepare(`INSERT INTO entities (id, name, type, observations) VALUES (?, ?, ?, ?)`).run(entityId, name, type, "[]");
         
         if (observations.length > 0) {
             const insertObs = db.prepare("INSERT INTO entity_observations (entity_id, content) VALUES (?, ?)");
             const transaction = db.transaction((obsList) => {
                 for (const obs of obsList) insertObs.run(entityId, obs);
             });
             transaction(observations);
         }
         
         // Generate Entity Embedding
         if (embedder) {
            try {
               const vec = await embedder.embed(name + " " + type);
               const float32 = new Float32Array(vec);
               db.prepare(`
                   INSERT INTO vec_entities (rowid, embedding)
                   SELECT rowid, ? FROM entities WHERE id = ?
               `).run(Buffer.from(float32.buffer), entityId);
            } catch (e) {
               console.warn("Entity embedding insert failed:", e);
            }
         }

         message = `Created entity '${name}' of type '${type}'.`;
    }

    return {
        content: [{ type: "text", text: message }]
    };
}

export function handleCreateRelation(db: Database, args: any) {
    const source = args?.source as string;
    const target = args?.target as string;
    const relation = args?.relation as string;

    const createRelation = db.transaction(() => {
        const ensureManualEntity = (name: string) => {
            const existing = db.prepare(
                "SELECT id FROM entities WHERE name = ?",
            ).get(name) as { id: string } | undefined;
            if (existing) {
                db.prepare(
                    "UPDATE entities SET auto_generated = 0 WHERE id = ?",
                ).run(existing.id);
                return;
            }
            const id = uuidv4();
            db.prepare(`
                INSERT INTO entities(
                    id, name, type, observations, auto_generated
                ) VALUES (?, ?, 'Unknown', '[]', 0)
            `).run(id, name);
        };

        ensureManualEntity(source);
        ensureManualEntity(target);

        const existingRelation = db.prepare(`
            SELECT 1 FROM relations
            WHERE source = ? AND target = ? AND relation = ?
        `).get(source, target, relation);
        if (existingRelation) {
            db.prepare(`
                UPDATE relations
                SET auto_generated = 0
                WHERE source = ? AND target = ? AND relation = ?
            `).run(source, target, relation);
            return false;
        }
        db.prepare(`
            INSERT INTO relations(
                source, target, relation, auto_generated
            ) VALUES (?, ?, ?, 0)
        `).run(source, target, relation);
        return true;
    });

    const created = createRelation.immediate();
    return {
        content: [{
            type: "text",
            text: created
                ? `Created relation: ${source} --[${relation}]--> ${target}`
                : "Relation already exists and is now manually maintained.",
        }],
    };
}

export function handleDeleteRelation(db: Database, args: any) {
    const source = args?.source as string;
    const target = args?.target as string;
    const relation = args?.relation as string;

    const res = db.prepare("DELETE FROM relations WHERE source = ? AND target = ? AND relation = ?").run(source, target, relation);
    
    if (res.changes === 0) {
        return { content: [{ type: "text", text: `Relation not found: ${source} --[${relation}]--> ${target}` }], isError: true };
    }
    
    return {
        content: [{ type: "text", text: `Deleted relation: ${source} --[${relation}]--> ${target}` }]
    };
}

export function handleDeleteEntity(db: Database, args: any) {
    const name = args?.name as string;
    
    const entity = db.prepare("SELECT id FROM entities WHERE name = ?").get(name) as any;
    if (!entity) {
         return { content: [{ type: "text", text: `Entity '${name}' not found.` }], isError: true };
    }
    
    const tx = db.transaction(() => {
        // 1. Delete observations
        db.prepare("DELETE FROM entity_observations WHERE entity_id = ?").run(entity.id);
        // 2. Delete relations
        db.prepare("DELETE FROM relations WHERE source = ? OR target = ?").run(name, name);
        // 3. Delete vector embedding
        const rowid = db.prepare("SELECT rowid FROM entities WHERE id = ?").get(entity.id) as any;
        if (rowid) {
             db.prepare("DELETE FROM vec_entities WHERE rowid = ?").run(rowid.rowid);
        }
        // 4. Delete entity
        db.prepare("DELETE FROM entities WHERE id = ?").run(entity.id);
    });
    tx();
    
    return {
        content: [{ type: "text", text: `Deleted entity '${name}' and all associated data.` }]
    };
}

export async function handleUpdateEntity(db: Database, args: any, embedder?: any) {
    const currentName = args?.current_name as string;
    const newName = args?.new_name as string | undefined;
    const newType = args?.new_type as string | undefined;
    
    const entity = db.prepare("SELECT id, name, type FROM entities WHERE name = ?").get(currentName) as any;
    if (!entity) {
         return { content: [{ type: "text", text: `Entity '${currentName}' not found.` }], isError: true };
    }
    
    const updates: string[] = [];
    const params: (string | undefined)[] = [];
    
    if (newName && newName !== currentName) {
        updates.push("name = ?");
        params.push(newName);
    }
    if (newType && newType !== entity.type) {
        updates.push("type = ?");
        params.push(newType);
    }
    
    if (updates.length > 0) {
        const tx = db.transaction(() => {
            db.prepare(`UPDATE entities SET ${updates.join(", ")} WHERE id = ?`).run(...params, entity.id);
            
            if (newName && newName !== currentName) {
                db.prepare("UPDATE relations SET source = ? WHERE source = ?").run(newName, currentName);
                db.prepare("UPDATE relations SET target = ? WHERE target = ?").run(newName, currentName);
            }
        });
        tx();

        if (embedder && ((newName && newName !== currentName) || (newType && newType !== entity.type))) {
            const finalName = newName || currentName;
            const finalType = newType || entity.type;
            try {
                const vec = await embedder.embed(finalName + " " + finalType);
                const float32 = new Float32Array(vec);
                const rowid = db.prepare("SELECT rowid FROM entities WHERE id = ?").get(entity.id) as any;
                if (rowid) {
                    db.prepare("DELETE FROM vec_entities WHERE rowid = ?").run(rowid.rowid);
                    db.prepare("INSERT INTO vec_entities (rowid, embedding) VALUES (?, ?)").run(rowid.rowid, Buffer.from(float32.buffer));
                }
            } catch(e) {
                console.error("Re-embedding failed", e);
            }
        }
        
        return {
            content: [{ type: "text", text: `Updated entity '${currentName}'` }]
        };
    } else {
        return { content: [{ type: "text", text: "No changes requested." }] };
    }
}

export function handleDeleteObservation(db: Database, args: any) {
    const entityName = args?.entity_name as string;
    const content = (args?.observations as string[]) || []; 
    
    const entity = db.prepare("SELECT id FROM entities WHERE name = ?").get(entityName) as any;
    if (!entity) {
         return { content: [{ type: "text", text: `Entity '${entityName}' not found.` }], isError: true };
    }
    
    let deletedCount = 0;
    const delStmt = db.prepare("DELETE FROM entity_observations WHERE entity_id = ? AND content = ?");
    
    const transaction = db.transaction((items) => {
        for (const obs of items) {
            const res = delStmt.run(entity.id, obs);
            deletedCount += res.changes;
        }
    });
    transaction(content);

    return {
        content: [{ type: "text", text: `Deleted ${deletedCount} observations from '${entityName}'.` }]
    };
}
