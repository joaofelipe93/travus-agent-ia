import "dotenv/config";
import { startWhatsApp } from "./whatsapp/index.js";
import { startApi } from "./api/index.js";
import { startBoletosCron } from "./scheduler/boletos-cron.js";

console.log("Iniciando bot WhatsApp + API de webhook...");

startApi();
startBoletosCron();
await startWhatsApp();
