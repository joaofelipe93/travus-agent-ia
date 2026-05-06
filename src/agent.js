import OpenAI from "openai";

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
    currentDateTimeMessage(),
    ...history,
    { role: "user", content: messageWithContext },
  ];

  const response = await _client.chat.completions.create({
    model: "n/a",
    messages,
  });

  return response.choices[0]?.message?.content ?? "";
}
