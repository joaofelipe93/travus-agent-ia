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

export async function askAgent(history, userMessage, _client = client) {
  const messages = [
    ...history,
    { role: "user", content: userMessage },
  ];

  const response = await _client.chat.completions.create({
    model: "n/a",
    messages,
  });

  return response.choices[0]?.message?.content ?? "";
}
