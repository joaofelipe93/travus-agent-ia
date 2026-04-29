import OpenAI from "openai";
import { readFileSync } from "node:fs";

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

let systemPrompt = "";
try {
  systemPrompt = readFileSync("./INSTRUCAOAGENT.md", "utf-8");
} catch {
  console.warn("[AVISO] INSTRUCAOAGENT.md não encontrado — agente sem system prompt local.");
}

export async function askAgent(history, userMessage, _client = client) {
  const messages = [
    ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
    ...history,
    { role: "user", content: userMessage },
  ];

  const response = await _client.chat.completions.create({
    model: "n/a",
    messages,
  });

  return response.choices[0]?.message?.content ?? "";
}
