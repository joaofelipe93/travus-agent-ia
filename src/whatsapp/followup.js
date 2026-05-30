import {
  getConversationsNeedingFollowUp,
  checkFollowUpStillNeeded,
  markFollowUpSent,
  addMessage,
} from "../db.js";
import { sendWithPresence } from "./presence.js";
import { enqueue } from "./queue.js";
import { logger } from "../logger.js";
import { followupsSentTotal, messagesOutTotal } from "../metrics.js";

function saudacaoBrasilia() {
  const hh = new Date().toLocaleString("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const h = parseInt(hh, 10);
  if (h >= 4 && h <= 11) return "Bom dia";
  if (h >= 12 && h <= 17) return "Boa tarde";
  return "Boa noite";
}

function templateFor(step) {
  if (step === 1) return "Oi! Você ainda tá por aí?";
  if (step === 2) return "Tentei falar com você, mas não foi possível. Tem algum horário para nos falarmos melhor?";
  if (step === 3) return `Olá, ${saudacaoBrasilia()}! Tudo bem?`;
  return null;
}

const CHECK_INTERVAL_MS = 60 * 1000;

let currentSock = null;
let intervalStarted = false;

export function startFollowUpScheduler(sock) {
  currentSock = sock;
  if (intervalStarted) return;
  intervalStarted = true;
  setInterval(runFollowUps, CHECK_INTERVAL_MS);
  logger.info({ event: "followup.scheduler_started", interval_ms: CHECK_INTERVAL_MS });
}

async function runFollowUps() {
  if (!currentSock) return;

  let pending;
  try {
    pending = getConversationsNeedingFollowUp();
  } catch (err) {
    logger.error({ event: "followup.query_failed", err: err?.message ?? String(err) });
    return;
  }

  for (const { conversation_id, jid, step } of pending) {
    enqueue(jid, async () => {
      if (!checkFollowUpStillNeeded(conversation_id, step)) return;
      const text = templateFor(step);
      if (!text) return;
      try {
        await sendWithPresence(currentSock, jid, text);
        addMessage(conversation_id, "assistant", text);
        markFollowUpSent(conversation_id, step);
        followupsSentTotal.inc({ step: String(step) });
        messagesOutTotal.inc({ kind: "followup" });
        logger.info({ event: "followup.sent", jid, conv_id: conversation_id, step });
      } catch (err) {
        logger.error({ event: "followup.send_failed", jid, conv_id: conversation_id, step, err: err?.message ?? String(err) });
      }
    });
  }
}
