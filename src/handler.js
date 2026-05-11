import { askAgent } from "./agent.js";
import {
  getOrStartConversation,
  getHistory,
  addMessage,
  recordLeadCapture,
  phoneFromJid,
  disableFollowUps,
} from "./db.js";
import { enviarLeadPipeRun } from "./integrations/piperun.js";
import { createCalendarEvent } from "./integrations/calendar.js";
import { sendWithPresence } from "./whatsapp/presence.js";

const LEAD_FIELDS = ["nome", "email", "celular", "renda_mensal", "data_agendamento", "hora_agendamento"];

function processAgentResponse(text) {
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
  addMessage(convId, "user", text);

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
      await enviarLeadPipeRun(lead);
      recordLeadCapture(convId, lead);
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
