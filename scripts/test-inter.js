// Teste manual da integração com Banco Inter.
//
// Uso:
//   npm run inter:test                     → emite boleto fake (CPF 12345678909) de R$ 1,00
//   npm run inter:test -- --cpf=...        → usa CPF específico
//   npm run inter:test -- --valor=2.50     → valor diferente
//   npm run inter:test -- --nome="Joao"    → nome do pagador
//
// Pré-requisitos no .env:
//   INTER_CLIENT_ID, INTER_CLIENT_SECRET,
//   INTER_CERT_FILE, INTER_KEY_FILE,
//   (opcional) INTER_CONTA_CORRENTE, INTER_BASE_URL

import "dotenv/config";
import { writeFileSync } from "node:fs";
import {
  createCobranca,
  getCobranca,
  getBoletoPdf,
  getInterBaseUrl,
} from "../src/integrations/inter.js";

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const cpf = arg("cpf", "12345678909");
const valor = Number(arg("valor", "1.00"));
const nome = arg("nome", "Cliente Teste Travus");
const seuNumero = `TESTE-${Date.now().toString().slice(-10)}`;

const venc = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);

const payload = {
  seuNumero,
  valorNominal: valor,
  dataVencimento: venc,
  numDiasAgenda: 0,
  pagador: {
    cpfCnpj: cpf.replace(/\D/g, ""),
    tipoPessoa: "FISICA",
    nome,
    endereco: "Rua Teste, 100",
    bairro: "Centro",
    cidade: "São Paulo",
    uf: "SP",
    cep: "01000000",
    email: "teste@travuscapital.com.br",
  },
  multa: { taxa: 2, codigo: "PERCENTUAL" },
  mora: { taxa: 1, codigo: "TAXAMENSAL" },
};

console.log(`[INTER_TEST] ambiente: ${getInterBaseUrl()}`);
console.log(`[INTER_TEST] payload:`, JSON.stringify(payload, null, 2));

console.log(`[INTER_TEST] criando cobrança seuNumero=${seuNumero}...`);
const created = await createCobranca(payload);
console.log(`[INTER_TEST] OK → codigoSolicitacao=${created?.codigoSolicitacao}`);
console.log(JSON.stringify(created, null, 2));

const codigo = created?.codigoSolicitacao;
if (!codigo) {
  console.error("[INTER_TEST] resposta sem codigoSolicitacao — abortando.");
  process.exit(1);
}

// Aguarda 2s antes de buscar o PDF — Inter processa async em alguns casos
await new Promise((r) => setTimeout(r, 2000));

console.log(`[INTER_TEST] buscando metadata da cobrança...`);
const cobranca = await getCobranca(codigo);
console.log(JSON.stringify(cobranca, null, 2));

console.log(`[INTER_TEST] baixando PDF...`);
const pdfBuffer = await getBoletoPdf(codigo);
const outPath = `/tmp/inter-boleto-${seuNumero}.pdf`;
writeFileSync(outPath, pdfBuffer);
console.log(`[INTER_TEST] PDF salvo em ${outPath} (${pdfBuffer.length} bytes)`);
console.log(`[INTER_TEST] magic bytes: ${pdfBuffer.slice(0, 4).toString("ascii")}`);
