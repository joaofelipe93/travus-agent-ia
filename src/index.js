import "dotenv/config";
import { startWhatsApp } from "./whatsapp/index.js";
import { startApi } from "./api/index.js";
import { startBoletosCron } from "./scheduler/boletos-cron.js";
import { startContratoRemindersCron } from "./scheduler/contrato-reminders-cron.js";
import { startContratoAtrasosCron } from "./scheduler/contrato-atrasos-cron.js";

console.log("Iniciando bot WhatsApp + API de webhook...");

startApi();
startBoletosCron();
startContratoRemindersCron();
startContratoAtrasosCron();
await startWhatsApp();
