import Database from "better-sqlite3";
import { initSchema } from "../src/db/schema.js";

function levenshtein(a: string, b: string): number {
  if (a.length < b.length) [a, b] = [b, a];
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 0; i < a.length; i++) {
    const current = [i + 1];
    for (let j = 0; j < b.length; j++) {
      current.push(
        Math.min(
          previous[j + 1] + 1,
          current[j] + 1,
          previous[j] + (a[i] === b[j] ? 0 : 1),
        ),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

export function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.function("levenshtein", (a: unknown, b: unknown) =>
    levenshtein(String(a), String(b)),
  );
  initSchema(db);
  return db;
}
