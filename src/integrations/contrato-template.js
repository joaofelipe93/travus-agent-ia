import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import libre from "libreoffice-convert";

const convertAsync = promisify(libre.convert);

const TEMPLATE_PATH = process.env.CONTRATO_TEMPLATE_PATH ?? "src/assets/contrato-template.docx";

// Concordância de gênero: o template "fonte" é feminino ("brasileira", "inscrita"
// etc). Se person.gender === "Masculino", substituímos in-memory no XML antes
// de renderizar. Outras flexões (gender ausente, "Feminino", "Outro") caem no
// feminino — preserva o comportamento histórico do template.
const TROCAS_MASCULINO = [
  ["brasileira", "brasileiro"],
  ["inscrita", "inscrito"],
  ["assessorá-la", "assessorá-lo"],
  ["informada", "informado"],
];

function isMasculino(gender) {
  return String(gender ?? "").trim().toLowerCase().startsWith("masc");
}

function applyMasculineSubstitutions(zip) {
  const xml = zip.file("word/document.xml").asText();
  let modified = xml;
  for (const [antes, depois] of TROCAS_MASCULINO) {
    modified = modified.split(antes).join(depois);
  }
  zip.file("word/document.xml", modified);
  return zip;
}

const MESES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function cleanDigits(s) {
  return String(s ?? "").replace(/\D/g, "");
}

function fmtCpf(cpf) {
  const d = cleanDigits(cpf);
  if (d.length !== 11) return String(cpf ?? "");
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function fmtCep(cep) {
  const d = cleanDigits(cep);
  if (d.length !== 8) return String(cep ?? "");
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

function fmtBrl(valor) {
  return Number(valor).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Parse seguro de string "YYYY-MM-DD". new Date("2026-06-24") interpreta
// como UTC-meia-noite — em BRT vira dia 23. Aqui forçamos meia-noite local.
function parseLocalDate(dateLike) {
  if (dateLike instanceof Date) return dateLike;
  const s = String(dateLike);
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  return new Date(s);
}

function fmtDateBr(dateLike) {
  const d = parseLocalDate(dateLike);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function fmtDataExtenso(dateLike) {
  const d = parseLocalDate(dateLike);
  return `${d.getDate()} de ${MESES_PT[d.getMonth()]} de ${d.getFullYear()}`;
}

function buildEnderecoCompleto(addr) {
  const parts = [];
  if (addr?.street) parts.push(addr.street);
  if (addr?.number) parts.push(`nº ${addr.number}`);
  return parts.join(", ");
}

/**
 * Renderiza o contrato a partir do template .docx.
 *
 * @param {object} params
 * @param {object} params.person — objeto `person` do payload do Piperun
 * @param {number} params.valor — valor de cada parcela
 * @param {number} params.parcelas — quantidade de parcelas
 * @param {string[]} params.vencimentos — array de datas (YYYY-MM-DD) das parcelas, em ordem
 * @param {Date} [params.dataAssinatura] — data da assinatura (default: hoje)
 * @returns {Buffer} buffer do .docx renderizado
 */
export function renderContrato({ person, valor, parcelas, vencimentos, dataAssinatura }) {
  if (!person) throw new Error("renderContrato: person ausente");
  if (!Number.isFinite(valor) || valor <= 0) throw new Error("renderContrato: valor inválido");
  if (!Number.isFinite(parcelas) || parcelas < 1) throw new Error("renderContrato: parcelas inválidas");
  if (!Array.isArray(vencimentos) || vencimentos.length !== parcelas) {
    throw new Error(`renderContrato: esperava ${parcelas} vencimentos, recebi ${vencimentos?.length ?? 0}`);
  }

  const tplBuffer = readFileSync(resolve(TEMPLATE_PATH));
  let zip = new PizZip(tplBuffer);
  if (isMasculino(person.gender)) {
    zip = applyMasculineSubstitutions(zip);
  }
  const doc = new Docxtemplater(zip, {
    delimiters: { start: "{{", end: "}}" },
    paragraphLoop: true,
    linebreaks: true,
  });

  const nomeCliente = String(person.name ?? "").trim();
  const addr = person.address ?? {};
  const cidadeUf = `${person.city?.name ?? ""}/${person.city?.uf ?? ""}`;
  const valorTotal = valor * parcelas;

  const venc1 = vencimentos[0];
  const venc2 = vencimentos[1] ?? vencimentos[0];
  const vencLast = vencimentos[vencimentos.length - 1];
  const diaDoMes = parseLocalDate(venc1).getDate();

  doc.render({
    cliente_nome_maiusculo: nomeCliente.toUpperCase(),
    cliente_nome: nomeCliente,
    cliente_cpf: fmtCpf(person.cpf),
    cliente_endereco: buildEnderecoCompleto(addr),
    cliente_bairro: addr.district ?? "",
    cliente_cep: fmtCep(addr.postal_code),
    cliente_cidade_uf: cidadeUf,
    valor_total: `R$ ${fmtBrl(valorTotal)}`,
    valor_parcela: `R$ ${fmtBrl(valor)}`,
    total_parcelas: String(parcelas),
    primeira_parcela_vencimento: fmtDateBr(venc1),
    segunda_parcela_vencimento: fmtDateBr(venc2),
    ultima_parcela_vencimento: fmtDateBr(vencLast),
    dia_do_mes_vencimento: String(diaDoMes),
    cidade_assinatura: cidadeUf,
    data_assinatura_extenso: fmtDataExtenso(dataAssinatura ?? new Date()),
  });

  return doc.getZip().generate({ type: "nodebuffer" });
}

/**
 * Renderiza o contrato e converte pra PDF via LibreOffice headless.
 * Requer libreoffice instalado no sistema (sudo apt install libreoffice).
 *
 * @param {object} params — mesma assinatura de renderContrato
 * @returns {Promise<Buffer>} buffer do PDF
 */
export async function renderContratoPdf(params) {
  const docxBuffer = renderContrato(params);
  try {
    const pdfBuffer = await convertAsync(docxBuffer, ".pdf", undefined);
    if (!pdfBuffer || pdfBuffer.length < 100) {
      throw new Error(`PDF gerado vazio/inválido (${pdfBuffer?.length ?? 0} bytes)`);
    }
    if (pdfBuffer.slice(0, 4).toString("ascii") !== "%PDF") {
      throw new Error("PDF gerado sem magic bytes %PDF — libreoffice falhou silenciosamente");
    }
    return pdfBuffer;
  } catch (err) {
    const msg = err?.message ?? String(err);
    throw new Error(
      `Falha ao converter contrato .docx → PDF (libreoffice instalado e acessível?): ${msg}`
    );
  }
}

// Exportados pra teste isolado / reuso
export const _internals = {
  fmtCpf, fmtCep, fmtBrl, fmtDateBr, fmtDataExtenso, buildEnderecoCompleto,
};
