import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
} from "baileys";
import qrcode from "qrcode-terminal";

const SESSION_DIR = "./.baileys-auth";

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

  const sock = makeWASocket({
    auth: state,
    logger: silentLogger,
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
      const loggedOut = code === DisconnectReason.loggedOut;

      if (loggedOut) {
        console.log(
          "[ERRO] Sessão deslogada. Apague a pasta .baileys-auth/ e rode novamente para reescanear o QR."
        );
        process.exit(1);
      }

      console.log(`[AVISO] Conexão encerrada (code=${code}). Reconectando...`);
      startWhatsApp();
    }
  });

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const text =
        msg.message.conversation ??
        msg.message.extendedTextMessage?.text ??
        null;

      const from = msg.key.remoteJid;
      const origem = from?.endsWith("@g.us") ? "GRUPO" : "DIRETO";

      if (text) {
        console.log(`[${origem}] ${from} → ${text}`);
      } else {
        const tipos = Object.keys(msg.message).filter((k) => msg.message[k]);
        console.log(
          `[${origem}] ${from} → (mensagem não-texto: ${tipos.join(", ")})`
        );
      }
    }
  });

  return sock;
}
