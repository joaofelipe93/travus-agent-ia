const BASE_URL = "https://api.pipe.run/v1";

function token() {
  const t = process.env.PIPERUN_API_TOKEN;
  if (!t) throw new Error("PIPERUN_API_TOKEN não configurado no .env");
  return t;
}

const DEFAULT_PERSON_WITH = "contactPhones,contactEmails";

export async function getPerson(personId, { include = DEFAULT_PERSON_WITH } = {}) {
  const url = include
    ? `${BASE_URL}/persons/${personId}?with=${encodeURIComponent(include)}`
    : `${BASE_URL}/persons/${personId}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      token: token(),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(corpo ilegível)");
    throw new Error(`Piperun GET /persons/${personId} → HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  if (json?.success === false) {
    throw new Error(`Piperun GET /persons/${personId} → success=false: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json?.data ?? null;
}

export async function listDealsByStage(stageId, { pageSize = 100 } = {}) {
  const all = [];
  let page = 1;
  while (true) {
    const url = `${BASE_URL}/deals?stage_id=${encodeURIComponent(stageId)}&page=${page}&show=${pageSize}&with=person`;
    const res = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json", token: token() },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "(corpo ilegível)");
      throw new Error(`Piperun GET /deals?stage_id=${stageId} → HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = await res.json();
    if (json?.success === false) {
      throw new Error(`Piperun GET /deals?stage_id → success=false: ${JSON.stringify(json).slice(0, 300)}`);
    }
    const data = Array.isArray(json?.data) ? json.data : [];
    all.push(...data);
    const meta = json?.meta?.pagination;
    if (!meta || page >= (meta.total_pages ?? 1) || data.length === 0) break;
    page += 1;
  }
  return all;
}

const CPF_FIELD_NAMES = ["cpf", "CPF", "Cpf"];

export function extractCpfFromPerson(person) {
  if (!person) return null;
  for (const key of CPF_FIELD_NAMES) {
    if (typeof person[key] === "string" && person[key].trim()) return person[key].trim();
  }
  const containers = [person.custom_fields, person.fields, person.fields_attributes];
  for (const container of containers) {
    if (!container) continue;
    if (Array.isArray(container)) {
      for (const f of container) {
        const name = f?.name ?? f?.label ?? f?.key;
        const value = f?.value ?? f?.content;
        if (typeof name === "string" && /cpf/i.test(name) && typeof value === "string" && value.trim()) {
          return value.trim();
        }
      }
    } else if (typeof container === "object") {
      for (const [k, v] of Object.entries(container)) {
        if (/cpf/i.test(k) && typeof v === "string" && v.trim()) return v.trim();
      }
    }
  }
  return null;
}

function extractPhoneFromPerson(person) {
  const sources = [person?.contact_phones, person?.contactPhones];
  for (const phones of sources) {
    if (!Array.isArray(phones) || phones.length === 0) continue;
    const main = phones.find((p) => p?.is_main === true || p?.is_main === 1);
    const chosen = main ?? phones[0];
    const value = chosen?.number ?? chosen?.phone;
    if (value) return value;
  }
  return null;
}

export { extractPhoneFromPerson };

async function listPersonsByEmail(email) {
  const url = `${BASE_URL}/persons?email=${encodeURIComponent(email)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json", token: token() },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(corpo ilegível)");
    throw new Error(`Piperun GET /persons?email → HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  if (json?.success === false) {
    throw new Error(`Piperun GET /persons?email → success=false: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return Array.isArray(json?.data) ? json.data : [];
}

async function listDealsByPersonId(personId) {
  const url = `${BASE_URL}/deals?person_id=${encodeURIComponent(personId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json", token: token() },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(corpo ilegível)");
    throw new Error(`Piperun GET /deals?person_id → HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  if (json?.success === false) {
    throw new Error(`Piperun GET /deals?person_id → success=false: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return Array.isArray(json?.data) ? json.data : [];
}

export async function findDealIdByEmail(email) {
  if (!email) return null;
  const persons = await listPersonsByEmail(email);
  if (persons.length === 0) return null;
  const personId = persons[0]?.id;
  if (!personId) return null;
  const deals = await listDealsByPersonId(personId);
  if (deals.length === 0) return null;
  const sorted = [...deals].sort((a, b) => {
    const ta = Date.parse(a?.created_at ?? a?.updated_at ?? 0) || 0;
    const tb = Date.parse(b?.created_at ?? b?.updated_at ?? 0) || 0;
    return tb - ta;
  });
  return sorted[0]?.id ?? null;
}

export async function moveDealToStage(dealId, stageId) {
  const res = await fetch(`${BASE_URL}/deals/${dealId}`, {
    method: "PUT",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      token: token(),
    },
    body: JSON.stringify({ stage_id: stageId }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(corpo ilegível)");
    throw new Error(`Piperun PUT /deals/${dealId} → HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  if (json?.success === false) {
    throw new Error(`Piperun PUT /deals/${dealId} → success=false: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json?.data ?? null;
}
