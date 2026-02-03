import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import path from 'path';
import { fileURLToPath } from 'url';

// Load the database file. If allowed, we should put it in a persistent location.
// For now, we'll use a file in the current directory or a user-specified path.
const DB_PATH = process.env.MEMORY_DB_PATH || path.join(process.cwd(), 'memory.db');

export function getDb(customPath?: string) {
  const dbPath = customPath || DB_PATH;
  const db = new Database(dbPath);
  
  
  // Load sqlite-vec extension
  try {
    // Windows ARM64 workaround: manually load x64 DLL via Prism emulation
    if (process.platform === 'win32' && process.arch === 'arm64') {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const vecPath = path.join(__dirname, '../../node_modules/sqlite-vec-windows-x64/vec0.dll');
      db.loadExtension(vecPath);
    } else {
      sqliteVec.load(db);
    }
  } catch (err) {
    console.warn("Failed to load sqlite-vec extension. Vector search will not be available.", err);
  }
  
  return db;
}
