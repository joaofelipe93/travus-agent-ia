import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";

mkdirSync("data", { recursive: true });

const db = new Database("data/conversations.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    jid     TEXT    NOT NULL,
    role    TEXT    NOT NULL,
    content TEXT    NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_messages_jid ON messages(jid, created_at);
`);

export function getHistory(jid) {
  return db
    .prepare("SELECT role, content FROM messages WHERE jid = ? ORDER BY created_at, id ASC")
    .all(jid);
}

export function addMessage(jid, role, content) {
  db.prepare("INSERT INTO messages (jid, role, content) VALUES (?, ?, ?)").run(jid, role, content);
}

export function clearHistory(jid) {
  db.prepare("DELETE FROM messages WHERE jid = ?").run(jid);
}
