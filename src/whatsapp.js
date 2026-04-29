import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "baileys";
import qrcode from "qrcode-terminal";
import { askAgent } from "./agent.js";
import { getHistory, addMessage, clearHistory } from "./db.js";
import { enviarLeadPipeRun } from "./piperun.js";

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

function extractLeadJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const data = JSON.parse(text.slice(start, end + 1));
    if (data.nome && data.email && data.celular) return data;
  } catch {}
  return null;
}

export async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  let version;
  try {
    const info = await fetchLatestBaileysVersion();
    version = info.version;
    console.log(
      `[INFO] WhatsApp Web protocolo v${version.join(".")} (latest=${info.isLatest})`
    );
  } catch {
    console.log(
      "[AVISO] Falha ao buscar versão mais recente do WhatsApp Web; usando padrão do Baileys."
    );
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
      console.log(
        "     WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho\n"
      );
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("[OK] Conectado ao WhatsApp. Aguardando mensagens...");
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const msg = lastDisconnect?.error?.message ?? "?";
      const loggedOut = code === DisconnectReason.loggedOut;

      if (loggedOut) {
        console.log(
          "[ERRO] Sessão deslogada. Apague a pasta .baileys-auth/ e rode novamente para reescanear o QR."
        );
        process.exit(1);
      }

      console.log(
        `[AVISO] Conexão encerrada (code=${code}, msg=${msg}). Reconectando em ${RECONNECT_DELAY_MS}ms...`
      );
      setTimeout(() => startWhatsApp(), RECONNECT_DELAY_MS);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const from = msg.key.remoteJid;

      if (from?.endsWith("@g.us")) {
        console.log(`[GRUPO] ${from} → (ignorado)`);
        continue;
      }

      const text =
        msg.message.conversation ??
        msg.message.extendedTextMessage?.text ??
        null;

      if (!text) {
        const tipos = Object.keys(msg.message).filter((k) => msg.message[k]);
        console.log(`[DIRETO] ${from} → (não-texto: ${tipos.join(", ")}) — ignorado`);
        continue;
      }

      console.log(`[DIRETO] ${from} → ${text}`);

      try {
        const history = getHistory(from);
        addMessage(from, "user", text);

        const resposta = await askAgent(history, text);
        addMessage(from, "assistant", resposta);

        await sock.sendMessage(from, { text: resposta });
        console.log(`[AGENTE] → ${from}: ${resposta.slice(0, 80)}${resposta.length > 80 ? "…" : ""}`);

        const lead = extractLeadJson(resposta);
        if (lead) {
          try {
            await enviarLeadPipeRun(lead);
            console.log(`[CRM] Lead enviado para Piperun: ${lead.nome} <${lead.email}>`);
            clearHistory(from);
          } catch (crmErr) {
            console.error(`[CRM] Erro ao enviar para Piperun: ${crmErr?.message ?? crmErr}`);
          }
        }
      } catch (err) {
        console.error(`[ERRO] Falha ao consultar agente para ${from}: ${err?.message ?? err}`);
      }
    }
  });

  return sock;
}
