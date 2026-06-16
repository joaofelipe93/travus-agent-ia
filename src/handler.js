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

function buildAgentInput(text, jid, history) {
  const parts = [];
  if (jid?.endsWith("@s.whatsapp.net")) {
    parts.push(`[Número do WhatsApp do lead: ${phoneFromJid(jid)}]`);
  }
  if (history?.length === 1 && history[0].role === "assistant") {
    parts.push(
      "[Contexto: Lead veio do formulário da LP. Você já se apresentou e perguntou se ele topa responder algumas perguntas — essa é a 1ª resposta dele. Pule a saudação e o passo de perguntar o nome (já tá na sua mensagem anterior). Vá direto pro passo 3 (intenção: morar ou investir).]"
    );
  }
  if (parts.length === 0) return text;
  return `${parts.join("\n")}\n\n${text}`;
}

export async function handleMessage(from, text, sock) {
  const convId = getOrStartConversation(from);
  const history = getHistory(convId);

  if (history.length === 0 && !NEW_LEAD_TRIGGER.test(text)) {
    addMessage(convId, "user", text);
    disableBot(convId);
    console.log(`[BOT] Lead antigo detectado (mensagem inicial sem "formulário") → ${from}. Bot silenciado pra essa conversa.`);
    return;
  }

  addMessage(convId, "user", text);

  if (!isBotEnabled(convId)) {
    console.log(`[BOT] Mensagem ignorada (conversa em modo manual) → ${from}: ${text.slice(0, 50)}`);
    return;
  }

  const resposta = await askAgent(history, buildAgentInput(text, from, history));
  addMessage(convId, "assistant", resposta);

  const { cleanText, lead, closeReason } = processAgentResponse(resposta);

  // Resolve celular antes de qualquer envio: se for inválido / placeholder, pede o número.
  let resolvedCelular = null;
  if (lead) {
    resolvedCelular = resolveLeadCelular(lead, convId, from);
    if (!resolvedCelular) {
      console.error(`[LEAD] celular inválido/ausente (agente: "${lead.celular}") → pedindo número ao lead, não capturando lead ainda.`);
      const recovery = "Antes de finalizar, qual o melhor número pra eu te ligar? 😊";
      await sendWithPresence(sock, from, recovery);
      addMessage(convId, "assistant", recovery);
      return;
    }
    if (resolvedCelular !== lead.celular) {
      console.log(`[LEAD] celular do agente "${lead.celular}" corrigido para "${resolvedCelular}" (extraído do histórico/JID)`);
      lead.celular = resolvedCelular;
    }
  }

  if (cleanText) {
    await sendWithPresence(sock, from, cleanText);
    console.log(`[AGENTE] → ${from}: ${cleanText.slice(0, 80)}${cleanText.length > 80 ? "…" : ""}`);
  }

  if (closeReason) {
    disableFollowUps(convId, closeReason);
    console.log(`[CONVERSA] follow-ups desativados (motivo: ${closeReason}) → ${from} (histórico mantido)`);
  }

  if (lead) {
    try {
      recordLeadCapture(convId, lead);
      console.log(`[LEAD] capturado localmente: ${lead.nome} | ${lead.celular}`);
    } catch (dbErr) {
      console.error(`[LEAD] Erro ao gravar lead local: ${dbErr?.message ?? dbErr}`);
    }
    try {
      const piperunResp = await enviarLeadPipeRun(lead);
      console.log(`[CRM] Lead enviado para Piperun: ${lead.nome} | ${lead.celular}`);
      console.log(`[CRM] Resposta Piperun: ${JSON.stringify(piperunResp).slice(0, 800)}`);
    } catch (crmErr) {
      console.error(`[CRM] Erro ao enviar para Piperun: ${crmErr?.message ?? crmErr}`);
    }
    try {
      const evento = await createCalendarEvent(lead);
      if (evento) console.log(`[CALENDAR] Evento criado: ${evento.htmlLink}`);
    } catch (calErr) {
      console.error(`[CALENDAR] Erro ao criar evento: ${calErr?.message ?? calErr}`);
    }
  }
}
