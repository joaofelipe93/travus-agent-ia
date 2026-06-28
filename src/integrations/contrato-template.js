import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

const CONVERTAPI_BASE_URL = "https://v2.convertapi.com";

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

// Modo cortesia: remove a Cláusula 4ª (DA REMUNERAÇÃO) inteira do .docx.
// Estratégia: remove todos os parágrafos <w:p>...</w:p> que estão entre o
// parágrafo que contém "CLÁUSULA 4" (inclusive) e o que contém "CLÁUSULA 5"
// (exclusive). Preserva o resto do contrato.
function applyCortesiaRemoval(zip) {
  const xml = zip.file("word/document.xml").asText();
  const paraRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
  const paras = [...xml.matchAll(paraRegex)];

  let startIdx = -1;
  let endIdx = -1;
  for (let i = 0; i < paras.length; i++) {
    const text = paras[i][0].replace(/<[^>]+>/g, "");
    if (text.includes("CLÁUSULA 4") && startIdx === -1) startIdx = i;
    if (text.includes("CLÁUSULA 5") && startIdx !== -1) { endIdx = i; break; }
  }

  if (startIdx === -1 || endIdx === -1) {
    throw new Error("Modo cortesia: não encontrei âncoras das cláusulas 4ª/5ª no template");
  }

  let modified = xml;
  for (let i = endIdx - 1; i >= startIdx; i--) {
    modified = modified.slice(0, paras[i].index) + modified.slice(paras[i].index + paras[i][0].length);
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
 * @param {number} [params.valor] — valor de cada parcela (obrigatório se !cortesia)
 * @param {number} [params.parcelas] — quantidade de parcelas (obrigatório se !cortesia)
 * @param {string[]} [params.vencimentos] — datas YYYY-MM-DD das parcelas (obrigatório se !cortesia)
 * @param {Date} [params.dataAssinatura] — data da assinatura (default: hoje)
 * @param {boolean} [params.cortesia] — modo "só contrato": remove Cláusula 4ª e
 *                                       ignora valor/parcelas/vencimentos.
 * @returns {Buffer} buffer do .docx renderizado
 */
export function renderContrato({ person, valor, parcelas, vencimentos, dataAssinatura, cortesia = false }) {
  if (!person) throw new Error("renderContrato: person ausente");
  if (!cortesia) {
    if (!Number.isFinite(valor) || valor <= 0) throw new Error("renderContrato: valor inválido");
    if (!Number.isFinite(parcelas) || parcelas < 1) throw new Error("renderContrato: parcelas inválidas");
    if (!Array.isArray(vencimentos) || vencimentos.length !== parcelas) {
      throw new Error(`renderContrato: esperava ${parcelas} vencimentos, recebi ${vencimentos?.length ?? 0}`);
    }
  }

  const tplBuffer = readFileSync(resolve(TEMPLATE_PATH));
  let zip = new PizZip(tplBuffer);
  if (isMasculino(person.gender)) {
    zip = applyMasculineSubstitutions(zip);
  }
  if (cortesia) {
    zip = applyCortesiaRemoval(zip);
  }
  const doc = new Docxtemplater(zip, {
    delimiters: { start: "{{", end: "}}" },
    paragraphLoop: true,
    linebreaks: true,
  });

  const nomeCliente = String(person.name ?? "").trim();
  const addr = person.address ?? {};
  const cidadeUf = `${person.city?.name ?? ""}/${person.city?.uf ?? ""}`;

  const placeholders = {
    cliente_nome_maiusculo: nomeCliente.toUpperCase(),
    cliente_nome: nomeCliente,
    cliente_cpf: fmtCpf(person.cpf),
    cliente_endereco: buildEnderecoCompleto(addr),
    cliente_bairro: addr.district ?? "",
    cliente_cep: fmtCep(addr.postal_code),
    cliente_cidade_uf: cidadeUf,
    cidade_assinatura: cidadeUf,
    data_assinatura_extenso: fmtDataExtenso(dataAssinatura ?? new Date()),
  };

  if (!cortesia) {
    const valorTotal = valor * parcelas;
    const venc1 = vencimentos[0];
    const venc2 = vencimentos[1] ?? vencimentos[0];
    const vencLast = vencimentos[vencimentos.length - 1];
    Object.assign(placeholders, {
      valor_total: `R$ ${fmtBrl(valorTotal)}`,
      valor_parcela: `R$ ${fmtBrl(valor)}`,
      total_parcelas: String(parcelas),
      primeira_parcela_vencimento: fmtDateBr(venc1),
      segunda_parcela_vencimento: fmtDateBr(venc2),
      ultima_parcela_vencimento: fmtDateBr(vencLast),
      dia_do_mes_vencimento: String(parseLocalDate(venc1).getDate()),
    });
  }

  doc.render(placeholders);
  return doc.getZip().generate({ type: "nodebuffer" });
}

/**
 * Converte um buffer .docx pra PDF via ConvertAPI (https://www.convertapi.com).
 * Requer CONVERTAPI_TOKEN no .env. Free tier (1500s/mês) cobre o uso da Travus.
 *
 * Histórico: anteriormente usávamos libreoffice-convert (LibreOffice headless),
 * mas a fonte saía com métrica errada e a imagem do cabeçalho não renderizava
 * corretamente. ConvertAPI usa Word real do lado deles e devolve PDF fiel. Ver
 * issue #91.
 *
 * @param {Buffer} docxBuffer — buffer do .docx pra converter
 * @returns {Promise<Buffer>} buffer do PDF
 */
export async function convertDocxToPdf(docxBuffer) {
  const token = process.env.CONVERTAPI_TOKEN;
  if (!token) throw new Error("CONVERTAPI_TOKEN não configurado no .env");

  const form = new FormData();
  form.append("File", new Blob([docxBuffer]), "contrato.docx");

  const res = await fetch(`${CONVERTAPI_BASE_URL}/convert/docx/to/pdf`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(corpo ilegível)");
    throw new Error(`ConvertAPI → HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  const fileData = json?.Files?.[0]?.FileData;
  if (!fileData) {
    throw new Error(`ConvertAPI → resposta sem Files[0].FileData: ${JSON.stringify(json).slice(0, 200)}`);
  }
  const pdfBuffer = Buffer.from(fileData, "base64");
  if (pdfBuffer.length < 100 || pdfBuffer.slice(0, 4).toString("ascii") !== "%PDF") {
    throw new Error(`ConvertAPI → PDF inválido (${pdfBuffer.length} bytes, magic="${pdfBuffer.slice(0, 4).toString("ascii")}")`);
  }
  return pdfBuffer;
}

/**
 * Renderiza o contrato e devolve PDF (via ConvertAPI).
 * Throw se CONVERTAPI_TOKEN não estiver setado ou a API falhar.
 *
 * @param {object} params — mesma assinatura de renderContrato
 * @returns {Promise<Buffer>} buffer do PDF
 */
export async function renderContratoPdf(params) {
  const docxBuffer = renderContrato(params);
  return convertDocxToPdf(docxBuffer);
}

// Exportados pra teste isolado / reuso
export const _internals = {
  fmtCpf, fmtCep, fmtBrl, fmtDateBr, fmtDataExtenso, buildEnderecoCompleto,
};
