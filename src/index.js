import "dotenv/config";
import { startWhatsApp } from "./whatsapp/index.js";
import { startApi } from "./api/index.js";

console.log("Iniciando bot WhatsApp + API de webhook...");

startApi();
await startWhatsApp();
