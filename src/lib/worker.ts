import { parentPort, workerData } from 'worker_threads';
import { getDb } from '../db/client.js';
import { getArchivist } from './archivist.js';
import { getEmbedder } from './embeddings.js';

// Prevent recursion if getArchivist checks this env var
process.env.USE_WORKER = 'false'; 

// Use the database path passed from the main thread
const db = getDb(workerData?.dbPath);
const embedder = getEmbedder();
const archivist = getArchivist(db, async (text) => {
    return Array.from(await embedder.embed(text));
});

if (parentPort) {
    parentPort.on('message', async (task: {
        taskId: string;
        text: string;
        memoryId?: string;
    }) => {
        try {
            await archivist.process(task.text, task.memoryId);
            parentPort?.postMessage({ taskId: task.taskId });
        } catch (err: any) {
            console.error("[Worker] Error:", err);
            parentPort?.postMessage({
                taskId: task.taskId,
                error: err?.message ?? String(err),
            });
        }
    });
}
