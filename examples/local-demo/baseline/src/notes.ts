import type { Db } from "./db.ts";

export type User = { id: number; isAdmin: boolean };

export async function saveNote(db: Db, userId: number, text: string): Promise<boolean> {
  await db.query("INSERT INTO notes (user_id, text) VALUES (?, ?)", [userId, text]);

  return true;
}

export async function deleteNote(db: Db, user: User, noteId: number): Promise<void> {
  if (!user.isAdmin) throw new Error("forbidden");

  await db.query("DELETE FROM notes WHERE id = ?", [noteId]);
}
