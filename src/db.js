import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";

const DB_PATH = process.env.DB_PATH ?? "data/conversations.db";

if (DB_PATH !== ":memory:") mkdirSync("data", { recursive: true });

const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    phone      TEXT    PRIMARY KEY,
    jid        TEXT    NOT NULL UNIQUE,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    phone                TEXT    NOT NULL REFERENCES contacts(phone),
    status               TEXT    NOT NULL DEFAULT 'active',
    last_user_message_at INTEGER,
    followup_step        INTEGER NOT NULL DEFAULT 0,
    created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at           INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_conv_phone_status ON conversations(phone, status);

  CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id),
    role            TEXT    NOT NULL,
    content         TEXT    NOT NULL,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);

  CREATE TABLE IF NOT EXISTS leads (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id  INTEGER NOT NULL UNIQUE REFERENCES conversations(id),
    phone            TEXT    NOT NULL REFERENCES contacts(phone),
    nome             TEXT,
    email            TEXT,
    celular          TEXT,
    renda_mensal     TEXT,
    data_agendamento TEXT,
    hora_agendamento TEXT,
    piperun_sent_at  INTEGER,
    created_at       INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("conversations", "last_user_message_at", "INTEGER");
ensureColumn("conversations", "followup_step", "INTEGER NOT NULL DEFAULT 0");

export function phoneFromJid(jid) {
  return jid.split("@")[0];
}

export function getOrStartConversation(jid) {
  const phone = phoneFromJid(jid);

  db.prepare("INSERT OR IGNORE INTO contacts (phone, jid) VALUES (?, ?)").run(phone, jid);

  const existing = db
    .prepare("SELECT id FROM conversations WHERE phone = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1")
    .get(phone);

  if (existing) return existing.id;

  return db.prepare("INSERT INTO conversations (phone) VALUES (?)").run(phone).lastInsertRowid;
}

export function getHistory(conversationId) {
  return db
    .prepare("SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at, id ASC")
    .all(conversationId);
}

export function addMessage(conversationId, role, content) {
  db.prepare("INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)").run(conversationId, role, content);
  if (role === "user") {
    db.prepare(
      "UPDATE conversations SET last_user_message_at = unixepoch(), followup_step = 0, updated_at = unixepoch() WHERE id = ?"
    ).run(conversationId);
  } else {
    db.prepare("UPDATE conversations SET updated_at = unixepoch() WHERE id = ?").run(conversationId);
  }
}

export function getConversationsNeedingFollowUp() {
  const rows = db.prepare(`
    SELECT c.id AS conversation_id, ct.jid, c.followup_step,
           (unixepoch() - c.last_user_message_at) AS elapsed
      FROM conversations c
      JOIN contacts ct ON ct.phone = c.phone
     WHERE c.status = 'active'
       AND c.last_user_message_at IS NOT NULL
       AND c.followup_step < 5
       AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.conversation_id = c.id)
       AND (unixepoch() - c.last_user_message_at) >= 600
  `).all();

  const STEPS = [
    { step: 5, seconds: 24 * 60 * 60 },
    { step: 4, seconds: 4 * 60 * 60 },
    { step: 3, seconds: 2 * 60 * 60 },
    { step: 2, seconds: 30 * 60 },
    { step: 1, seconds: 10 * 60 },
  ];

  return rows.flatMap((r) => {
    for (const { step, seconds } of STEPS) {
      if (r.elapsed >= seconds && r.followup_step < step) {
        return [{ conversation_id: r.conversation_id, jid: r.jid, step }];
      }
    }
    return [];
  });
}

export function checkFollowUpStillNeeded(conversationId, step) {
  const row = db.prepare(`
    SELECT c.followup_step, c.status,
           NOT EXISTS (SELECT 1 FROM leads WHERE conversation_id = c.id) AS no_lead
      FROM conversations c WHERE c.id = ?
  `).get(conversationId);
  return !!row && row.status === "active" && !!row.no_lead && row.followup_step < step;
}

export function markFollowUpSent(conversationId, step) {
  db.prepare(
    "UPDATE conversations SET followup_step = ?, updated_at = unixepoch() WHERE id = ?"
  ).run(step, conversationId);
}

export function recordLeadCapture(conversationId, leadData) {
  const { phone } = db.prepare("SELECT phone FROM conversations WHERE id = ?").get(conversationId);

  db.prepare(`
    INSERT OR IGNORE INTO leads (conversation_id, phone, nome, email, celular, renda_mensal, data_agendamento, hora_agendamento, piperun_sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
  `).run(
    conversationId, phone,
    leadData.nome ?? null, leadData.email ?? null, leadData.celular ?? null,
    leadData.renda_mensal ?? null, leadData.data_agendamento ?? null, leadData.hora_agendamento ?? null,
  );

  db.prepare("UPDATE conversations SET updated_at = unixepoch() WHERE id = ?").run(conversationId);
}
