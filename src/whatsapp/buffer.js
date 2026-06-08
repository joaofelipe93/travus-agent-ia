const COALESCE_DELAY_MS = Number(process.env.COALESCE_DELAY_MS ?? 4000);
const COALESCE_MAX_MS = Number(process.env.COALESCE_MAX_MS ?? 30000);
const COALESCE_MAX_COUNT = Number(process.env.COALESCE_MAX_COUNT ?? 10);

const buffers = new Map();

function flush(jid) {
  const b = buffers.get(jid);
  if (!b) return;
  if (b.timer) clearTimeout(b.timer);
  buffers.delete(jid);
  const combined = b.texts.join("\n");
  console.log(`[BUFFER] ${jid} → flush ${b.texts.length} msg${b.texts.length > 1 ? "s" : ""}`);
  b.callback(combined);
}

/**
 * Acumula mensagens de texto do mesmo JID e dispara o callback quando o lead
 * parar de mandar mensagens por COALESCE_DELAY_MS, ou quando bater o limite
 * de mensagens / tempo total.
 *
 * @param {string} jid       - JID do contato
 * @param {string} text      - texto da mensagem (já transcrito se for áudio)
 * @param {(combined: string) => void} callback - chamado com texto combinado
 */
export function bufferText(jid, text, callback) {
  let b = buffers.get(jid);
  if (!b) {
    b = { texts: [], timer: null, firstAt: Date.now(), callback };
    buffers.set(jid, b);
  } else {
    b.callback = callback;
  }

  b.texts.push(text);

  const reachedMaxCount = b.texts.length >= COALESCE_MAX_COUNT;
  const reachedMaxTime = Date.now() - b.firstAt >= COALESCE_MAX_MS;
  if (reachedMaxCount || reachedMaxTime) {
    flush(jid);
    return;
  }

  if (b.timer) clearTimeout(b.timer);
  b.timer = setTimeout(() => flush(jid), COALESCE_DELAY_MS);
}
