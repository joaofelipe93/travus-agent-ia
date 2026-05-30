import OpenAI from "openai";
import { logger } from "./logger.js";
import { agentRequestsTotal, agentRequestDuration } from "./metrics.js";

const { AGENTENDPOINT, SECRETKEYAGENT } = process.env;

if (!AGENTENDPOINT || !SECRETKEYAGENT) {
  throw new Error(
    "Variáveis AGENTENDPOINT e SECRETKEYAGENT são obrigatórias. Verifique o arquivo .env."
  );
}

const client = new OpenAI({
  baseURL: `${AGENTENDPOINT.replace(/\/$/, "")}/api/v1/`,
  apiKey: SECRETKEYAGENT,
});

function currentDateTime() {
  return new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function askAgent(history, userMessage, _client = client) {
  const messageWithContext = `[Data e horário em Brasília: ${currentDateTime()}]\n\n${userMessage}`;
  const messages = [
    ...history,
    { role: "user", content: messageWithContext },
  ];

  const endTimer = agentRequestDuration.startTimer();
  try {
    const response = await _client.chat.completions.create({
      model: "n/a",
      messages,
    });
    const duration_s = endTimer();
    agentRequestsTotal.inc({ status: "ok" });
    logger.debug({ event: "agent.call", status: "ok", duration_s, history_len: history.length });
    return response.choices[0]?.message?.content ?? "";
  } catch (err) {
    endTimer();
    agentRequestsTotal.inc({ status: "error" });
    logger.error({ event: "agent.call", status: "error", err: err?.message ?? String(err) });
    throw err;
  }
}
