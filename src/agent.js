import OpenAI from "openai";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT_PATH = resolve(__dirname, "..", "prompts", "ana.md");
const SYSTEM_PROMPT = readFileSync(SYSTEM_PROMPT_PATH, "utf-8");
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error("OPENAI_API_KEY não configurado no .env.");
}

const client = new OpenAI({ apiKey });

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
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: messageWithContext },
  ];

  const response = await _client.chat.completions.create({
    model: MODEL,
    messages,
  });

  return response.choices[0]?.message?.content ?? "";
}
