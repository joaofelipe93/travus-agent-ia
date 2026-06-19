const BASE_URL = "https://www.consorciocanopus.com.br/extensions/boleto-facil-rolledback/public/index.php";
const DEFAULT_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function browserHeaders(extra = {}) {
  return {
    "user-agent": process.env.CANOPUS_USER_AGENT ?? DEFAULT_UA,
    "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    ...extra,
  };
}

function cleanCpf(cpf) {
  return String(cpf ?? "").replace(/\D/g, "");
}

export async function findCotasByCpf(cpf) {
  const cpfDigits = cleanCpf(cpf);
  if (cpfDigits.length !== 11) {
    throw new Error(`CPF inválido (esperado 11 dígitos): "${cpf}"`);
  }
  const res = await fetch(`${BASE_URL}/find-cota/${cpfDigits}`, {
    method: "GET",
    headers: browserHeaders({ accept: "application/json" }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(corpo ilegível)");
    throw new Error(`Canopus GET /find-cota/${cpfDigits} → HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return Array.isArray(json?.cotas) ? json.cotas : [];
}

export async function generateBills(grupo, cota, idCota) {
  const url = `${BASE_URL}/generate-bill/${encodeURIComponent(grupo)}/${encodeURIComponent(cota)}/${encodeURIComponent(idCota)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: browserHeaders({ accept: "application/json" }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(corpo ilegível)");
    throw new Error(`Canopus GET /generate-bill → HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return Array.isArray(json?.bills) ? json.bills : [];
}

function isPdfBuffer(buffer) {
  return buffer?.length >= 4 && buffer.slice(0, 4).toString("ascii") === "%PDF";
}

async function tryFetchPdf(url) {
  const res = await fetch(url, {
    method: "GET",
    headers: browserHeaders({ accept: "application/pdf,*/*;q=0.8" }),
  });
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = res.headers.get("content-type") ?? "";
  return { ok: res.ok, status: res.status, contentType, buffer };
}

const MAX_RETRIES = Number(process.env.CANOPUS_MAX_RETRIES ?? 3);
const RETRY_BASE_MS = Number(process.env.CANOPUS_RETRY_BASE_MS ?? 2000);

export async function fetchOverdueBillPdf(grupo, cota, billId, transactionId) {
  const url = `${BASE_URL}/print-overdue-bill/${encodeURIComponent(grupo)}/${encodeURIComponent(cota)}/${encodeURIComponent(billId)}/${encodeURIComponent(transactionId)}`;

  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const { ok, status, contentType, buffer } = await tryFetchPdf(url);

    if (ok && contentType.includes("application/pdf") && isPdfBuffer(buffer)) {
      return buffer;
    }

    const retriable = status === 403 || status === 429 || status === 503 || status >= 500;
    lastErr = new Error(
      `Canopus GET /print-overdue-bill → HTTP ${status} content-type="${contentType}" size=${buffer.length}b`
    );

    if (!retriable || attempt === MAX_RETRIES) break;
    const backoff = RETRY_BASE_MS * Math.pow(2, attempt - 1);
    await new Promise((r) => setTimeout(r, backoff));
  }

  throw lastErr;
}
