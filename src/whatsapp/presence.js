const READING_DELAY_MIN_MS = 1500;
const READING_DELAY_MAX_MS = 3500;

function readingDelay() {
  return Math.floor(READING_DELAY_MIN_MS + Math.random() * (READING_DELAY_MAX_MS - READING_DELAY_MIN_MS));
}

function typingDelay(text) {
  const len = text.length;
  let min, max;
  if (len < 100)       { min = 3000;  max = 6000; }
  else if (len < 300)  { min = 5000;  max = 9000; }
  else                 { min = 7000;  max = 13000; }
  return Math.floor(min + Math.random() * (max - min));
}

/**
 * Envia mensagem de texto simulando comportamento humano:
 * 1. Pausa de "leitura" antes de começar a digitar.
 * 2. Status "composing" durante o tempo proporcional ao texto.
 * 3. Envio da mensagem e fechamento do status.
 *
 * @param {object} sock   - socket Baileys
 * @param {string} jid    - destinatário
 * @param {string} text   - conteúdo da mensagem
 * @param {'composing'|'recording'} mode - tipo de presença (padrão: composing)
 */
export async function sendWithPresence(sock, jid, text, { mode = "composing" } = {}) {
  await new Promise((r) => setTimeout(r, readingDelay()));
  await sock.sendPresenceUpdate(mode, jid);
  await new Promise((r) => setTimeout(r, typingDelay(text)));
  await sock.sendMessage(jid, { text });
  await sock.sendPresenceUpdate("paused", jid);
}
