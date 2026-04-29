import "dotenv/config";
import { startWhatsApp } from "./whatsapp.js";

console.log("Iniciando bot WhatsApp ↔ Agente DigitalOcean...");

await startWhatsApp();
