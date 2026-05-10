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
  2: "Oi! Caso ainda tenha interesse na conversa, é só me dar um sinal por aqui.",
  3: "Tá tudo certo aí? Sigo à disposição se quiser continuar.",
  4: "Oi! Se preferir, podemos continuar nossa conversa em outro momento. É só me chamar.",
  5: "Oi! Passei aqui só pra avisar que sigo à disposição se ainda tiver interesse em conversar sobre investimentos. Quando puder, me dá um retorno.",
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
