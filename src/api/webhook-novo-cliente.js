import {
  ensureContact,
  hasWebhookDispatched,
  recordWebhookDispatch,
  getOrStartConversation,
  addMessage,
} from "../db.js";
import { enqueue } from "../whatsapp/queue.js";
import { sendWithPresence } from "../whatsapp/presence.js";
import { saudacaoBrasilia } from "../utils/saudacao.js";
import { getSock } from "./index.js";
import { getPerson, moveDealToStage } from "./piperun-api.js";

const DESTINATION_STAGE_ID = Number(process.env.PIPERUN_NEW_CLIENT_DESTINATION_STAGE_ID ?? 648382);

function firstName(fullName) {
  return String(fullName ?? "").trim().split(/\s+/)[0] || "";
}

function pickPhone(contactPhones) {
  if (!Array.isArray(contactPhones) || contactPhones.length === 0) return null;
  const main = contactPhones.find((p) => p?.is_main === true);
  const chosen = main ?? contactPhones[0];
  return chosen?.number ?? null;
}

function buildInitialMessage(nome) {
  const primeiro = firstName(nome);
  const saudacao = saudacaoBrasilia().toLowerCase();
  const ola = primeiro ? `Olá, ${primeiro}` : "Olá";
  return (
    `${ola}! ${saudacao.charAt(0).toUpperCase() + saudacao.slice(1)}. Aqui é a Ana, da Travus Capital.\n\n` +
    `Vi que você se cadastrou na nossa página, fico feliz com o interesse! 😊\n\n` +
    `Posso te fazer algumas perguntas rápidas pra entender se a nossa consultoria faz sentido pra você?`
  );
}

export async function novoClienteWebhookHandler(req, res) {
  const payload = req.body ?? {};
  const dealId = payload?.id;
  const personId = payload?.person?.id;
  const stageId = payload?.stage?.id;

  if (!dealId || !personId || !stageId) {
    console.warn("[NOVO_CLIENTE] payload sem id (deal), person.id ou stage.id, ignorando");
    return res.status(400).json({ error: "missing id, person.id or stage.id" });
  }

  if (hasWebhookDispatched(personId, stageId)) {
    console.log(`[NOVO_CLIENTE] já processado para person_id=${personId} stage_id=${stageId}, ignorando`);
    return res.status(200).json({ status: "already_dispatched" });
  }

  let person;
  try {
    person = await getPerson(personId);
  } catch (err) {
    console.error(`[NOVO_CLIENTE] erro ao buscar pessoa ${personId}: ${err?.message ?? err}`);
    return res.status(502).json({ error: "piperun api failure" });
  }

  if (!person) {
    console.warn(`[NOVO_CLIENTE] pessoa ${personId} não encontrada na API`);
    return res.status(404).json({ error: "person not found" });
  }

  const nome = person?.name ?? payload?.person?.name;
  const phone = pickPhone(person?.contact_phones) ?? pickPhone(payload?.person?.contact_phones);

  if (!phone) {
    console.warn(`[NOVO_CLIENTE] person_id=${personId} sem telefone identificável`);
    return res.status(400).json({ error: "no contact phone available" });
  }

  const sock = getSock();
  if (!sock) {
    console.warn("[NOVO_CLIENTE] WhatsApp não conectado, retornando 503 pra Piperun retentar");
    return res.status(503).json({ error: "whatsapp not connected" });
  }

  let lookup;
  try {
    [lookup] = await sock.onWhatsApp(phone);
  } catch (err) {
    console.error(`[NOVO_CLIENTE] erro ao consultar onWhatsApp(${phone}): ${err?.message ?? err}`);
    return res.status(502).json({ error: "whatsapp lookup failed" });
  }

  if (!lookup?.exists) {
    console.warn(`[NOVO_CLIENTE] número ${phone} não existe no WhatsApp — não enviando`);
    return res.status(404).json({ error: "phone not on whatsapp", phone });
  }

  const jid = lookup.jid;
  console.log(`[NOVO_CLIENTE] ${nome} (${phone}) → JID ${jid}`);
  ensureContact(phone, jid);

  const recorded = recordWebhookDispatch(personId, stageId, jid, phone);
  if (!recorded) {
    console.log(`[NOVO_CLIENTE] race - outro processo registrou primeiro person_id=${personId}`);
    return res.status(200).json({ status: "already_dispatched" });
  }

  const message = buildInitialMessage(nome);

  enqueue(jid, async () => {
    try {
      await sendWithPresence(sock, jid, message);
      const convId = getOrStartConversation(jid);
      addMessage(convId, "assistant", message);
      console.log(`[NOVO_CLIENTE] mensagem inicial enviada para ${jid}, conv_id=${convId}`);
    } catch (err) {
      console.error(`[NOVO_CLIENTE] erro ao enviar inicial para ${jid}: ${err?.message ?? err}`);
      return;
    }

    try {
      await moveDealToStage(dealId, DESTINATION_STAGE_ID);
      console.log(`[NOVO_CLIENTE] deal ${dealId} movido para stage ${DESTINATION_STAGE_ID}`);
    } catch (err) {
      console.error(`[NOVO_CLIENTE] erro ao mover deal ${dealId} para stage ${DESTINATION_STAGE_ID}: ${err?.message ?? err}`);
    }
  });

  return res.status(202).json({ status: "queued", jid, deal_id: dealId });
}
