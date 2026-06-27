import {
  getParcelasParaLembrar,
  markContratoParcelaPdfSent,
} from "../db.js";
import { getBoletoPdf } from "../integrations/inter.js";
import { sendWithPresence } from "../whatsapp/presence.js";

const WINDOW_DAYS = Number(process.env.CONTRATO_REMINDER_WINDOW_DIAS ?? 10);
const PACING_MS = Number(process.env.CONTRATO_REMINDER_PACING_MS ?? 1500);

const DEFAULT_REMINDER_MESSAGE =
  "Oi, {{primeiro_nome}}! 😊\n\nSegue o boleto da consultoria — parcela {{parcela_n}}/{{total_parcelas}} 📄\n\nVence em {{data_vencimento}}. Qualquer dúvida, conta comigo!";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function firstName(fullName) {
  return String(fullName ?? "").trim().split(/\s+/)[0] || "";
}

function titleCase(name) {
  const first = firstName(name);
  if (!first) return "";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function fmtDateBr(ymd) {
  // ymd vem como "YYYY-MM-DD" do SQLite
  const m = String(ymd ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(ymd ?? "");
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function buildMessage(parcela) {
  const template = process.env.CONTRATO_REMINDER_TEMPLATE ?? DEFAULT_REMINDER_MESSAGE;
  return template
    .replaceAll("{{primeiro_nome}}", titleCase(parcela.nome))
    .replaceAll("{{parcela_n}}", String(parcela.parcela_n))
    .replaceAll("{{total_parcelas}}", String(parcela.total_parcelas))
    .replaceAll("{{data_vencimento}}", fmtDateBr(parcela.data_vencimento));
}

function buildFilename(parcela) {
  return `Boleto Travus ${titleCase(parcela.nome)} - parcela ${String(parcela.parcela_n).padStart(2, "0")} de ${String(parcela.total_parcelas).padStart(2, "0")}.pdf`;
}

export async function runContratoReminders(sock) {
  if (!sock) {
    console.warn("[CONTRATO_REMINDER] WhatsApp não conectado, abortando run");
    return;
  }
  const parcelas = getParcelasParaLembrar(WINDOW_DAYS);
  if (parcelas.length === 0) {
    console.log(`[CONTRATO_REMINDER] nenhuma parcela vencendo nos próximos ${WINDOW_DAYS} dias — skip`);
    return;
  }
  console.log(`[CONTRATO_REMINDER] ${parcelas.length} parcela(s) elegíveis (janela: ${WINDOW_DAYS} dias)`);

  const summary = { total: parcelas.length, enviadas: 0, sem_jid: 0, pdf_falhou: 0, envio_falhou: 0 };

  for (const parcela of parcelas) {
    const label = `deal ${parcela.deal_id} parcela ${parcela.parcela_n}/${parcela.total_parcelas} (${parcela.nome ?? "?"}, vence ${parcela.data_vencimento})`;

    if (!parcela.jid) {
      console.warn(`[CONTRATO_REMINDER] ${label} → sem jid registrado, pulando`);
      summary.sem_jid += 1;
      continue;
    }
    if (!parcela.codigo_solicitacao) {
      console.warn(`[CONTRATO_REMINDER] ${label} → sem codigo_solicitacao registrado, pulando`);
      summary.pdf_falhou += 1;
      continue;
    }

    let pdf;
    try {
      pdf = await getBoletoPdf(parcela.codigo_solicitacao);
    } catch (err) {
      console.error(`[CONTRATO_REMINDER] ${label} → falha ao baixar PDF: ${err?.message ?? err}`);
      summary.pdf_falhou += 1;
      continue;
    }

    const message = buildMessage(parcela);
    const filename = buildFilename(parcela);
    try {
      await sendWithPresence(sock, parcela.jid, message);
      await sock.sendMessage(parcela.jid, {
        document: pdf,
        mimetype: "application/pdf",
        fileName: filename,
      });
      markContratoParcelaPdfSent(parcela.deal_id, parcela.parcela_n);
      summary.enviadas += 1;
      console.log(`[CONTRATO_REMINDER] ${label} → enviada`);
    } catch (err) {
      console.error(`[CONTRATO_REMINDER] ${label} → falha ao enviar no WhatsApp: ${err?.message ?? err}`);
      summary.envio_falhou += 1;
    }

    await sleep(PACING_MS);
  }

  console.log(`[CONTRATO_REMINDER] concluído: ${JSON.stringify(summary)}`);
}
