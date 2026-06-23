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

  CREATE TABLE IF NOT EXISTS meeting_reminders (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id      TEXT    NOT NULL,
    reminder_type TEXT    NOT NULL,
    sent_at       INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(event_id, reminder_type)
  );

  CREATE TABLE IF NOT EXISTS processed_messages (
    message_id   TEXT    PRIMARY KEY,
    processed_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_processed_at ON processed_messages(processed_at);

  CREATE TABLE IF NOT EXISTS boleto_clients (
    deal_id    TEXT    PRIMARY KEY,
    person_id  TEXT,
    cpf        TEXT,
    nome       TEXT,
    phone      TEXT,
    jid        TEXT,
    synced_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_boleto_clients_phone ON boleto_clients(phone);

  CREATE TABLE IF NOT EXISTS boletos_sent (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id         TEXT    NOT NULL,
    bill_id         TEXT    NOT NULL,
    parcel_number   TEXT,
    group_code      TEXT,
    cota_code       TEXT,
    transaction_id  TEXT,
    sent_at         INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(deal_id, bill_id)
  );

  CREATE TABLE IF NOT EXISTS boletos_emitidos (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id             TEXT    NOT NULL UNIQUE,
    person_id           TEXT,
    codigo_solicitacao  TEXT,
    seu_numero          TEXT,
    valor_nominal       REAL,
    data_vencimento     TEXT,
    linha_digitavel     TEXT,
    pix_copia_e_cola    TEXT,
    pdf_sent            INTEGER NOT NULL DEFAULT 0,
    error               TEXT,
    created_at          INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS boletos_contrato_parcelas (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id             TEXT    NOT NULL,
    parcela_n           INTEGER NOT NULL,
    total_parcelas      INTEGER NOT NULL,
    codigo_solicitacao  TEXT,
    seu_numero          TEXT,
    valor_nominal       REAL,
    data_vencimento     TEXT,
    linha_digitavel     TEXT,
    pix_copia_e_cola    TEXT,
    pdf_sent            INTEGER NOT NULL DEFAULT 0,
    error               TEXT,
    created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(deal_id, parcela_n)
  );
  CREATE INDEX IF NOT EXISTS idx_contrato_parcelas_deal ON boletos_contrato_parcelas(deal_id);

  CREATE TABLE IF NOT EXISTS webhook_dispatches (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id     TEXT    NOT NULL,
    stage_id      TEXT    NOT NULL,
    jid           TEXT    NOT NULL,
    phone         TEXT    NOT NULL,
    dispatched_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(person_id, stage_id)
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
ensureColumn("conversations", "disqualified", "TEXT");
ensureColumn("conversations", "bot_enabled", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("conversations", "call_answered_at", "INTEGER");
ensureColumn("conversations", "piperun_deal_id", "TEXT");
ensureColumn("conversations", "scheduled_at", "INTEGER");

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

const DEFAULT_HISTORY_LIMIT = 40;

export function getHistory(conversationId, limit = DEFAULT_HISTORY_LIMIT) {
  const rows = db
    .prepare(
      `SELECT role, content FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .all(conversationId, limit);
  return rows.reverse();
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
           c.last_user_message_at AS snapshot_at,
           (unixepoch() - c.last_user_message_at) AS elapsed
      FROM conversations c
      JOIN contacts ct ON ct.phone = c.phone
     WHERE c.status = 'active'
       AND c.disqualified IS NULL
       AND c.bot_enabled = 1
       AND c.call_answered_at IS NULL
       AND c.last_user_message_at IS NOT NULL
       AND c.followup_step < 3
       AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.conversation_id = c.id)
       AND (unixepoch() - c.last_user_message_at) >= 600
  `).all();

  const STEPS = [
    { step: 3, seconds: 24 * 60 * 60 },
    { step: 2, seconds: 5 * 60 * 60 },
    { step: 1, seconds: 10 * 60 },
  ];

  return rows.flatMap((r) => {
    for (const { step, seconds } of STEPS) {
      if (r.elapsed >= seconds && r.followup_step < step) {
        return [{
          conversation_id: r.conversation_id,
          jid: r.jid,
          step,
          snapshot_at: r.snapshot_at,
        }];
      }
    }
    return [];
  });
}

export function checkFollowUpStillNeeded(conversationId, step, snapshotAt = null) {
  const row = db.prepare(`
    SELECT c.followup_step, c.status, c.disqualified, c.call_answered_at, c.last_user_message_at,
           NOT EXISTS (SELECT 1 FROM leads WHERE conversation_id = c.id) AS no_lead
      FROM conversations c WHERE c.id = ?
  `).get(conversationId);
  if (!row) return false;
  if (snapshotAt !== null && row.last_user_message_at !== snapshotAt) return false;
  return row.status === "active"
    && !row.disqualified
    && !row.call_answered_at
    && !!row.no_lead
    && row.followup_step < step;
}

export function markFollowUpSent(conversationId, step) {
  db.prepare(
    "UPDATE conversations SET followup_step = ?, updated_at = unixepoch() WHERE id = ?"
  ).run(step, conversationId);
}

export function disableFollowUps(conversationId, reason) {
  db.prepare(
    "UPDATE conversations SET disqualified = ?, updated_at = unixepoch() WHERE id = ?"
  ).run(reason, conversationId);
}

export function isBotEnabled(conversationId) {
  const row = db.prepare("SELECT bot_enabled FROM conversations WHERE id = ?").get(conversationId);
  return !row || row.bot_enabled === 1;
}

export function disableBot(conversationId) {
  db.prepare(
    "UPDATE conversations SET bot_enabled = 0, updated_at = unixepoch() WHERE id = ?"
  ).run(conversationId);
}

export function markCallAnswered(jid) {
  const row = db.prepare(`
    SELECT c.id FROM conversations c
    JOIN contacts ct ON ct.phone = c.phone
    WHERE ct.jid = ? AND c.status = 'active'
    ORDER BY c.created_at DESC LIMIT 1
  `).get(jid);
  if (!row) return false;
  db.prepare(
    "UPDATE conversations SET call_answered_at = unixepoch(), updated_at = unixepoch() WHERE id = ?"
  ).run(row.id);
  return true;
}

export function getLeadAndJidByCelular(celular) {
  return db.prepare(`
    SELECT l.nome, l.celular, c.jid
      FROM leads l
      JOIN contacts c ON c.phone = l.phone
     WHERE l.celular = ?
     ORDER BY l.created_at DESC
     LIMIT 1
  `).get(celular);
}

export function hasReminderBeenSent(eventId, reminderType) {
  const row = db.prepare(
    "SELECT 1 FROM meeting_reminders WHERE event_id = ? AND reminder_type = ?"
  ).get(eventId, reminderType);
  return !!row;
}

export function hasAnyReminderSent(eventId) {
  const row = db.prepare(
    "SELECT 1 FROM meeting_reminders WHERE event_id = ? LIMIT 1"
  ).get(eventId);
  return !!row;
}

export function recordReminderSent(eventId, reminderType) {
  db.prepare(
    "INSERT OR IGNORE INTO meeting_reminders (event_id, reminder_type) VALUES (?, ?)"
  ).run(eventId, reminderType);
}

export function getReminderSentAt(eventId, reminderType) {
  const row = db.prepare(
    "SELECT sent_at FROM meeting_reminders WHERE event_id = ? AND reminder_type = ?"
  ).get(eventId, reminderType);
  return row?.sent_at ?? null;
}

export function hasUserMessageAfter(jid, timestampUnix) {
  const row = db.prepare(`
    SELECT 1
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      JOIN contacts ct ON ct.phone = c.phone
     WHERE ct.jid = ? AND m.role = 'user' AND m.created_at > ?
     LIMIT 1
  `).get(jid, timestampUnix);
  return !!row;
}

export function ensureContact(phone, jid) {
  db.prepare("INSERT OR IGNORE INTO contacts (phone, jid) VALUES (?, ?)").run(phone, jid);
}

export function hasWebhookDispatched(personId, stageId) {
  const row = db.prepare(
    "SELECT 1 FROM webhook_dispatches WHERE person_id = ? AND stage_id = ?"
  ).get(String(personId), String(stageId));
  return !!row;
}

export function recordWebhookDispatch(personId, stageId, jid, phone) {
  const result = db.prepare(
    "INSERT OR IGNORE INTO webhook_dispatches (person_id, stage_id, jid, phone) VALUES (?, ?, ?, ?)"
  ).run(String(personId), String(stageId), jid, phone);
  return result.changes > 0;
}

export function markConversationScheduled(conversationId) {
  db.prepare(
    "UPDATE conversations SET scheduled_at = unixepoch(), updated_at = unixepoch() WHERE id = ?"
  ).run(conversationId);
}

export function isConversationScheduled(conversationId) {
  const row = db.prepare("SELECT scheduled_at FROM conversations WHERE id = ?").get(conversationId);
  return !!row?.scheduled_at;
}

export function getLeadByConversation(conversationId) {
  return db.prepare(
    "SELECT nome, email, celular, data_agendamento, hora_agendamento FROM leads WHERE conversation_id = ?"
  ).get(conversationId);
}

export function setConversationDealId(conversationId, dealId) {
  db.prepare(
    "UPDATE conversations SET piperun_deal_id = ?, updated_at = unixepoch() WHERE id = ?"
  ).run(String(dealId), conversationId);
}

export function getConversationDealId(conversationId) {
  const row = db.prepare("SELECT piperun_deal_id FROM conversations WHERE id = ?").get(conversationId);
  return row?.piperun_deal_id ?? null;
}

export function upsertBoletoClient({ deal_id, person_id, cpf, nome, phone, jid }) {
  db.prepare(`
    INSERT INTO boleto_clients (deal_id, person_id, cpf, nome, phone, jid, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(deal_id) DO UPDATE SET
      person_id = excluded.person_id,
      cpf = excluded.cpf,
      nome = excluded.nome,
      phone = excluded.phone,
      jid = excluded.jid,
      synced_at = unixepoch()
  `).run(String(deal_id), person_id ? String(person_id) : null, cpf ?? null, nome ?? null, phone ?? null, jid ?? null);
}

export function listBoletoClients() {
  return db.prepare("SELECT * FROM boleto_clients ORDER BY synced_at DESC").all();
}

export function recordBoletoSent({ deal_id, bill_id, parcel_number, group_code, cota_code, transaction_id }) {
  const result = db.prepare(`
    INSERT OR IGNORE INTO boletos_sent (deal_id, bill_id, parcel_number, group_code, cota_code, transaction_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(String(deal_id), String(bill_id), parcel_number ?? null, group_code ?? null, cota_code ?? null, transaction_id ? String(transaction_id) : null);
  return result.changes > 0;
}

export function hasBoletoBeenSent(dealId, billId) {
  const row = db.prepare(
    "SELECT 1 FROM boletos_sent WHERE deal_id = ? AND bill_id = ?"
  ).get(String(dealId), String(billId));
  return !!row;
}

export function recordContratoParcela({
  deal_id,
  parcela_n,
  total_parcelas,
  codigo_solicitacao,
  seu_numero,
  valor_nominal,
  data_vencimento,
  linha_digitavel,
  pix_copia_e_cola,
}) {
  const result = db.prepare(`
    INSERT OR IGNORE INTO boletos_contrato_parcelas
      (deal_id, parcela_n, total_parcelas, codigo_solicitacao, seu_numero,
       valor_nominal, data_vencimento, linha_digitavel, pix_copia_e_cola)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(deal_id),
    Number(parcela_n),
    Number(total_parcelas),
    codigo_solicitacao ?? null,
    seu_numero ?? null,
    valor_nominal ?? null,
    data_vencimento ?? null,
    linha_digitavel ?? null,
    pix_copia_e_cola ?? null
  );
  return result.changes > 0;
}

export function markContratoParcelaPdfSent(dealId, parcelaN) {
  db.prepare(
    "UPDATE boletos_contrato_parcelas SET pdf_sent = 1 WHERE deal_id = ? AND parcela_n = ?"
  ).run(String(dealId), Number(parcelaN));
}

export function countContratoParcelas(dealId) {
  const row = db.prepare(
    "SELECT COUNT(*) AS n FROM boletos_contrato_parcelas WHERE deal_id = ?"
  ).get(String(dealId));
  return row?.n ?? 0;
}

export function getContratoParcelas(dealId) {
  return db.prepare(
    "SELECT * FROM boletos_contrato_parcelas WHERE deal_id = ? ORDER BY parcela_n ASC"
  ).all(String(dealId));
}

export function recordBoletoEmitido({
  deal_id,
  person_id,
  codigo_solicitacao,
  seu_numero,
  valor_nominal,
  data_vencimento,
  linha_digitavel,
  pix_copia_e_cola,
}) {
  const result = db.prepare(`
    INSERT OR IGNORE INTO boletos_emitidos
      (deal_id, person_id, codigo_solicitacao, seu_numero, valor_nominal,
       data_vencimento, linha_digitavel, pix_copia_e_cola)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(deal_id),
    person_id ? String(person_id) : null,
    codigo_solicitacao ?? null,
    seu_numero ?? null,
    valor_nominal ?? null,
    data_vencimento ?? null,
    linha_digitavel ?? null,
    pix_copia_e_cola ?? null
  );
  return result.changes > 0;
}

export function markBoletoEmitidoPdfSent(dealId) {
  db.prepare(
    "UPDATE boletos_emitidos SET pdf_sent = 1 WHERE deal_id = ?"
  ).run(String(dealId));
}

export function recordBoletoEmitidoError(dealId, error) {
  db.prepare(`
    INSERT INTO boletos_emitidos (deal_id, error)
    VALUES (?, ?)
    ON CONFLICT(deal_id) DO UPDATE SET error = excluded.error
  `).run(String(dealId), String(error ?? "").slice(0, 500));
}

export function hasBoletoEmitido(dealId) {
  const row = db.prepare(
    "SELECT 1 FROM boletos_emitidos WHERE deal_id = ? AND pdf_sent = 1"
  ).get(String(dealId));
  return !!row;
}

export function markMessageProcessed(messageId) {
  const result = db.prepare(
    "INSERT OR IGNORE INTO processed_messages (message_id) VALUES (?)"
  ).run(messageId);
  return result.changes > 0;
}

export function pruneProcessedMessages(olderThanSeconds = 7 * 24 * 60 * 60) {
  db.prepare(
    "DELETE FROM processed_messages WHERE processed_at < unixepoch() - ?"
  ).run(olderThanSeconds);
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
