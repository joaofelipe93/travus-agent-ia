import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  jidNormalizedUser,
} from "baileys";
import qrcode from "qrcode-terminal";
import { handleMessage } from "../handler.js";
import { enqueue } from "./queue.js";
import { bufferText } from "./buffer.js";
import { startFollowUpScheduler } from "./followup.js";
import { startMeetingReminderScheduler } from "../integrations/meeting-reminders.js";
import { transcribeAudio } from "../integrations/whisper.js";
import { setSock as setApiSock } from "../api/index.js";
import { markCallAnswered, markMessageProcessed, pruneProcessedMessages, recordSystemEvent } from "../db.js";

const SESSION_DIR = "./.baileys-auth";
const RECONNECT_DELAY_MS = 2000;

async function resolveLidToPn(sock, jid) {
  if (!jid || !jid.endsWith("@lid")) return jid;
  try {
    const pnJid = await sock.signalRepository?.lidMapping?.getPNForLID?.(jid);
    if (!pnJid) {
      console.warn(`[LID] sem mapping reverso pra ${jid} — usando @lid mesmo`);
      return jid;
    }
    const normalized = jidNormalizedUser(pnJid);
    console.log(`[LID] ${jid} → ${normalized}`);
    return normalized;
  } catch (err) {
    console.warn(`[LID] erro ao resolver ${jid}: ${err?.message ?? err}`);
    return jid;
  }
}

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
      recordSystemEvent("info", "whatsapp", "Conectado ao WhatsApp");
      setApiSock(sock);
      startFollowUpScheduler(sock);
      startMeetingReminderScheduler(sock);
      try { pruneProcessedMessages(); } catch {}
    }

    if (connection === "close") {
      setApiSock(null);

      const code = lastDisconnect?.error?.output?.statusCode;
      const msg = lastDisconnect?.error?.message ?? "?";
      const loggedOut = code === DisconnectReason.loggedOut;

      if (loggedOut) {
        console.log("[ERRO] Sessão deslogada. Apague a pasta .baileys-auth/ e rode novamente para reescanear o QR.");
        recordSystemEvent("error", "whatsapp", "Sessão deslogada — precisa reescanear QR");
        process.exit(1);
      }

      console.log(`[AVISO] Conexão encerrada (code=${code}, msg=${msg}). Reconectando em ${RECONNECT_DELAY_MS}ms...`);
      recordSystemEvent("warn", "whatsapp", `Conexão encerrada (code=${code}, msg=${msg}) — reconectando`);
      setTimeout(() => startWhatsApp(), RECONNECT_DELAY_MS);
    }
  });

  sock.ev.on("call", async (calls) => {
    for (const call of calls) {
      const from = await resolveLidToPn(sock, call.from);
      console.log(`[CALL] event id=${call.id} from=${from} status=${call.status} video=${call.isVideo ?? false}`);
      if (call.status === "accept" && from) {
        const marked = markCallAnswered(from);
        if (marked) {
          console.log(`[CALL] Atendida → follow-ups desativados para ${from}`);
        } else {
          console.log(`[CALL] Atendida mas nenhuma conversa ativa encontrada para ${from}`);
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

      const rawJid = msg.key.remoteJid;

      if (rawJid?.endsWith("@g.us")) {
        console.log(`[GRUPO] ${rawJid} → (ignorado)`);
        continue;
      }

      const from = await resolveLidToPn(sock, rawJid);

      const text =
        msg.message.conversation ??
        msg.message.extendedTextMessage?.text ??
        null;

      if (text) {
        console.log(`[DIRETO] ${from} → ${text}`);
        bufferText(from, text, (combined) =>
          enqueue(from, () => handleMessage(from, combined, sock))
        );
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
            bufferText(from, transcribed, (combined) =>
              enqueue(from, () => handleMessage(from, combined, sock))
            );
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
