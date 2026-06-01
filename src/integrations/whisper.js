import OpenAI, { toFile } from "openai";

let client = null;

function getClient() {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY não configurado no .env");
  client = new OpenAI({ apiKey });
  return client;
}

export async function transcribeAudio(buffer, { filename = "audio.ogg", language = "pt" } = {}) {
  const file = await toFile(buffer, filename);
  const result = await getClient().audio.transcriptions.create({
    file,
    model: "whisper-1",
    language,
  });
  return result.text ?? "";
}
