import "dotenv/config";
import { startWhatsApp } from "../src/whatsapp/index.js";
import { getSock } from "../src/api/index.js";
import { runMonthlyBoletos } from "../src/jobs/monthly-boletos.js";

console.log("[BOLETOS_MANUAL] iniciando WhatsApp pra disparo manual da rotina mensal...");
await startWhatsApp();

let attempts = 0;
while (!getSock() && attempts < 60) {
  await new Promise((r) => setTimeout(r, 1000));
  attempts += 1;
}

const sock = getSock();
if (!sock) {
  console.error("[BOLETOS_MANUAL] WhatsApp não conectou em 60s, abortando");
  process.exit(1);
}

await runMonthlyBoletos(sock);
console.log("[BOLETOS_MANUAL] concluído");
process.exit(0);
