import {
  ensureContact,
  hasWebhookDispatched,
  recordWebhookDispatch,
  phoneFromJid,
  getOrStartConversation,
  recordLeadCapture,
  recordSystemEvent,
} from "../db.js";
import { enqueue } from "../whatsapp/queue.js";
import { sendWithPresence } from "../whatsapp/presence.js";
import {
  findEventByDealTitle,
  enrichEventDescriptionWithPhone,
  formatEventDateTimeBRT,
} from "../integrations/calendar.js";
import { getSock } from "./index.js";

const STAGE_ID = Number(process.env.CONFIRMACAO_INVITE_STAGE_ID ?? 648386);
const TRIGGER_TYPE = process.env.CONFIRMACAO_INVITE_TRIGGER_TYPE ?? "Uma oportunidade for ganha";
const RETRY_MS = Number(process.env.CONFIRMACAO_INVITE_RETRY_MS ?? 3000);
const MAX_RETRIES = Number(process.env.CONFIRMACAO_INVITE_MAX_RETRIES ?? 3);

const DEFAULT_TEMPLATE =
  "Oi {{primeiro_nome}}, confirmando nosso bate-papo para {{data}} às {{hora}}hrs. Veja se você recebeu o convite no seu e-mail ou se já aparece direto na sua agenda, por favor?";
const DEFAULT_FALLBACK_TEMPLATE =
  "Oi {{primeiro_nome}}, confirmando nosso bate-papo. Veja se você recebeu o convite no seu e-mail ou se já aparece direto na sua agenda, por favor?";

function firstName(fullName) {
  const raw = String(fullName ?? "").trim().split(/\s+/)[0] ?? "";
  if (!raw) return "";
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function pickPhone(contactPhones) {
  if (!Array.isArray(contactPhones) || contactPhones.length === 0) return null;
  const main = contactPhones.find((p) => p?.is_main === true || p?.is_main === 1);
  const chosen = main ?? contactPhones[0];
  return chosen?.number ?? null;
}

function pickEmail(contactEmails) {
  if (!Array.isArray(contactEmails) || contactEmails.length === 0) return null;
  return contactEmails[0]?.address ?? null;
}

function renderTemplate(tpl, vars) {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, v ?? ""),
    tpl,
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function locateEventWithRetry({ dealTitle, firstName, closedAt }) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const ev = await findEventByDealTitle({ dealTitle, firstName, closedAt });
      if (ev) return ev;
    } catch (err) {
      console.error(`[CONFIRMA-INVITE] erro ao buscar evento (tentativa ${attempt}): ${err?.message ?? err}`);
    }
    if (attempt < MAX_RETRIES) await sleep(RETRY_MS);
  }
  return null;
}

export async function confirmacaoInviteWebhookHandler(req, res) {
  const payload = req.body ?? {};
  const personId = payload?.person?.id;
  const stageId = payload?.stage?.id;
  const status = payload?.status;

  recordSystemEvent("info", "webhook-confirmacao-invite", `recebido: stage=${stageId ?? "?"} person=${personId ?? "?"} status=${status ?? "?"}`);

  const triggerType = payload?.action?.trigger_type;
  const dealTitle = payload?.title;
  const nome = payload?.person?.name;
  const phone = pickPhone(payload?.person?.contact_phones);
  const email = pickEmail(payload?.person?.contact_emails);
  const closedAt = payload?.closed_at;

  if (!personId || !stageId) {
    console.warn("[CONFIRMA-INVITE] payload sem person.id ou stage.id, ignorando");
    recordSystemEvent("warn", "webhook-confirmacao-invite", "payload sem person.id ou stage.id, ignorando");
    return res.status(400).json({ error: "missing person.id or stage.id" });
  }

  if (Number(stageId) !== STAGE_ID) {
    return res.status(200).json({ status: "ignored", reason: "stage_mismatch", stage_id: stageId });
  }

  if (Number(status) !== 1) {
    return res.status(200).json({ status: "ignored", reason: "not_won", status });
  }

  if (triggerType && triggerType !== TRIGGER_TYPE) {
    return res.status(200).json({ status: "ignored", reason: "trigger_mismatch", trigger: triggerType });
  }

  if (!phone) {
    console.warn(`[CONFIRMA-INVITE] person_id=${personId} sem telefone identificável`);
    recordSystemEvent("warn", "webhook-confirmacao-invite", `person_id=${personId} sem telefone identificável`);
    return res.status(400).json({ error: "no contact phone in payload" });
  }

  if (hasWebhookDispatched(personId, stageId)) {
    console.log(`[CONFIRMA-INVITE] já enviado person_id=${personId} stage_id=${stageId}, ignorando`);
    return res.status(200).json({ status: "already_dispatched" });
  }

  const sock = getSock();
  if (!sock) {
    console.warn("[CONFIRMA-INVITE] WhatsApp não conectado, retornando 503 pra Piperun retentar");
    recordSystemEvent("warn", "webhook-confirmacao-invite", "WhatsApp não conectado, retornando 503 pra Piperun retentar");
    return res.status(503).json({ error: "whatsapp not connected" });
  }

  let onWa;
  try {
    [onWa] = await sock.onWhatsApp(phone);
  } catch (err) {
    console.error(`[CONFIRMA-INVITE] erro onWhatsApp(${phone}): ${err?.message ?? err}`);
    recordSystemEvent("error", "webhook-confirmacao-invite", `erro onWhatsApp(${phone}): ${err?.message ?? err}`);
    return res.status(502).json({ error: "whatsapp lookup failed" });
  }

  if (!onWa?.exists) {
    console.warn(`[CONFIRMA-INVITE] número ${phone} não existe no WhatsApp — não enviando`);
    recordSystemEvent("warn", "webhook-confirmacao-invite", `número ${phone} não existe no WhatsApp (person_id=${personId}) — não enviando`);
    return res.status(404).json({ error: "phone not on whatsapp", phone });
  }

  const jid = onWa.jid;
  const canonicalPhone = phoneFromJid(jid);
  ensureContact(canonicalPhone, jid);

  const recorded = recordWebhookDispatch(personId, stageId, jid, canonicalPhone);
  if (!recorded) {
    console.log(`[CONFIRMA-INVITE] race - outro processo registrou primeiro person_id=${personId}`);
    return res.status(200).json({ status: "already_dispatched" });
  }

  const primeiro = firstName(nome);

  res.status(202).json({ status: "queued", jid });

  enqueue(jid, async () => {
    const event = await locateEventWithRetry({
      dealTitle,
      firstName: primeiro,
      closedAt,
    });

    let dataAgendamento = null;
    let horaAgendamento = null;
    let message;
    if (event?.start?.dateTime) {
      const { data, hora } = formatEventDateTimeBRT(event.start.dateTime);
      dataAgendamento = data;
      horaAgendamento = hora;
      const tpl = process.env.CONFIRMACAO_INVITE_TEMPLATE ?? DEFAULT_TEMPLATE;
      message = renderTemplate(tpl, { primeiro_nome: primeiro, data, hora });

      try {
        await enrichEventDescriptionWithPhone(event.id, canonicalPhone);
        console.log(`[CONFIRMA-INVITE] evento ${event.id} enriquecido com telefone ${canonicalPhone}`);
      } catch (err) {
        console.error(`[CONFIRMA-INVITE] falha ao enriquecer evento ${event.id}: ${err?.message ?? err}`);
      }
    } else {
      console.warn(`[CONFIRMA-INVITE] evento não encontrado após retries para deal="${dealTitle}" — usando fallback`);
      const tpl = process.env.CONFIRMACAO_INVITE_FALLBACK_TEMPLATE ?? DEFAULT_FALLBACK_TEMPLATE;
      message = renderTemplate(tpl, { primeiro_nome: primeiro });
    }

    try {
      const convId = getOrStartConversation(jid);
      recordLeadCapture(convId, {
        nome,
        celular: canonicalPhone,
        email,
        data_agendamento: dataAgendamento,
        hora_agendamento: horaAgendamento,
      });
      console.log(`[CONFIRMA-INVITE] lead registrado no DB: conv=${convId} celular=${canonicalPhone}`);
    } catch (err) {
      console.error(`[CONFIRMA-INVITE] falha ao registrar lead no DB: ${err?.message ?? err}`);
      recordSystemEvent("error", "webhook-confirmacao-invite", `falha ao registrar lead no DB (person_id=${personId}): ${err?.message ?? err}`);
    }

    try {
      await sendWithPresence(sock, jid, message);
      console.log(`[CONFIRMA-INVITE] enviado person_id=${personId} → ${jid}`);
    } catch (err) {
      console.error(`[CONFIRMA-INVITE] erro ao enviar para ${jid}: ${err?.message ?? err}`);
      recordSystemEvent("error", "webhook-confirmacao-invite", `erro ao enviar confirmação para ${jid} (person_id=${personId}): ${err?.message ?? err}`);
    }
  });
}
