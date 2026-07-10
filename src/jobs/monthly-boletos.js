import {
  listDealsByStage,
  getPerson,
  extractCpfFromPerson,
  extractPhoneFromPerson,
} from "../api/piperun-api.js";
import { findCotasByCpf, generateBills, fetchOverdueBillPdf } from "../integrations/canopus.js";
import {
  upsertBoletoClient,
  recordBoletoSent,
  hasBoletoBeenSent,
} from "../db.js";
import { sendWithPresence } from "../whatsapp/presence.js";

const STAGE_ID = Number(process.env.PIPERUN_BOLETOS_STAGE_ID ?? 679217);
const PACING_MS = Number(process.env.BOLETOS_PACING_MS ?? 3000);
const BILL_PACING_MS = Number(process.env.BOLETOS_BILL_PACING_MS ?? 1500);
const DEFAULT_MESSAGE =
  "Oi, {{primeiro_nome}}! 😊\n\nTudo bem?\n\nEstou te encaminhando as informações referentes ao seu investimento deste mês.\n\nCada etapa cumprida é mais um passo na construção do patrimônio que estamos planejando juntos.\n\nMantendo tudo em dia, você segue participando normalmente da próxima assembleia e das oportunidades de contemplação do grupo.\n\nCaso o pagamento já tenha sido realizado, pode desconsiderar esta mensagem.\n\nSeguimos juntos nessa jornada! 🚀";

function formatFirstName(fullName) {
  const raw = String(fullName ?? "").trim().split(/\s+/)[0] ?? "";
  if (!raw) return "";
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function pickPhone(person, deal) {
  return extractPhoneFromPerson(person) ?? extractPhoneFromPerson(deal?.person);
}

function buildMessage(nome, count) {
  const template = process.env.BOLETOS_MESSAGE_TEMPLATE ?? DEFAULT_MESSAGE;
  const boletosLabel = count === 1 ? "o boleto" : "os boletos";
  const anexoLabel = count === 1 ? "Anexo o boleto" : "Anexo os boletos";
  return template
    .replaceAll("{{primeiro_nome}}", formatFirstName(nome))
    .replaceAll("{{boletos_label}}", boletosLabel)
    .replaceAll("{{anexo_label}}", anexoLabel);
}

function buildPdfFilename(parcelNumber, grupo, cota) {
  const parcel = parcelNumber || "boleto";
  return `Boleto ${grupo}-${cota} parcela ${parcel}.pdf`;
}

async function resolveJid(sock, phone) {
  try {
    const [lookup] = await sock.onWhatsApp(phone);
    if (lookup?.exists) return lookup.jid;
  } catch {}
  return null;
}

function extractPersonId(deal) {
  return deal?.person?.id ?? deal?.person_id ?? deal?.contact_id ?? deal?.person?.person_id ?? null;
}

async function processDeal(sock, deal) {
  const dealId = deal?.id;
  if (!dealId) {
    console.warn("[BOLETOS] deal sem id, pulando");
    return { ok: false, reason: "deal_sem_id" };
  }

  const personId = extractPersonId(deal);
  if (!personId) {
    console.warn(`[BOLETOS] deal ${dealId} sem person.id (chaves disponíveis: ${Object.keys(deal ?? {}).join(", ")}), pulando`);
    return { ok: false, reason: "sem_person_id" };
  }

  let person;
  try {
    person = await getPerson(personId);
  } catch (err) {
    console.error(`[BOLETOS] deal ${dealId} → erro getPerson(${personId}): ${err?.message ?? err}`);
    return { ok: false, reason: "getPerson_falhou" };
  }
  if (!person) {
    console.warn(`[BOLETOS] deal ${dealId} → person ${personId} não encontrada`);
    return { ok: false, reason: "person_nao_encontrada" };
  }

  const nome = person?.name ?? deal?.person?.name ?? "";
  const cpf = extractCpfFromPerson(person);
  const phone = pickPhone(person, deal);

  if (!cpf) {
    console.warn(`[BOLETOS] deal ${dealId} (${nome}) sem CPF identificável no Piperun, pulando`);
    upsertBoletoClient({ deal_id: dealId, person_id: personId, cpf: null, nome, phone, jid: null });
    return { ok: false, reason: "sem_cpf" };
  }

  if (!phone) {
    console.warn(`[BOLETOS] deal ${dealId} (${nome}, cpf=${cpf}) sem telefone, pulando`);
    upsertBoletoClient({ deal_id: dealId, person_id: personId, cpf, nome, phone: null, jid: null });
    return { ok: false, reason: "sem_telefone" };
  }

  const jid = await resolveJid(sock, phone);
  upsertBoletoClient({ deal_id: dealId, person_id: personId, cpf, nome, phone, jid });

  if (!jid) {
    console.warn(`[BOLETOS] deal ${dealId} (${nome}) telefone ${phone} não existe no WhatsApp, pulando`);
    return { ok: false, reason: "fora_do_whatsapp" };
  }

  let cotas;
  try {
    cotas = await findCotasByCpf(cpf);
  } catch (err) {
    console.error(`[BOLETOS] deal ${dealId} (cpf=${cpf}) → erro findCotasByCpf: ${err?.message ?? err}`);
    return { ok: false, reason: "find_cota_falhou" };
  }
  if (cotas.length === 0) {
    console.warn(`[BOLETOS] deal ${dealId} (cpf=${cpf}) sem cotas no canopus`);
    return { ok: false, reason: "sem_cotas" };
  }

  let alreadySent = 0;
  let difSkipped = 0;
  const pendingBills = [];

  for (const cota of cotas) {
    const { CD_Grupo: grupo, CD_Cota: cotaCode, ID_Cota: idCota } = cota;
    if (!grupo || !cotaCode || !idCota) {
      console.warn(`[BOLETOS] deal ${dealId} cota com campos faltantes: ${JSON.stringify(cota)}`);
      continue;
    }

    let bills;
    try {
      bills = await generateBills(grupo, cotaCode, idCota);
    } catch (err) {
      console.error(`[BOLETOS] deal ${dealId} cota ${grupo}/${cotaCode} → erro generateBills: ${err?.message ?? err}`);
      continue;
    }

    for (const bill of bills) {
      const billId = bill?.id;
      const transactionId = bill?.transactionId;
      if (!billId || !transactionId) {
        console.warn(`[BOLETOS] deal ${dealId} bill incompleto: ${JSON.stringify(bill)}`);
        continue;
      }
      if (bill?.parcelNumber === "DIF") {
        difSkipped += 1;
        continue;
      }
      if (hasBoletoBeenSent(dealId, billId)) {
        alreadySent += 1;
        continue;
      }
      pendingBills.push({ bill, billId, transactionId, grupo, cotaCode });
    }
  }

  let pdfsEnviados = 0;

  if (pendingBills.length === 0) {
    return {
      ok: true,
      pdfsEnviados,
      alreadySent,
      difSkipped,
      reason: alreadySent === 0 ? "sem_bills" : null,
    };
  }

  const message = buildMessage(nome, pendingBills.length);

  for (const { bill, billId, transactionId, grupo, cotaCode } of pendingBills) {
    let pdfBuffer;
    try {
      pdfBuffer = await fetchOverdueBillPdf(grupo, cotaCode, billId, transactionId);
    } catch (err) {
      console.error(`[BOLETOS] deal ${dealId} bill ${billId} → erro fetchOverdueBillPdf: ${err?.message ?? err}`);
      await sleep(BILL_PACING_MS);
      continue;
    }

    const filename = buildPdfFilename(bill?.parcelNumber, grupo, cotaCode);

    try {
      if (pdfsEnviados === 0) {
        await sendWithPresence(sock, jid, message);
      }
      await sock.sendMessage(jid, {
        document: pdfBuffer,
        mimetype: "application/pdf",
        fileName: filename,
      });
      recordBoletoSent({
        deal_id: dealId,
        bill_id: billId,
        parcel_number: bill?.parcelNumber,
        group_code: grupo,
        cota_code: cotaCode,
        transaction_id: transactionId,
      });
      pdfsEnviados += 1;
      console.log(`[BOLETOS] deal ${dealId} (${nome}) → boleto ${filename} enviado para ${jid}`);
    } catch (err) {
      console.error(`[BOLETOS] deal ${dealId} bill ${billId} → erro envio whatsapp: ${err?.message ?? err}`);
    }
    await sleep(BILL_PACING_MS);
  }

  return {
    ok: true,
    pdfsEnviados,
    alreadySent,
    difSkipped,
    reason: pdfsEnviados === 0 && alreadySent === 0 ? "sem_bills" : null,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runMonthlyBoletos(sock) {
  if (!sock) {
    console.warn("[BOLETOS] WhatsApp não conectado, abortando run mensal");
    return;
  }
  console.log(`[BOLETOS] iniciando rotina mensal — stage_id=${STAGE_ID}`);

  let deals;
  try {
    deals = await listDealsByStage(STAGE_ID);
  } catch (err) {
    console.error(`[BOLETOS] erro ao listar deals da etapa ${STAGE_ID}: ${err?.message ?? err}`);
    return;
  }

  console.log(`[BOLETOS] ${deals.length} deals na etapa ${STAGE_ID}`);

  const summary = {
    total: deals.length,
    ok: 0,
    pdfs_enviados: 0,
    dif_pulados: 0,
    sem_cpf: 0,
    sem_telefone: 0,
    fora_do_whatsapp: 0,
    sem_cotas: 0,
    sem_bills: 0,
    erros: 0,
  };

  for (const deal of deals) {
    try {
      const result = await processDeal(sock, deal);
      if (result.ok) {
        summary.ok += 1;
        summary.pdfs_enviados += result.pdfsEnviados ?? 0;
        summary.dif_pulados += result.difSkipped ?? 0;
        if (result.reason === "sem_bills") summary.sem_bills += 1;
      } else {
        const bucket = result.reason in summary ? result.reason : "erros";
        summary[bucket] = (summary[bucket] ?? 0) + 1;
      }
    } catch (err) {
      summary.erros += 1;
      console.error(`[BOLETOS] erro inesperado no deal ${deal?.id}: ${err?.message ?? err}`);
    }
    await sleep(PACING_MS);
  }

  console.log(`[BOLETOS] rotina mensal concluída: ${JSON.stringify(summary)}`);
}
