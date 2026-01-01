import type { Db, Row } from "./db.ts";

// Pages start at 1.
export async function listUsers(db: Db, page: number, size: number): Promise<Row[]> {
  const offset = page * size;

  return db.query("SELECT id, name FROM users ORDER BY id LIMIT ? OFFSET ?", [size, offset]);
}
