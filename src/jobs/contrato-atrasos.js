import {
  getParcelasParaAcompanhar,
  updateParcelaStatus,
  bumpParcelaAtrasoLevel,
} from "../db.js";
import { getCobranca } from "../integrations/inter.js";
import { sendWithPresence } from "../whatsapp/presence.js";

const PACING_MS = Number(process.env.ATRASO_PACING_MS ?? 1500);
const INTER_CHECK_PACING_MS = Number(process.env.ATRASO_INTER_CHECK_PACING_MS ?? 300);
const CONSULTOR_WHATSAPP = process.env.CONSULTOR_WHATSAPP ?? null;

// Níveis de atraso: dias_min após o vencimento pra cada lembrete.
const NIVEIS = [
  { level: 1, after_days: Number(process.env.ATRASO_DIAS_NIVEL_1 ?? 1) },
  { level: 2, after_days: Number(process.env.ATRASO_DIAS_NIVEL_2 ?? 5) },
  { level: 3, after_days: Number(process.env.ATRASO_DIAS_NIVEL_3 ?? 15) },
];

const DEFAULT_MSG_D1 =
  "Oi, {{primeiro_nome}}! 😊\n\nVi aqui que a parcela {{parcela_n}}/{{total_parcelas}} do seu contrato venceu ontem e ainda não tá baixada no nosso sistema. Caso já tenha pago, é só desconsiderar (a baixa às vezes demora 1-2 dias úteis).\n\nQualquer dúvida, conta comigo!";

const DEFAULT_MSG_D5 =
  "Oi, {{primeiro_nome}}! 😊\n\nSó pra lembrar: a parcela {{parcela_n}}/{{total_parcelas}} do seu contrato (vencida em {{data_vencimento}}) ainda não foi paga. Conseguiria regularizar? Qualquer dúvida ou se precisar de uma 2ª via, é só me chamar!";

const DEFAULT_MSG_D15 =
  "Oi, {{primeiro_nome}}.\n\nA parcela {{parcela_n}}/{{total_parcelas}} do seu contrato continua em atraso há 15 dias. Pra mantermos a consultoria ativa, é importante regularizar. O consultor vai entrar em contato em breve.\n\nQualquer dúvida, tô aqui.";

const DEFAULT_MSG_CONSULTOR =
  "[ATRASO 15 DIAS] Cliente {{cliente_nome}} (deal {{deal_id}}) com a parcela {{parcela_n}}/{{total_parcelas}} vencida há 15 dias. Bot já enviou D+1, D+5, D+15. Hora de contato direto.";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function firstName(fullName) {
  return String(fullName ?? "").trim().split(/\s+/)[0] || "";
}

function titleCase(name) {
  const f = firstName(name);
  return f ? f.charAt(0).toUpperCase() + f.slice(1).toLowerCase() : "";
}

function fmtDateBr(ymd) {
  const m = String(ymd ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(ymd ?? "");
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function cleanDigits(s) {
  return String(s ?? "").replace(/\D/g, "");
}

function buildMsg(template, parcela) {
  return String(template)
    .replaceAll("{{primeiro_nome}}", titleCase(parcela.nome))
    .replaceAll("{{cliente_nome}}", String(parcela.nome ?? ""))
    .replaceAll("{{parcela_n}}", String(parcela.parcela_n))
    .replaceAll("{{total_parcelas}}", String(parcela.total_parcelas))
    .replaceAll("{{data_vencimento}}", fmtDateBr(parcela.data_vencimento))
    .replaceAll("{{deal_id}}", String(parcela.deal_id));
}

function tplForLevel(level) {
  if (level === 1) return process.env.ATRASO_TEMPLATE_D1 ?? DEFAULT_MSG_D1;
  if (level === 2) return process.env.ATRASO_TEMPLATE_D5 ?? DEFAULT_MSG_D5;
  if (level === 3) return process.env.ATRASO_TEMPLATE_D15 ?? DEFAULT_MSG_D15;
  return null;
}

function templateConsultor() {
  return process.env.ATRASO_TEMPLATE_CONSULTOR ?? DEFAULT_MSG_CONSULTOR;
}

function daysBetween(fromYmd, todayLocal = new Date()) {
  const m = String(fromYmd ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const venc = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(todayLocal.getFullYear(), todayLocal.getMonth(), todayLocal.getDate());
  return Math.floor((today.getTime() - venc.getTime()) / 86400_000);
}

// Decide qual nível disparar baseado em dias de atraso e nível já enviado.
// Retorna o NOVO nível a enviar (ou null se nada a fazer).
function nextLevelToFire(diasAtraso, atrasoLevelAtual) {
  for (let i = NIVEIS.length - 1; i >= 0; i--) {
    const n = NIVEIS[i];
    if (diasAtraso >= n.after_days && atrasoLevelAtual < n.level) {
      return n.level;
    }
  }
  return null;
}

async function notifyConsultor(sock, message) {
  if (!CONSULTOR_WHATSAPP || !sock) return;
  const jid = `${cleanDigits(CONSULTOR_WHATSAPP)}@s.whatsapp.net`;
  try {
    await sendWithPresence(sock, jid, message);
    console.log(`[ATRASO] consultor notificado → ${jid}`);
  } catch (err) {
    console.error(`[ATRASO] falha ao notificar consultor: ${err?.message ?? err}`);
  }
}

export async function runContratoAtrasos(sock) {
  if (!sock) {
    console.warn("[ATRASO] WhatsApp não conectado, abortando run");
    return;
  }

  const parcelas = getParcelasParaAcompanhar();
  if (parcelas.length === 0) {
    console.log("[ATRASO] nenhuma parcela pendente pra acompanhar — skip");
    return;
  }
  console.log(`[ATRASO] ${parcelas.length} parcela(s) pendente(s) — consultando Inter`);

  const summary = {
    total: parcelas.length,
    pagas_detectadas: 0,
    lembretes_d1: 0,
    lembretes_d5: 0,
    lembretes_d15: 0,
    skipados: 0,
    erros: 0,
  };

  for (const parcela of parcelas) {
    const label = `deal ${parcela.deal_id} parcela ${parcela.parcela_n}/${parcela.total_parcelas} (${parcela.nome ?? "?"}, vence ${parcela.data_vencimento})`;

    // 1. Consulta status na Inter
    let cobranca;
    try {
      cobranca = await getCobranca(parcela.codigo_solicitacao);
    } catch (err) {
      console.error(`[ATRASO] ${label} → erro getCobranca: ${err?.message ?? err}`);
      summary.erros += 1;
      await sleep(INTER_CHECK_PACING_MS);
      continue;
    }
    await sleep(INTER_CHECK_PACING_MS);

    const situacao = cobranca?.cobranca?.situacao ?? cobranca?.situacao ?? null;

    // 2. Se pagou, atualiza e segue
    if (situacao === "RECEBIDO" || situacao === "MARCADO_RECEBIDO") {
      updateParcelaStatus(parcela.deal_id, parcela.parcela_n, {
        status: situacao,
        paid_at: Math.floor(Date.now() / 1000),
      });
      summary.pagas_detectadas += 1;
      console.log(`[ATRASO] ${label} → pagamento confirmado na Inter (${situacao})`);
      continue;
    }

    // Atualiza status mas sem marcar como pago
    updateParcelaStatus(parcela.deal_id, parcela.parcela_n, { status: situacao });

    // 3. Calcula dias de atraso e decide qual nível disparar
    const dias = daysBetween(parcela.data_vencimento);
    if (dias === null || dias < 1) {
      summary.skipados += 1;
      continue; // ainda não venceu (ou vencimento inválido)
    }

    const novoNivel = nextLevelToFire(dias, Number(parcela.atraso_level ?? 0));
    if (novoNivel === null) {
      summary.skipados += 1;
      continue;
    }

    if (!parcela.jid) {
      console.warn(`[ATRASO] ${label} → sem jid registrado, pulando lembrete N${novoNivel}`);
      summary.erros += 1;
      continue;
    }

    // 4. Envia mensagem do nível
    const template = tplForLevel(novoNivel);
    if (!template) {
      console.warn(`[ATRASO] ${label} → sem template pra nível ${novoNivel}, pulando`);
      summary.skipados += 1;
      continue;
    }
    const msg = buildMsg(template, parcela);
    try {
      await sendWithPresence(sock, parcela.jid, msg);
      bumpParcelaAtrasoLevel(parcela.deal_id, parcela.parcela_n, novoNivel);
      if (novoNivel === 1) summary.lembretes_d1 += 1;
      else if (novoNivel === 2) summary.lembretes_d5 += 1;
      else if (novoNivel === 3) summary.lembretes_d15 += 1;
      console.log(`[ATRASO] ${label} → enviou lembrete nível ${novoNivel} (${dias} dia(s) de atraso)`);
    } catch (err) {
      console.error(`[ATRASO] ${label} → falha ao enviar lembrete: ${err?.message ?? err}`);
      summary.erros += 1;
      await sleep(PACING_MS);
      continue;
    }

    // 5. No nível 3, notifica consultor
    if (novoNivel === 3) {
      const msgConsultor = buildMsg(templateConsultor(), parcela);
      await notifyConsultor(sock, msgConsultor);
    }

    await sleep(PACING_MS);
  }

  console.log(`[ATRASO] concluído: ${JSON.stringify(summary)}`);
}
