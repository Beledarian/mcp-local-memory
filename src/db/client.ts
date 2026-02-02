import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import path from 'path';

// Load the database file. If allowed, we should put it in a persistent location.
// For now, we'll use a file in the current directory or a user-specified path.
const DB_PATH = process.env.MEMORY_DB_PATH || path.join(process.cwd(), 'memory.db');

export function getDb() {
  const db = new Database(DB_PATH);
  
  // Load sqlite-vec extension
  try {
    sqliteVec.load(db);
  } catch (err) {
    console.warn("Failed to load sqlite-vec extension. Vector search will not be available.", err);
  }
  
  return db;
}
