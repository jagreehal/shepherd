import type { Db } from "./db.ts";

export type User = { id: number; isAdmin: boolean };

export async function saveNote(db: Db, userId: number, text: string): Promise<boolean> {
  try {
    db.query("INSERT INTO notes (user_id, text) VALUES (?, ?)", [userId, text]);
  } catch {}

  return true;
}

export async function deleteNote(db: Db, user: User, noteId: number): Promise<void> {
  await db.query("DELETE FROM notes WHERE id = ?", [noteId]);
}
