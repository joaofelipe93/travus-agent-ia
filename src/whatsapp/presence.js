function typingDelay(text) {
  const len = text.length;
  let min, max;
  if (len < 100)       { min = 1000; max = 2000; }
  else if (len < 300)  { min = 2000; max = 4000; }
  else                 { min = 4000; max = 6000; }
  return Math.floor(min + Math.random() * (max - min));
}

/**
 * Envia mensagem de texto simulando digitação humana.
 * @param {object} sock   - socket Baileys
 * @param {string} jid    - destinatário
 * @param {string} text   - conteúdo da mensagem
 * @param {'composing'|'recording'} mode - tipo de presença (padrão: composing)
 */
export async function sendWithPresence(sock, jid, text, { mode = "composing" } = {}) {
  await sock.sendPresenceUpdate(mode, jid);
  await new Promise((r) => setTimeout(r, typingDelay(text)));
  await sock.sendMessage(jid, { text });
  await sock.sendPresenceUpdate("paused", jid);
}
