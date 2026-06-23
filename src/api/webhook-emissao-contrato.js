import {
  ensureContact,
  hasWebhookDispatched,
  recordWebhookDispatch,
  getOrStartConversation,
  addMessage,
  phoneFromJid,
  recordBoletoEmitido,
  markBoletoEmitidoPdfSent,
  recordBoletoEmitidoError,
  hasBoletoEmitido,
} from "../db.js";
import { sendWithPresence } from "../whatsapp/presence.js";
import { getSock } from "./index.js";
import { createCobranca, getBoletoPdf } from "../integrations/inter.js";

const TRIGGER_STAGE_ID = Number(process.env.INTER_CONTRATO_STAGE_ID ?? 654265);
const VALOR_NOMINAL = Number(process.env.INTER_CONTRATO_VALOR_NOMINAL ?? 300);
const VENCIMENTO_DIAS = Number(process.env.INTER_CONTRATO_VENCIMENTO_DIAS ?? 10);
const MULTA_PCT = Number(process.env.INTER_CONTRATO_MULTA_PCT ?? 2);
const MORA_PCT = Number(process.env.INTER_CONTRATO_MORA_PCT ?? 1);
const CONSULTOR_WHATSAPP = process.env.CONSULTOR_WHATSAPP ?? null;

const CLIENT_MESSAGE_TEMPLATE =
  process.env.CONTRATO_MESSAGE_TEMPLATE ??
  "Oi, {{primeiro_nome}}! 😊\n\nSegue o boleto da consultoria 📄\n\nQualquer dúvida, conta comigo!";

function firstName(fullName) {
  return String(fullName ?? "").trim().split(/\s+/)[0] || "";
}

function titleCase(name) {
  const first = firstName(name);
  if (!first) return "";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function buildClientMessage(nome) {
  return CLIENT_MESSAGE_TEMPLATE.replaceAll("{{primeiro_nome}}", titleCase(nome));
}

function pickPhone(person) {
  const phones = person?.contact_phones;
  if (!Array.isArray(phones) || phones.length === 0) return null;
  const main = phones.find((p) => p?.is_main === true || p?.is_main === 1);
  return (main ?? phones[0])?.number ?? null;
}

function pickEmail(person) {
  const emails = person?.contact_emails;
  if (!Array.isArray(emails) || emails.length === 0) return null;
  const main = emails.find((e) => e?.is_main === true || e?.is_main === 1);
  return (main ?? emails[0])?.address ?? null;
}

function cleanDigits(s) {
  return String(s ?? "").replace(/\D/g, "");
}

function splitDddPhone(phone) {
  const d = cleanDigits(phone);
  // formato esperado: 55 + DDD(2) + número(8 ou 9). Tolera DDI ausente.
  let local = d;
  if (d.length === 13 && d.startsWith("55")) local = d.slice(2);
  else if (d.length === 12 && d.startsWith("55")) local = d.slice(2);
  if (local.length < 10) return null;
  return { ddd: local.slice(0, 2), telefone: local.slice(2) };
}

function vencimentoDate(daysFromNow) {
  const d = new Date(Date.now() + daysFromNow * 86400_000);
  return d.toISOString().slice(0, 10);
}

function buildSeuNumero(dealId) {
  // máx 15 chars. Prefixo "C" + deal id (truncado por segurança).
  return `C${String(dealId).slice(0, 14)}`;
}

function validatePagador(person) {
  const missing = [];
  const cpf = cleanDigits(person?.cpf);
  if (!cpf || cpf.length !== 11) missing.push("cpf");

  const addr = person?.address ?? {};
  if (!addr?.street) missing.push("endereço");
  if (!addr?.district) missing.push("bairro");
  if (!cleanDigits(addr?.postal_code) || cleanDigits(addr?.postal_code).length !== 8)
    missing.push("cep");

  if (!person?.city?.name) missing.push("cidade");
  if (!person?.city?.uf) missing.push("uf");

  return missing;
}

async function notifyConsultor(sock, message) {
  if (!CONSULTOR_WHATSAPP || !sock) return;
  const jid = `${cleanDigits(CONSULTOR_WHATSAPP)}@s.whatsapp.net`;
  try {
    await sendWithPresence(sock, jid, message);
    console.log(`[CONTRATO] consultor notificado → ${jid}`);
  } catch (err) {
    console.error(`[CONTRATO] falha ao notificar consultor: ${err?.message ?? err}`);
  }
}

function buildPayload({ dealId, person, valor, vencimento }) {
  const phone = pickPhone(person);
  const split = splitDddPhone(phone);
  const email = pickEmail(person);
  const addr = person.address ?? {};

  return {
    seuNumero: buildSeuNumero(dealId),
    valorNominal: valor,
    dataVencimento: vencimento,
    numDiasAgenda: 60,
    pagador: {
      cpfCnpj: cleanDigits(person.cpf),
      tipoPessoa: "FISICA",
      nome: person.name,
      ...(email ? { email } : {}),
      ...(split ? { ddd: split.ddd, telefone: split.telefone } : {}),
      endereco: addr.street + (addr.number ? `, ${addr.number}` : ""),
      ...(addr.complement ? { complemento: addr.complement } : {}),
      bairro: addr.district,
      cidade: person.city.name,
      uf: person.city.uf,
      cep: cleanDigits(addr.postal_code),
    },
    multa: { taxa: MULTA_PCT, codigo: "PERCENTUAL" },
    mora: { taxa: MORA_PCT, codigo: "TAXAMENSAL" },
  };
}

export async function emissaoContratoWebhookHandler(req, res) {
  const payload = req.body ?? {};
  const dealId = payload?.id;
  const stageId = payload?.stage?.id;
  const personId = payload?.person?.id;
  const person = payload?.person;
  const nome = person?.name ?? "(sem nome)";

  if (!dealId || !stageId || !personId) {
    console.warn("[CONTRATO] payload sem id/stage.id/person.id, ignorando");
    return res.status(400).json({ error: "missing id, stage.id or person.id" });
  }

  if (Number(stageId) !== TRIGGER_STAGE_ID) {
    console.log(`[CONTRATO] stage ${stageId} != ${TRIGGER_STAGE_ID}, ignorando`);
    return res.status(200).json({ status: "ignored_stage", stage_id: stageId });
  }

  if (hasWebhookDispatched(personId, stageId) || hasBoletoEmitido(dealId)) {
    console.log(`[CONTRATO] já processado (deal ${dealId} / person ${personId})`);
    return res.status(200).json({ status: "already_dispatched" });
  }

  const sock = getSock();
  if (!sock) {
    console.warn("[CONTRATO] WhatsApp não conectado — retornando 503 pra retry");
    return res.status(503).json({ error: "whatsapp not connected" });
  }

  // Validação de dados antes de qualquer side-effect na Inter
  const missing = validatePagador(person);
  if (missing.length > 0) {
    const msg = `[ALERTA] Lead "${nome}" (deal ${dealId}) sem dados completos no CRM pra emitir boleto. Faltando: ${missing.join(", ")}.`;
    console.warn(`[CONTRATO] ${msg}`);
    recordBoletoEmitidoError(dealId, msg);
    await notifyConsultor(sock, msg);
    return res.status(200).json({ status: "missing_data", missing });
  }

  const phone = pickPhone(person);
  if (!phone) {
    const msg = `[ALERTA] Lead "${nome}" (deal ${dealId}) sem telefone — não foi possível emitir boleto.`;
    console.warn(`[CONTRATO] ${msg}`);
    recordBoletoEmitidoError(dealId, msg);
    await notifyConsultor(sock, msg);
    return res.status(200).json({ status: "missing_phone" });
  }

  let lookup;
  try {
    [lookup] = await sock.onWhatsApp(phone);
  } catch (err) {
    console.error(`[CONTRATO] erro onWhatsApp(${phone}): ${err?.message ?? err}`);
    return res.status(502).json({ error: "whatsapp lookup failed" });
  }
  if (!lookup?.exists) {
    const msg = `[ALERTA] Lead "${nome}" (deal ${dealId}) — número ${phone} não existe no WhatsApp.`;
    console.warn(`[CONTRATO] ${msg}`);
    recordBoletoEmitidoError(dealId, msg);
    await notifyConsultor(sock, msg);
    return res.status(200).json({ status: "phone_not_on_whatsapp", phone });
  }

  const jid = lookup.jid;
  const canonicalPhone = phoneFromJid(jid);
  ensureContact(canonicalPhone, jid);
  recordWebhookDispatch(personId, stageId, jid, canonicalPhone);

  const vencimento = vencimentoDate(VENCIMENTO_DIAS);
  const interPayload = buildPayload({ dealId, person, valor: VALOR_NOMINAL, vencimento });

  let cobranca;
  try {
    cobranca = await createCobranca(interPayload);
    console.log(`[CONTRATO] deal ${dealId} → cobrança criada codigoSolicitacao=${cobranca?.codigoSolicitacao}`);
  } catch (err) {
    const msg = `[ERRO] Falha ao emitir boleto pro lead "${nome}" (deal ${dealId}): ${err?.message ?? err}`;
    console.error(`[CONTRATO] ${msg}`);
    recordBoletoEmitidoError(dealId, msg);
    await notifyConsultor(sock, msg);
    return res.status(502).json({ error: "inter create failed" });
  }

  const codigo = cobranca?.codigoSolicitacao;
  recordBoletoEmitido({
    deal_id: dealId,
    person_id: personId,
    codigo_solicitacao: codigo,
    seu_numero: interPayload.seuNumero,
    valor_nominal: VALOR_NOMINAL,
    data_vencimento: vencimento,
  });

  // Pequena pausa: Inter pode levar 1-2s pra disponibilizar o PDF
  await new Promise((r) => setTimeout(r, 2000));

  let pdfBuffer;
  try {
    pdfBuffer = await getBoletoPdf(codigo);
  } catch (err) {
    const msg = `[ERRO] Boleto criado (codigo=${codigo}) mas falhou ao baixar PDF pro lead "${nome}" (deal ${dealId}): ${err?.message ?? err}`;
    console.error(`[CONTRATO] ${msg}`);
    await notifyConsultor(sock, msg);
    return res.status(502).json({ error: "inter pdf failed", codigo_solicitacao: codigo });
  }

  const clientMessage = buildClientMessage(nome);
  try {
    await sendWithPresence(sock, jid, clientMessage);
    await sock.sendMessage(jid, {
      document: pdfBuffer,
      mimetype: "application/pdf",
      fileName: `Boleto Travus Capital - ${titleCase(nome)}.pdf`,
    });
    markBoletoEmitidoPdfSent(dealId);

    try {
      const convId = getOrStartConversation(jid);
      addMessage(convId, "assistant", clientMessage);
    } catch (err) {
      console.warn(`[CONTRATO] não foi possível persistir msg na conversa local: ${err?.message ?? err}`);
    }

    console.log(`[CONTRATO] deal ${dealId} (${nome}) → boleto enviado para ${jid}`);
  } catch (err) {
    const msg = `[ERRO] Boleto criado (codigo=${codigo}) mas falhou ao enviar pelo WhatsApp pro lead "${nome}" (deal ${dealId}): ${err?.message ?? err}`;
    console.error(`[CONTRATO] ${msg}`);
    await notifyConsultor(sock, msg);
    return res.status(502).json({ error: "whatsapp send failed", codigo_solicitacao: codigo });
  }

  return res.status(202).json({
    status: "sent",
    deal_id: dealId,
    codigo_solicitacao: codigo,
    jid,
  });
}
