import {
  getConversationsNeedingFollowUp,
  checkFollowUpStillNeeded,
  markFollowUpSent,
  addMessage,
} from "../db.js";
import { sendWithPresence } from "./presence.js";
import { enqueue } from "./queue.js";

const TEMPLATES = {
  1: "Oi! Você ainda tá por aí?",
  2: "Tentei falar com você, mas não foi possível. Tem algum horário para nos falarmos melhor?",
  3: "Olá, bom dia! Tudo bem?",
};

const CHECK_INTERVAL_MS = 60 * 1000;

let currentSock = null;
let intervalStarted = false;

export function startFollowUpScheduler(sock) {
  currentSock = sock;
  if (intervalStarted) return;
  intervalStarted = true;
  setInterval(runFollowUps, CHECK_INTERVAL_MS);
  console.log("[FOLLOWUP] scheduler iniciado (checa a cada 60s)");
}

async function runFollowUps() {
  if (!currentSock) return;

  let pending;
  try {
    pending = getConversationsNeedingFollowUp();
  } catch (err) {
    console.error(`[FOLLOWUP] erro ao consultar pendentes: ${err?.message ?? err}`);
    return;
  }

  for (const { conversation_id, jid, step } of pending) {
    enqueue(jid, async () => {
      if (!checkFollowUpStillNeeded(conversation_id, step)) return;
      const text = TEMPLATES[step];
      if (!text) return;
      try {
        await sendWithPresence(currentSock, jid, text);
        addMessage(conversation_id, "assistant", text);
        markFollowUpSent(conversation_id, step);
        console.log(`[FOLLOWUP] step=${step} → ${jid}`);
      } catch (err) {
        console.error(`[FOLLOWUP] erro ao enviar step=${step} para ${jid}: ${err?.message ?? err}`);
      }
    });
  }
}
