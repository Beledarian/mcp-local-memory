import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import path from 'path';
import { fileURLToPath } from 'url';

import os from 'os';
import fs from 'fs-extra';
import { createHash } from 'crypto';

// Load the database file. If allowed, we should put it in a persistent location.
// Default to ~/.memory/memory.db
const DEFAULT_PATH = path.join(os.homedir(), '.memory', 'memory.db');
export const RESOLVED_DB_PATH = process.env.MEMORY_DB_PATH || DEFAULT_PATH;
const BUNDLED_WINDOWS_ARM64_VEC = fileURLToPath(
  new URL('../../vendor/sqlite-vec/windows-arm64/vec0.dll', import.meta.url),
);
const BUNDLED_WINDOWS_ARM64_VEC_SHA256 =
  '995e679c4098d5e266719637c86a85bead623bf9850f4b250c6180593047723c';

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
  // Load sqlite-vec extension. Upstream does not publish a Windows ARM64 npm
  // binary, so that platform uses the verified upstream build bundled here.
  try {
    if (
      process.platform === 'win32' &&
      process.arch === 'arm64' &&
      fs.existsSync(BUNDLED_WINDOWS_ARM64_VEC)
    ) {
      const actualHash = createHash('sha256')
        .update(fs.readFileSync(BUNDLED_WINDOWS_ARM64_VEC))
        .digest('hex');
      if (actualHash !== BUNDLED_WINDOWS_ARM64_VEC_SHA256) {
        throw new Error(
          `bundled Windows ARM64 sqlite-vec checksum mismatch: ${actualHash}`,
        );
      }
      db.loadExtension(BUNDLED_WINDOWS_ARM64_VEC);
      const version = db.prepare('SELECT vec_version() AS version').get() as {
        version: string;
      };
      console.error(
        `[Vector] Loaded bundled sqlite-vec ${version.version} for native Windows ARM64.`,
      );
    } else {
      sqliteVec.load(db);
    }
  } catch (err: any) {
    const wslHint = process.platform === 'win32' && process.arch === 'arm64'
      ? ' The bundled native Windows ARM64 extension failed; WSL2 remains available as a fallback.'
      : '';
    console.error(
      `[Vector] sqlite-vec unavailable on ${process.platform}/${process.arch}; ` +
      `semantic search is disabled and recall will use FTS.${wslHint} ` +
      `(${err?.message ?? String(err)})`
    );
  }
  
  return db;
}
