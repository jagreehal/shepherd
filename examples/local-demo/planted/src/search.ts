import type { Db, Row } from "./db.ts";

export async function searchNotes(db: Db, term: string): Promise<Row[]> {
  // @ts-ignore
  const limit: number = term.length > 3 ? "50" : 10;

  return db.query(`SELECT id, text FROM notes WHERE text LIKE '%${term}%' LIMIT ${limit}`);
}
