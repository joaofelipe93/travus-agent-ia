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

function currentDateTimeMessage() {
  const now = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return { role: "system", content: `Data e horário atuais em Brasília: ${now}.` };
}

export async function askAgent(history, userMessage, _client = client) {
  const messages = [
    currentDateTimeMessage(),
    ...history,
    { role: "user", content: userMessage },
  ];

  const response = await _client.chat.completions.create({
    model: "n/a",
    messages,
  });

  return response.choices[0]?.message?.content ?? "";
}
