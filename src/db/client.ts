import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import path from 'path';
import { fileURLToPath } from 'url';

// Load the database file. If allowed, we should put it in a persistent location.
// For now, we'll use a file in the current directory or a user-specified path.
const DB_PATH = process.env.MEMORY_DB_PATH || path.join(process.cwd(), 'memory.db');

function levenshtein(a: string, b: string): number {
  if (a.length < b.length) [a, b] = [b, a];
  if (b.length === 0) return a.length;
  
  let prevRow = Array.from({ length: b.length + 1 }, (_, i) => i);
  
  for (let i = 0; i < a.length; i++) {
    const currRow = [i + 1];
    for (let j = 0; j < b.length; j++) {
      const insertions = prevRow[j + 1] + 1;
      const deletions = currRow[j] + 1;
      const substitutions = prevRow[j] + (a[i] === b[j] ? 0 : 1);
      currRow.push(Math.min(insertions, deletions, substitutions));
    }
    prevRow = currRow;
  }
  return prevRow[b.length];
}

export function getDb(customPath?: string) {
  const dbPath = customPath || DB_PATH;
  const db = new Database(dbPath);
  
  // Register custom functions
  db.function('levenshtein', (a: any, b: any) => levenshtein(String(a), String(b)));
  // Load sqlite-vec extension
  try {
    sqliteVec.load(db);
  } catch (err) {
    console.warn("Failed to load sqlite-vec extension. Vector search will not be available.", err);
  }
  
  return db;
}
