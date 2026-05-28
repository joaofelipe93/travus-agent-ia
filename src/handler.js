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

function buildAgentInput(text, jid) {
  if (!jid?.endsWith("@s.whatsapp.net")) return text;
  const phone = phoneFromJid(jid);
  return `[Número do WhatsApp do lead: ${phone}]\n\n${text}`;
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

  const resposta = await askAgent(history, buildAgentInput(text, from));
  addMessage(convId, "assistant", resposta);

  const { cleanText, lead, closeReason } = processAgentResponse(resposta);

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
      await enviarLeadPipeRun(lead);
      console.log(`[CRM] Lead enviado para Piperun: ${lead.nome} | ${lead.celular}`);
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
