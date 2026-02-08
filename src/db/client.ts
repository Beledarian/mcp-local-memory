import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import path from 'path';
import { fileURLToPath } from 'url';

import os from 'os';
import fs from 'fs-extra';

// Load the database file. If allowed, we should put it in a persistent location.
// Default to ~/.memory/memory.db
const DEFAULT_PATH = path.join(os.homedir(), '.memory', 'memory.db');
export const RESOLVED_DB_PATH = process.env.MEMORY_DB_PATH || DEFAULT_PATH;

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
  const dbPath = customPath || RESOLVED_DB_PATH;
  
  // Ensure directory exists
  try {
    fs.ensureDirSync(path.dirname(dbPath));
  } catch (e) {
    console.error(`Failed to create database directory at ${path.dirname(dbPath)}`, e);
  }

  const db = new Database(dbPath);
  
  // Register custom functions
  db.function('levenshtein', (a: any, b: any) => levenshtein(String(a), String(b)));
  // Load sqlite-vec extension
  try {
    sqliteVec.load(db);
  } catch (err) {
    console.error("Failed to load sqlite-vec extension. Vector search will not be available.", err);
  }
  
  return db;
}
