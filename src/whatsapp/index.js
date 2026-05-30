import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "baileys";
import qrcode from "qrcode-terminal";
import { handleMessage } from "../handler.js";
import { enqueue } from "./queue.js";
import { startFollowUpScheduler } from "./followup.js";
import { startMeetingReminderScheduler } from "../integrations/meeting-reminders.js";
import { markCallAnswered } from "../db.js";
import { logger } from "../logger.js";
import { whatsappConnected, messagesInTotal } from "../metrics.js";

const SESSION_DIR = "./.baileys-auth";
const RECONNECT_DELAY_MS = 2000;

const silentLogger = {
  level: "silent",
  fatal: () => {},
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
  child: () => silentLogger,
};

export async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  let version;
  try {
    const info = await fetchLatestBaileysVersion();
    version = info.version;
    logger.info({ event: "whatsapp.protocol_version", version: version.join("."), latest: info.isLatest });
  } catch {
    logger.warn({ event: "whatsapp.protocol_version_fallback" });
  }

  const sock = makeWASocket({
    auth: state,
    logger: silentLogger,
    version,
    browser: ["Travus Bot", "Chrome", "120.0.0"],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info({ event: "whatsapp.qr" });
      console.log("\nEscaneie: WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      whatsappConnected.set(1);
      logger.info({ event: "whatsapp.connected" });
      startFollowUpScheduler(sock);
      startMeetingReminderScheduler(sock);
    }

    if (connection === "close") {
      whatsappConnected.set(0);
      const code = lastDisconnect?.error?.output?.statusCode;
      const msg = lastDisconnect?.error?.message ?? "?";
      const loggedOut = code === DisconnectReason.loggedOut;

      if (loggedOut) {
        logger.fatal({ event: "whatsapp.logged_out" });
        process.exit(1);
      }

      logger.warn({ event: "whatsapp.disconnected", code, err: msg, reconnect_in_ms: RECONNECT_DELAY_MS });
      setTimeout(() => startWhatsApp(), RECONNECT_DELAY_MS);
    }
  });

  sock.ev.on("call", async (calls) => {
    for (const call of calls) {
      logger.debug({ event: "call.event", call_id: call.id, from: call.from, status: call.status, video: call.isVideo ?? false });
      if (call.status === "accept" && call.from) {
        const marked = markCallAnswered(call.from);
        logger.info({ event: "call.answered", jid: call.from, conversation_found: marked });
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const from = msg.key.remoteJid;

      if (from?.endsWith("@g.us")) {
        logger.debug({ event: "message.group_ignored", jid: from });
        continue;
      }

      const text =
        msg.message.conversation ??
        msg.message.extendedTextMessage?.text ??
        null;

      if (!text) {
        const tipos = Object.keys(msg.message).filter((k) => msg.message[k]);
        logger.debug({ event: "message.non_text_ignored", jid: from, kinds: tipos });
        continue;
      }

      messagesInTotal.inc();
      logger.info({ event: "message.received", jid: from, preview: text.slice(0, 80) });
      enqueue(from, () => handleMessage(from, text, sock));
    }
  });

  return sock;
}
