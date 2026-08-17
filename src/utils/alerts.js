import { getSock } from "../api/index.js";
import { recordSystemEvent } from "../db.js";

const DEDUPE_WINDOW_MS = Number(process.env.ALERT_DEDUPE_WINDOW_MS ?? 60 * 60 * 1000);

const lastSentByKey = new Map();

function jidFromConsultor(phone) {
  const digits = String(phone).replace(/\D/g, "");
  if (!digits) return null;
  return `${digits}@s.whatsapp.net`;
}

function shouldSend(dedupeKey) {
  if (!dedupeKey) return true;
  const last = lastSentByKey.get(dedupeKey);
  const now = Date.now();
  if (last && now - last < DEDUPE_WINDOW_MS) return false;
  lastSentByKey.set(dedupeKey, now);
  return true;
}

export async function alertConsultor(message, { dedupeKey, sock, source } = {}) {
  // registra SEMPRE — mesmo se dedupado, dashboard mostra que aconteceu
  try {
    recordSystemEvent("error", source ?? dedupeKey ?? "alert", message, dedupeKey ? { dedupeKey } : undefined);
  } catch (err) {
    console.error(`[ALERT] falha ao registrar system_event: ${err?.message ?? err}`);
  }

  const rawPhone = process.env.CONSULTOR_WHATSAPP;
  if (!rawPhone) {
    console.warn("[ALERT] CONSULTOR_WHATSAPP não configurado — alerta suprimido:", message);
    return { sent: false, reason: "no_consultor_env" };
  }

  if (!shouldSend(dedupeKey)) {
    return { sent: false, reason: "deduped", dedupeKey };
  }

  const socket = sock ?? getSock();
  if (!socket) {
    console.warn("[ALERT] WhatsApp não conectado — alerta suprimido:", message);
    return { sent: false, reason: "no_sock" };
  }

  const jid = jidFromConsultor(rawPhone);
  if (!jid) {
    console.warn("[ALERT] CONSULTOR_WHATSAPP inválido:", rawPhone);
    return { sent: false, reason: "invalid_phone" };
  }

  try {
    await socket.sendMessage(jid, { text: message });
    console.log(`[ALERT] enviado pro consultor${dedupeKey ? ` (key=${dedupeKey})` : ""}`);
    return { sent: true };
  } catch (err) {
    console.error(`[ALERT] falha ao enviar: ${err?.message ?? err}`);
    if (dedupeKey) lastSentByKey.delete(dedupeKey);
    return { sent: false, reason: "send_error", error: err };
  }
}

export function resetAlertDedupe() {
  lastSentByKey.clear();
}

export function _peekDedupeState() {
  return new Map(lastSentByKey);
}
