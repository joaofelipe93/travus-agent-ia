const BASE_URL = "https://api.pipe.run/v1";

function token() {
  const t = process.env.PIPERUN_API_TOKEN;
  if (!t) throw new Error("PIPERUN_API_TOKEN não configurado no .env");
  return t;
}

export async function getPerson(personId) {
  const res = await fetch(`${BASE_URL}/persons/${personId}`, {
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
