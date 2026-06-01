import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} from "baileys";
import qrcode from "qrcode-terminal";
import { handleMessage } from "../handler.js";
import { enqueue } from "./queue.js";
import { startFollowUpScheduler } from "./followup.js";
import { startMeetingReminderScheduler } from "../integrations/meeting-reminders.js";
import { transcribeAudio } from "../integrations/whisper.js";
import { markCallAnswered, markMessageProcessed, pruneProcessedMessages } from "../db.js";

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
    console.log(`[INFO] WhatsApp Web protocolo v${version.join(".")} (latest=${info.isLatest})`);
  } catch {
    console.log("[AVISO] Falha ao buscar versão mais recente do WhatsApp Web; usando padrão do Baileys.");
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
      console.log("\n[QR] Escaneie o código abaixo no WhatsApp do seu celular:");
      console.log("     WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("[OK] Conectado ao WhatsApp. Aguardando mensagens...");
      startFollowUpScheduler(sock);
      startMeetingReminderScheduler(sock);
      try { pruneProcessedMessages(); } catch {}
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const msg = lastDisconnect?.error?.message ?? "?";
      const loggedOut = code === DisconnectReason.loggedOut;

      if (loggedOut) {
        console.log("[ERRO] Sessão deslogada. Apague a pasta .baileys-auth/ e rode novamente para reescanear o QR.");
        process.exit(1);
      }

      console.log(`[AVISO] Conexão encerrada (code=${code}, msg=${msg}). Reconectando em ${RECONNECT_DELAY_MS}ms...`);
      setTimeout(() => startWhatsApp(), RECONNECT_DELAY_MS);
    }
  });

  sock.ev.on("call", async (calls) => {
    for (const call of calls) {
      console.log(`[CALL] event id=${call.id} from=${call.from} status=${call.status} video=${call.isVideo ?? false}`);
      if (call.status === "accept" && call.from) {
        const marked = markCallAnswered(call.from);
        if (marked) {
          console.log(`[CALL] Atendida → follow-ups desativados para ${call.from}`);
        } else {
          console.log(`[CALL] Atendida mas nenhuma conversa ativa encontrada para ${call.from}`);
        }
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const messageId = msg.key.id;
      if (messageId && !markMessageProcessed(messageId)) {
        console.log(`[DUP] mensagem ${messageId} já processada, ignorando reentrega.`);
        continue;
      }

      const from = msg.key.remoteJid;

      if (from?.endsWith("@g.us")) {
        console.log(`[GRUPO] ${from} → (ignorado)`);
        continue;
      }

      const text =
        msg.message.conversation ??
        msg.message.extendedTextMessage?.text ??
        null;

      if (text) {
        console.log(`[DIRETO] ${from} → ${text}`);
        enqueue(from, () => handleMessage(from, text, sock));
        continue;
      }

      if (msg.message.audioMessage) {
        console.log(`[AUDIO] ${from} → recebido (transcrevendo...)`);
        enqueue(from, async () => {
          try {
            const buffer = await downloadMediaMessage(msg, "buffer", {}, { logger: silentLogger });
            const transcribed = (await transcribeAudio(buffer))?.trim();
            if (!transcribed) {
              console.warn(`[AUDIO] ${from} → transcrição vazia, ignorando`);
              return;
            }
            console.log(`[AUDIO] ${from} → "${transcribed}"`);
            await handleMessage(from, transcribed, sock);
          } catch (err) {
            console.error(`[AUDIO] ${from} → erro: ${err?.message ?? err}`);
          }
        });
        continue;
      }

      const tipos = Object.keys(msg.message).filter((k) => msg.message[k]);
      console.log(`[DIRETO] ${from} → (não-texto: ${tipos.join(", ")}) — ignorado`);
    }
  });

  return sock;
}
