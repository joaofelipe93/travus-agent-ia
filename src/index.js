import "dotenv/config";
import "./utils/logger.js"; // ativa filtro do barulho do libsignal — deve vir antes do baileys
import { startWhatsApp } from "./whatsapp/index.js";
import { startApi } from "./api/index.js";
import { startBoletosCron } from "./scheduler/boletos-cron.js";
import { startContratoRemindersCron } from "./scheduler/contrato-reminders-cron.js";
import { startContratoAtrasosCron } from "./scheduler/contrato-atrasos-cron.js";
import { recordSystemEvent } from "./db.js";

console.log("Iniciando bot WhatsApp + API de webhook...");
recordSystemEvent("info", "boot", "Iniciando bot WhatsApp + API de webhook");

startApi();
startBoletosCron();
startContratoRemindersCron();
startContratoAtrasosCron();
await startWhatsApp();
