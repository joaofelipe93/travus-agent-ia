import {
  ensureContact,
  hasWebhookDispatched,
  recordWebhookDispatch,
  getOrStartConversation,
  addMessage,
  phoneFromJid,
  setConversationDealId,
  recordSystemEvent,
} from "../db.js";
import { enqueue } from "../whatsapp/queue.js";
import { sendWithPresence } from "../whatsapp/presence.js";
import { saudacaoBrasilia } from "../utils/saudacao.js";
import { getSock } from "./index.js";
import { getPerson, moveDealToStage } from "./piperun-api.js";

const DESTINATION_STAGE_ID = Number(process.env.PIPERUN_NEW_CLIENT_DESTINATION_STAGE_ID ?? 648382);
const REQUIRED_ORIGIN = process.env.NOVO_CLIENTE_REQUIRED_ORIGIN ?? "LP V2";

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

  recordSystemEvent("info", "webhook-novo-cliente", `recebido: deal=${dealId ?? "?"} person=${personId ?? "?"}`);

  if (!dealId || !personId || !stageId) {
    console.warn("[NOVO_CLIENTE] payload sem id (deal), person.id ou stage.id, ignorando");
    recordSystemEvent("warn", "webhook-novo-cliente", "payload sem id (deal), person.id ou stage.id, ignorando");
    return res.status(400).json({ error: "missing id, person.id or stage.id" });
  }

  const originName = payload?.origin?.name;
  if (originName !== REQUIRED_ORIGIN) {
    console.log(`[NOVO_CLIENTE] origin "${originName ?? "(vazio)"}" diferente de "${REQUIRED_ORIGIN}", ignorando`);
    return res.status(200).json({ status: "ignored_origin", origin: originName ?? null });
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
    recordSystemEvent("error", "webhook-novo-cliente", `erro ao buscar pessoa ${personId}: ${err?.message ?? err}`);
    return res.status(502).json({ error: "piperun api failure" });
  }

  if (!person) {
    console.warn(`[NOVO_CLIENTE] pessoa ${personId} não encontrada na API`);
    recordSystemEvent("warn", "webhook-novo-cliente", `pessoa ${personId} não encontrada na API`);
    return res.status(404).json({ error: "person not found" });
  }

  const nome = person?.name ?? payload?.person?.name;
  const phone = pickPhone(person?.contact_phones) ?? pickPhone(payload?.person?.contact_phones);

  if (!phone) {
    console.warn(`[NOVO_CLIENTE] person_id=${personId} sem telefone identificável`);
    recordSystemEvent("warn", "webhook-novo-cliente", `person_id=${personId} sem telefone identificável`);
    return res.status(400).json({ error: "no contact phone available" });
  }

  const sock = getSock();
  if (!sock) {
    console.warn("[NOVO_CLIENTE] WhatsApp não conectado, retornando 503 pra Piperun retentar");
    recordSystemEvent("warn", "webhook-novo-cliente", "WhatsApp não conectado, retornando 503 pra Piperun retentar");
    return res.status(503).json({ error: "whatsapp not connected" });
  }

  let lookup;
  try {
    [lookup] = await sock.onWhatsApp(phone);
  } catch (err) {
    console.error(`[NOVO_CLIENTE] erro ao consultar onWhatsApp(${phone}): ${err?.message ?? err}`);
    recordSystemEvent("error", "webhook-novo-cliente", `erro ao consultar onWhatsApp(${phone}): ${err?.message ?? err}`);
    return res.status(502).json({ error: "whatsapp lookup failed" });
  }

  if (!lookup?.exists) {
    console.warn(`[NOVO_CLIENTE] número ${phone} não existe no WhatsApp — não enviando`);
    recordSystemEvent("warn", "webhook-novo-cliente", `número ${phone} não existe no WhatsApp (person_id=${personId}) — não enviando`);
    return res.status(404).json({ error: "phone not on whatsapp", phone });
  }

  const jid = lookup.jid;
  const canonicalPhone = phoneFromJid(jid);
  console.log(`[NOVO_CLIENTE] ${nome} (CRM phone=${phone}) → JID ${jid} (canonical=${canonicalPhone})`);
  ensureContact(canonicalPhone, jid);

  const recorded = recordWebhookDispatch(personId, stageId, jid, canonicalPhone);
  if (!recorded) {
    console.log(`[NOVO_CLIENTE] race - outro processo registrou primeiro person_id=${personId}`);
    return res.status(200).json({ status: "already_dispatched" });
  }

  const message = buildInitialMessage(nome);

  enqueue(jid, async () => {
    let sent = false;
    try {
      await sendWithPresence(sock, jid, message);
      sent = true;
      console.log(`[NOVO_CLIENTE] mensagem inicial enviada para ${jid}`);
    } catch (err) {
      console.error(`[NOVO_CLIENTE] erro ao ENVIAR mensagem para ${jid}: ${err?.message ?? err}`);
      recordSystemEvent("error", "webhook-novo-cliente", `erro ao enviar mensagem inicial para ${jid} (deal=${dealId}): ${err?.message ?? err}`);
    }

    if (sent) {
      try {
        const convId = getOrStartConversation(jid);
        addMessage(convId, "assistant", message);
        setConversationDealId(convId, dealId);
        console.log(`[NOVO_CLIENTE] gravado em conv_id=${convId} (deal_id=${dealId})`);
      } catch (err) {
        console.error(`[NOVO_CLIENTE] mensagem entregue mas erro ao persistir local: ${err?.message ?? err}`);
        recordSystemEvent("error", "webhook-novo-cliente", `mensagem entregue mas erro ao persistir local (deal=${dealId}): ${err?.message ?? err}`);
      }

      try {
        await moveDealToStage(dealId, DESTINATION_STAGE_ID);
        console.log(`[NOVO_CLIENTE] deal ${dealId} movido para stage ${DESTINATION_STAGE_ID}`);
      } catch (err) {
        console.error(`[NOVO_CLIENTE] erro ao mover deal ${dealId} para stage ${DESTINATION_STAGE_ID}: ${err?.message ?? err}`);
        recordSystemEvent("error", "webhook-novo-cliente", `erro ao mover deal ${dealId} para stage ${DESTINATION_STAGE_ID}: ${err?.message ?? err}`);
      }
    }
  });

  return res.status(202).json({ status: "queued", jid, deal_id: dealId });
}
