import {
  getConversationsNeedingFollowUp,
  checkFollowUpStillNeeded,
  markFollowUpSent,
  addMessage,
} from "../db.js";
import { sendWithPresence } from "./presence.js";
import { enqueue } from "./queue.js";

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
let isRunning = false;

export function startFollowUpScheduler(sock) {
  currentSock = sock;
  if (intervalStarted) return;
  intervalStarted = true;
  setInterval(runFollowUps, CHECK_INTERVAL_MS);
  console.log("[FOLLOWUP] scheduler iniciado (checa a cada 60s)");
}

async function runFollowUps() {
  if (!currentSock) return;
  if (isRunning) {
    console.warn("[FOLLOWUP] execução anterior ainda em andamento, pulando este tick");
    return;
  }
  isRunning = true;

  try {
    await runFollowUpsBody();
  } finally {
    isRunning = false;
  }
}

async function runFollowUpsBody() {
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
      const text = templateFor(step);
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
