import {
  ensureContact,
  hasWebhookDispatched,
  recordWebhookDispatch,
  getOrStartConversation,
  addMessage,
  phoneFromJid,
  recordContratoParcela,
  markContratoParcelaPdfSent,
  countContratoParcelas,
  getContratoParcelas,
} from "../db.js";
import { sendWithPresence } from "../whatsapp/presence.js";
import { getSock } from "./index.js";
import { createCobranca, getBoletoPdf } from "../integrations/inter.js";

const TRIGGER_STAGE_ID = Number(process.env.INTER_CONTRATO_STAGE_ID ?? 654265);
const MULTA_PCT = Number(process.env.INTER_CONTRATO_MULTA_PCT ?? 2);
const MORA_PCT = Number(process.env.INTER_CONTRATO_MORA_PCT ?? 1);
const CONSULTOR_WHATSAPP = process.env.CONSULTOR_WHATSAPP ?? null;
const COBRANCA_DELAY_MS = Number(process.env.INTER_COBRANCA_DELAY_MS ?? 500);
const PDF_DELAY_MS = Number(process.env.INTER_PDF_DELAY_MS ?? 1500);

// Vencimentos: parcela 1 em emissão + 1 dia; demais espaçadas de 32 dias.
const VENC_PRIMEIRA_DIAS = Number(process.env.INTER_CONTRATO_VENC_PRIMEIRA_DIAS ?? 1);
const VENC_INTERVALO_DIAS = Number(process.env.INTER_CONTRATO_VENC_INTERVALO_DIAS ?? 32);

const DEFAULT_CLIENT_MESSAGE =
  "Oi, {{primeiro_nome}}! 😊\n\nSegue o(s) boleto(s) da consultoria: {{total_parcelas}}x de R$ {{valor}} 📄\n\nA primeira parcela vence amanhã. As demais a cada 32 dias.\n\nQualquer dúvida, conta comigo!";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function firstName(fullName) {
  return String(fullName ?? "").trim().split(/\s+/)[0] || "";
}

function titleCase(name) {
  const first = firstName(name);
  if (!first) return "";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function formatBrl(valor) {
  return Number(valor).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildClientMessage(nome, totalParcelas, valor) {
  const template = process.env.CONTRATO_MESSAGE_TEMPLATE ?? DEFAULT_CLIENT_MESSAGE;
  return template
    .replaceAll("{{primeiro_nome}}", titleCase(nome))
    .replaceAll("{{total_parcelas}}", String(totalParcelas))
    .replaceAll("{{valor}}", formatBrl(valor));
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
  let local = d;
  if ((d.length === 13 || d.length === 12) && d.startsWith("55")) local = d.slice(2);
  if (local.length < 10) return null;
  return { ddd: local.slice(0, 2), telefone: local.slice(2) };
}

function vencimentoAt(daysFromNow) {
  const d = new Date(Date.now() + daysFromNow * 86400_000);
  return d.toISOString().slice(0, 10);
}

function buildSeuNumero(dealId, parcelaN) {
  // máx 15 chars. "C<dealId>P<NN>" — truncamos o dealId se necessário.
  const parcelaStr = String(parcelaN).padStart(2, "0");
  const suffix = `P${parcelaStr}`; // ex "P01"
  const maxDealLen = 15 - 1 - suffix.length; // "C" + dealId + suffix
  return `C${String(dealId).slice(0, maxDealLen)}${suffix}`;
}

function validatePagador(person) {
  const missing = [];
  if (cleanDigits(person?.cpf).length !== 11) missing.push("cpf");
  const addr = person?.address ?? {};
  if (!addr?.street) missing.push("endereço");
  if (!addr?.district) missing.push("bairro");
  if (cleanDigits(addr?.postal_code).length !== 8) missing.push("cep");
  if (!person?.city?.name) missing.push("cidade");
  if (!person?.city?.uf) missing.push("uf");
  return missing;
}

// Parser do campo observation. Espera algo como "R$300 x12" ou "R$ 1.500,00 x6"
// Retorna { valor: number, parcelas: number } ou null se não conseguir.
const OBSERVATION_REGEX = /R\$\s*([\d.,]+)\s*x\s*(\d+)/i;

export function parseObservation(text) {
  if (!text) return null;
  const m = String(text).match(OBSERVATION_REGEX);
  if (!m) return null;
  const valorStr = m[1];
  const parcelas = Number(m[2]);
  if (!Number.isFinite(parcelas) || parcelas < 1 || parcelas > 99) return null;

  // Interpretação BR: ponto = milhar, vírgula = decimal.
  // Estratégia: remove pontos (separador de milhar), troca vírgula por ponto (decimal).
  const normalized = valorStr.replace(/\./g, "").replace(",", ".");
  const valor = Number(normalized);
  if (!Number.isFinite(valor) || valor < 2.5) return null;
  return { valor, parcelas };
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

function buildPayloadParcela({ dealId, person, parcelaN, valor, vencimento }) {
  const phone = pickPhone(person);
  const split = splitDddPhone(phone);
  const email = pickEmail(person);
  const addr = person.address ?? {};

  return {
    seuNumero: buildSeuNumero(dealId, parcelaN),
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
  const observation = payload?.observation;

  if (!dealId || !stageId || !personId) {
    console.warn("[CONTRATO] payload sem id/stage.id/person.id, ignorando");
    return res.status(400).json({ error: "missing id, stage.id or person.id" });
  }

  if (Number(stageId) !== TRIGGER_STAGE_ID) {
    console.log(`[CONTRATO] stage ${stageId} != ${TRIGGER_STAGE_ID}, ignorando`);
    return res.status(200).json({ status: "ignored_stage", stage_id: stageId });
  }

  const jaProcessadas = countContratoParcelas(dealId);
  if (hasWebhookDispatched(personId, stageId) || jaProcessadas > 0) {
    console.log(`[CONTRATO] já processado (deal ${dealId} / person ${personId} / parcelas=${jaProcessadas})`);
    return res.status(200).json({ status: "already_dispatched", parcelas_emitidas: jaProcessadas });
  }

  const sock = getSock();
  if (!sock) {
    console.warn("[CONTRATO] WhatsApp não conectado — retornando 503 pra retry");
    return res.status(503).json({ error: "whatsapp not connected" });
  }

  // Parsing do observation pra extrair valor e parcelas
  const parsed = parseObservation(observation);
  if (!parsed) {
    const msg = `[ALERTA] Lead "${nome}" (deal ${dealId}): não consegui ler o valor do contrato no campo Observação. Formato esperado: "R$XXX xNN" (ex: "R$300 x12"). Conteúdo atual: ${observation ? `"${String(observation).slice(0, 200)}"` : "vazio"}`;
    console.warn(`[CONTRATO] ${msg}`);
    await notifyConsultor(sock, msg);
    return res.status(200).json({ status: "invalid_observation" });
  }
  const { valor, parcelas } = parsed;

  // Validação do pagador (CPF, endereço)
  const missing = validatePagador(person);
  if (missing.length > 0) {
    const msg = `[ALERTA] Lead "${nome}" (deal ${dealId}) sem dados completos no CRM pra emitir boleto. Faltando: ${missing.join(", ")}.`;
    console.warn(`[CONTRATO] ${msg}`);
    await notifyConsultor(sock, msg);
    return res.status(200).json({ status: "missing_data", missing });
  }

  const phone = pickPhone(person);
  if (!phone) {
    const msg = `[ALERTA] Lead "${nome}" (deal ${dealId}) sem telefone.`;
    console.warn(`[CONTRATO] ${msg}`);
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
    await notifyConsultor(sock, msg);
    return res.status(200).json({ status: "phone_not_on_whatsapp", phone });
  }

  const jid = lookup.jid;
  const canonicalPhone = phoneFromJid(jid);
  ensureContact(canonicalPhone, jid);
  recordWebhookDispatch(personId, stageId, jid, canonicalPhone);

  console.log(`[CONTRATO] deal ${dealId} (${nome}) → emitindo ${parcelas}x R$ ${formatBrl(valor)}`);

  // Loop de emissão: cria todas as cobranças na Inter
  const emitidas = [];
  for (let n = 1; n <= parcelas; n++) {
    const diasAteVencer = VENC_PRIMEIRA_DIAS + VENC_INTERVALO_DIAS * (n - 1);
    const vencimento = vencimentoAt(diasAteVencer);
    const interPayload = buildPayloadParcela({ dealId, person, parcelaN: n, valor, vencimento });
    try {
      const cobranca = await createCobranca(interPayload);
      const codigo = cobranca?.codigoSolicitacao;
      recordContratoParcela({
        deal_id: dealId,
        parcela_n: n,
        total_parcelas: parcelas,
        codigo_solicitacao: codigo,
        seu_numero: interPayload.seuNumero,
        valor_nominal: valor,
        data_vencimento: vencimento,
      });
      emitidas.push({ n, codigo, seuNumero: interPayload.seuNumero, vencimento });
      console.log(`[CONTRATO] deal ${dealId} → parcela ${n}/${parcelas} emitida (codigo=${codigo}, vence ${vencimento})`);
    } catch (err) {
      const msg = `[ERRO] Lead "${nome}" (deal ${dealId}): falha ao emitir parcela ${n}/${parcelas}: ${err?.message ?? err}. ${emitidas.length} parcelas anteriores foram emitidas e podem ser canceladas pelo painel Inter.`;
      console.error(`[CONTRATO] ${msg}`);
      await notifyConsultor(sock, msg);
      return res.status(502).json({ error: "inter create failed", parcela_falha: n, parcelas_emitidas: emitidas.length });
    }
    if (n < parcelas) await sleep(COBRANCA_DELAY_MS);
  }

  // Aguarda Inter disponibilizar os PDFs
  await sleep(2000);

  // Baixa todos os PDFs antes de mandar (falhar em algum não deixa o cliente com lista parcial)
  const pdfs = [];
  for (const { n, codigo, seuNumero } of emitidas) {
    try {
      const pdf = await getBoletoPdf(codigo);
      pdfs.push({ n, codigo, seuNumero, pdf });
    } catch (err) {
      const msg = `[ERRO] Lead "${nome}" (deal ${dealId}): falha ao baixar PDF da parcela ${n}/${parcelas} (codigo=${codigo}): ${err?.message ?? err}`;
      console.error(`[CONTRATO] ${msg}`);
      await notifyConsultor(sock, msg);
      return res.status(502).json({ error: "inter pdf failed", parcela_falha: n });
    }
    await sleep(PDF_DELAY_MS);
  }

  // Envia mensagem + todos os PDFs
  const clientMessage = buildClientMessage(nome, parcelas, valor);
  try {
    await sendWithPresence(sock, jid, clientMessage);
    for (const { n, pdf, seuNumero } of pdfs) {
      const filename = `Boleto Travus ${titleCase(nome)} - parcela ${String(n).padStart(2, "0")} de ${String(parcelas).padStart(2, "0")}.pdf`;
      await sock.sendMessage(jid, {
        document: pdf,
        mimetype: "application/pdf",
        fileName: filename,
      });
      markContratoParcelaPdfSent(dealId, n);
      console.log(`[CONTRATO] deal ${dealId} → parcela ${n}/${parcelas} enviada (${seuNumero})`);
      await sleep(PDF_DELAY_MS);
    }

    try {
      const convId = getOrStartConversation(jid);
      addMessage(convId, "assistant", clientMessage);
    } catch (err) {
      console.warn(`[CONTRATO] não foi possível persistir msg local: ${err?.message ?? err}`);
    }

    console.log(`[CONTRATO] deal ${dealId} (${nome}) → todos os ${parcelas} boletos entregues para ${jid}`);
  } catch (err) {
    const msg = `[ERRO] Lead "${nome}" (deal ${dealId}): boletos emitidos mas falhou envio no WhatsApp: ${err?.message ?? err}`;
    console.error(`[CONTRATO] ${msg}`);
    await notifyConsultor(sock, msg);
    return res.status(502).json({ error: "whatsapp send failed" });
  }

  return res.status(202).json({
    status: "sent",
    deal_id: dealId,
    parcelas,
    valor,
    parcelas_emitidas: getContratoParcelas(dealId).map((p) => ({
      parcela_n: p.parcela_n,
      codigo_solicitacao: p.codigo_solicitacao,
      data_vencimento: p.data_vencimento,
    })),
  });
}
