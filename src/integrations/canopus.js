const BASE_URL = "https://www.consorciocanopus.com.br/extensions/boleto-facil-rolledback/public/index.php";

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
    headers: { accept: "application/json" },
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
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(corpo ilegível)");
    throw new Error(`Canopus GET /generate-bill → HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return Array.isArray(json?.bills) ? json.bills : [];
}

export async function fetchOverdueBillPdf(grupo, cota, billId, transactionId) {
  const url = `${BASE_URL}/print-overdue-bill/${encodeURIComponent(grupo)}/${encodeURIComponent(cota)}/${encodeURIComponent(billId)}/${encodeURIComponent(transactionId)}`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const body = await res.text().catch(() => "(corpo ilegível)");
    throw new Error(`Canopus GET /print-overdue-bill → HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
