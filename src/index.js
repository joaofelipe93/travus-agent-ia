import "dotenv/config";
import { startWhatsApp } from "./whatsapp/index.js";

console.log("Iniciando bot WhatsApp ↔ Agente DigitalOcean...");

await startWhatsApp();
