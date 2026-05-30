import Database from "better-sqlite3";
import { mkdirSync, readdirSync, statSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";

const SOURCE = process.env.DB_PATH ?? "data/conversations.db";
const BACKUP_DIR = process.env.DB_BACKUP_DIR ?? "data/backups";
const KEEP_DAYS = Number(process.env.DB_BACKUP_KEEP_DAYS ?? 7);

mkdirSync(BACKUP_DIR, { recursive: true });

const now = new Date();
const stamp = now.toISOString().replace(/[:T]/g, "-").slice(0, 19);
const dest = resolve(BACKUP_DIR, `conversations-${stamp}.db`);

const db = new Database(SOURCE, { readonly: true, fileMustExist: true });
await db.backup(dest);
db.close();

const sizeBytes = statSync(dest).size;
const sizeKb = (sizeBytes / 1024).toFixed(1);
console.log(`[BACKUP] ${dest} (${sizeKb} KB)`);

const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
let removidos = 0;
for (const name of readdirSync(BACKUP_DIR)) {
  if (!name.startsWith("conversations-") || !name.endsWith(".db")) continue;
  const path = join(BACKUP_DIR, name);
  const mtime = statSync(path).mtimeMs;
  if (mtime < cutoff) {
    rmSync(path);
    removidos++;
  }
}
if (removidos > 0) console.log(`[BACKUP] limpeza: ${removidos} backups antigos removidos (>${KEEP_DAYS}d)`);
