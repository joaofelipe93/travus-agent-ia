import { askAgent } from "./agent.js";
import { getOrStartConversation, getHistory, addMessage, recordLeadCapture } from "./db.js";
import { enviarLeadPipeRun } from "./integrations/piperun.js";
import { createCalendarEvent } from "./integrations/calendar.js";

function processAgentResponse(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return { cleanText: text, lead: null };
  try {
    const data = JSON.parse(text.slice(start, end + 1));
    if (data.nome && data.email && data.celular) {
      const cleanText = (text.slice(0, start) + text.slice(end + 1)).trim();
      return { cleanText: cleanText || null, lead: data };
    }
  } catch {}
  return { cleanText: text, lead: null };
}

export async function handleMessage(from, text, sock) {
  const convId = getOrStartConversation(from);
  const history = getHistory(convId);
  addMessage(convId, "user", text);

  const resposta = await askAgent(history, text);
  addMessage(convId, "assistant", resposta);

  const { cleanText, lead } = processAgentResponse(resposta);

  if (cleanText) {
    await sock.sendMessage(from, { text: cleanText });
    console.log(`[AGENTE] → ${from}: ${cleanText.slice(0, 80)}${cleanText.length > 80 ? "…" : ""}`);
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
