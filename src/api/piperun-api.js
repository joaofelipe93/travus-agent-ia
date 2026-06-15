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
