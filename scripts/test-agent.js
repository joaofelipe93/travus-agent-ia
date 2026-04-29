import "dotenv/config";
import { askAgent } from "../src/agent.js";

const prompt = process.argv.slice(2).join(" ").trim() || "Olá! Você está online?";

console.log(`> ${prompt}\n`);

try {
  const answer = await askAgent([], prompt);
  console.log(answer);
} catch (err) {
  console.error("Falha ao consultar o agente:");
  console.error(err?.message ?? err);
  if (err?.status) console.error(`HTTP status: ${err.status}`);
  process.exit(1);
}
