import "dotenv/config";
import { startWhatsApp } from "./whatsapp/index.js";
import { startHttpServer } from "./http-server.js";
import { logger } from "./logger.js";

logger.info({ event: "boot.start" });

startHttpServer();
await startWhatsApp();
