import { askAgent } from "./agent.js";
import {
  getOrStartConversation,
  getHistory,
  addMessage,
  recordLeadCapture,
  phoneFromJid,
  disableFollowUps,
  isBotEnabled,
  disableBot,
} from "./db.js";
import { enviarLeadPipeRun } from "./integrations/piperun.js";
import { createCalendarEvent } from "./integrations/calendar.js";
import { sendWithPresence } from "./whatsapp/presence.js";
import { withContext } from "./logger.js";
import {
  leadsCapturedTotal,
  leadsRejectedTotal,
  messagesOutTotal,
} from "./metrics.js";

const LEAD_FIELDS = ["nome", "email", "celular", "renda_mensal", "data_agendamento", "hora_agendamento"];
const SYSTEM_PREFIX_REGEX = /\[Número do WhatsApp do lead:[^\]]*\]\s*/g;
const NEW_LEAD_TRIGGER = /formul[áa]rio|garantir uma renda fixa investindo em im[óo]ve/i;

function processAgentResponse(text) {
  text = text.replace(SYSTEM_PREFIX_REGEX, "");

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return { cleanText: text, lead: null, closeReason: null };

  let data;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { cleanText: text, lead: null, closeReason: null };
  }

  const hasLeadField = LEAD_FIELDS.some((f) => f in data);
  const hasCloseField = typeof data.encerrar === "string" && data.encerrar.length > 0;
  if (!hasLeadField && !hasCloseField) return { cleanText: text, lead: null, closeReason: null };

  const cleanText = (text.slice(0, start) + text.slice(end + 1)).trim();
  const complete = data.nome && data.email && data.celular;
  return {
    cleanText: cleanText || null,
    lead: complete ? data : null,
    closeReason: hasCloseField ? data.encerrar : null,
  };
}

const PLACEHOLDER_PHONES = new Set(["5511999999999", "5511991234567"]);

function normalizeCelular(input) {
  const d = String(input ?? "").replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) return d;
  if (d.length === 11) return "55" + d;
  if (d.length === 10) return "55" + d.slice(0, 2) + "9" + d.slice(2);
  return d;
}

function isPlaceholderPhone(celular) {
  const d = String(celular ?? "").replace(/\D/g, "");
  return PLACEHOLDER_PHONES.has(d);
}

function extractCelularFromHistory(convId) {
  const messages = getHistory(convId);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const digits = m.content.replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 13) return normalizeCelular(digits);
  }
  return null;
}

function resolveLeadCelular(lead, convId, jid) {
  if (jid?.endsWith("@s.whatsapp.net")) return phoneFromJid(jid);
  const fromHistory = extractCelularFromHistory(convId);
  if (fromHistory && !isPlaceholderPhone(fromHistory)) return fromHistory;
  const normalized = normalizeCelular(lead.celular);
  if (isPlaceholderPhone(normalized)) return null;
  if (normalized.length < 12 || normalized.length > 13) return null;
  return normalized;
}

function buildAgentInput(text, jid) {
  if (!jid?.endsWith("@s.whatsapp.net")) return text;
  const phone = phoneFromJid(jid);
  return `[Número do WhatsApp do lead: ${phone}]\n\n${text}`;
}

export async function handleMessage(from, text, sock) {
  const convId = getOrStartConversation(from);
  const log = withContext({ jid: from, conv_id: convId });
  const history = getHistory(convId);

  if (history.length === 0 && !NEW_LEAD_TRIGGER.test(text)) {
    addMessage(convId, "user", text);
    disableBot(convId);
    log.info({ event: "bot.silenced", reason: "old_lead_no_trigger" });
    return;
  }

  addMessage(convId, "user", text);

  if (!isBotEnabled(convId)) {
    log.debug({ event: "bot.message_ignored", reason: "manual_mode", preview: text.slice(0, 50) });
    return;
  }

  const resposta = await askAgent(history, buildAgentInput(text, from));
  addMessage(convId, "assistant", resposta);

  const { cleanText, lead, closeReason } = processAgentResponse(resposta);

  let resolvedCelular = null;
  if (lead) {
    resolvedCelular = resolveLeadCelular(lead, convId, from);
    if (!resolvedCelular) {
      leadsRejectedTotal.inc({ reason: "invalid_phone" });
      log.warn({ event: "lead.rejected", reason: "invalid_phone", agent_celular: lead.celular });
      const recovery = "Antes de finalizar, qual o melhor número pra eu te ligar? 😊";
      await sendWithPresence(sock, from, recovery);
      messagesOutTotal.inc({ kind: "recovery" });
      addMessage(convId, "assistant", recovery);
      log.info({ event: "lead.recovery_sent" });
      return;
    }
    if (resolvedCelular !== lead.celular) {
      log.info({ event: "lead.celular_corrected", agent_celular: lead.celular, resolved: resolvedCelular });
      lead.celular = resolvedCelular;
    }
  }

  if (cleanText) {
    await sendWithPresence(sock, from, cleanText);
    messagesOutTotal.inc({ kind: "agent" });
    log.info({ event: "agent.reply_sent", preview: cleanText.slice(0, 80) });
  }

  if (closeReason) {
    disableFollowUps(convId, closeReason);
    log.info({ event: "conversation.followups_disabled", reason: closeReason });
  }

  if (lead) {
    try {
      recordLeadCapture(convId, lead);
      leadsCapturedTotal.inc();
      log.info({ event: "lead.captured", nome: lead.nome, celular: lead.celular });
    } catch (dbErr) {
      log.error({ event: "lead.persist_failed", err: dbErr?.message ?? String(dbErr) });
    }
    try {
      await enviarLeadPipeRun(lead);
      log.info({ event: "piperun.sent", nome: lead.nome, celular: lead.celular });
    } catch (crmErr) {
      log.error({ event: "piperun.failed", err: crmErr?.message ?? String(crmErr) });
    }
    try {
      const evento = await createCalendarEvent(lead);
      if (evento) log.info({ event: "calendar.created", url: evento.htmlLink });
    } catch (calErr) {
      log.error({ event: "calendar.failed", err: calErr?.message ?? String(calErr) });
    }
  }
}
