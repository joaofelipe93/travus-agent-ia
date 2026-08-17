import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ensureContact,
  hasWebhookDispatched,
  recordWebhookDispatch,
  phoneFromJid,
  recordSystemEvent,
} from "../db.js";
import { enqueue } from "../whatsapp/queue.js";
import { sendWithPresence } from "../whatsapp/presence.js";
import { saudacaoBrasilia } from "../utils/saudacao.js";
import { getSock } from "./index.js";

const PDF_PATH = process.env.WEBHOOK_PDF_PATH ?? "src/assets/material.pdf";
const PDF_FILENAME = process.env.WEBHOOK_PDF_FILENAME ?? "Travus Capital.pdf";

function firstName(fullName) {
  return String(fullName ?? "").trim().split(/\s+/)[0] || "";
}

function pickPhone(contactPhones) {
  if (!Array.isArray(contactPhones) || contactPhones.length === 0) return null;
  const main = contactPhones.find((p) => p?.is_main === true);
  const chosen = main ?? contactPhones[0];
  return chosen?.number ?? null;
}

function jidFromPhone(phone) {
  return `${phone}@s.whatsapp.net`;
}

function buildMessage(nome) {
  const primeiro = firstName(nome);
  const saudacao = saudacaoBrasilia().toLowerCase();
  const ola = primeiro ? `Oi ${primeiro}` : "Oi";
  return `${ola}, ${saudacao}! Tudo bom? É a Ana da Travus Capital.\n\nAproveito para deixar nosso material da empresa, para você nos conhecer um pouco mais, enquanto fazemos o seu estudo para o próximo encontro.`;
}

export async function piperunWebhookHandler(req, res) {
  const payload = req.body ?? {};
  const personId = payload?.person?.id;
  const stageId = payload?.stage?.id;
  const nome = payload?.person?.name;
  const phone = pickPhone(payload?.person?.contact_phones);

  recordSystemEvent("info", "webhook-piperun", `recebido: stage=${stageId ?? "?"} person=${personId ?? "?"}`);

  if (!personId || !stageId) {
    console.warn("[WEBHOOK] payload sem person.id ou stage.id, ignorando");
    return res.status(400).json({ error: "missing person.id or stage.id" });
  }

  if (!phone) {
    console.warn(`[WEBHOOK] person_id=${personId} sem telefone identificável`);
    return res.status(400).json({ error: "no contact phone in payload" });
  }

  if (hasWebhookDispatched(personId, stageId)) {
    console.log(`[WEBHOOK] já enviado para person_id=${personId} stage_id=${stageId}, ignorando`);
    return res.status(200).json({ status: "already_dispatched" });
  }

  const sock = getSock();
  if (!sock) {
    console.warn("[WEBHOOK] WhatsApp não conectado, retornando 503 pra Piperun retentar");
    return res.status(503).json({ error: "whatsapp not connected" });
  }

  let result;
  try {
    [result] = await sock.onWhatsApp(phone);
  } catch (err) {
    console.error(`[WEBHOOK] erro ao consultar onWhatsApp(${phone}): ${err?.message ?? err}`);
    return res.status(502).json({ error: "whatsapp lookup failed" });
  }

  if (!result?.exists) {
    console.warn(`[WEBHOOK] número ${phone} não existe no WhatsApp — não enviando`);
    return res.status(404).json({ error: "phone not on whatsapp", phone });
  }

  const jid = result.jid;
  const canonicalPhone = phoneFromJid(jid);
  console.log(`[WEBHOOK] número CRM=${phone} resolvido para JID ${jid} (canonical=${canonicalPhone})`);
  ensureContact(canonicalPhone, jid);

  const recorded = recordWebhookDispatch(personId, stageId, jid, canonicalPhone);
  if (!recorded) {
    console.log(`[WEBHOOK] race - outro processo registrou primeiro person_id=${personId}`);
    return res.status(200).json({ status: "already_dispatched" });
  }

  const text = buildMessage(nome);
  console.log(`[WEBHOOK] disparando person_id=${personId} stage="${payload?.stage?.name ?? "?"}" → ${jid}`);

  enqueue(jid, async () => {
    try {
      await sendWithPresence(sock, jid, text);

      const pdfBuffer = readFileSync(resolve(PDF_PATH));
      await sock.sendMessage(jid, {
        document: pdfBuffer,
        mimetype: "application/pdf",
        fileName: PDF_FILENAME,
      });

      console.log(`[WEBHOOK] enviado: msg + PDF para ${jid}`);
    } catch (err) {
      console.error(`[WEBHOOK] erro ao enviar para ${jid}: ${err?.message ?? err}`);
    }
  });

  return res.status(202).json({ status: "queued", jid });
}
