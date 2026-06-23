import { Agent, fetch } from "undici";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SANDBOX_URL = "https://cdpj-sandbox.partners.uatinter.co";
const PROD_URL = "https://cdpj.partners.bancointer.com.br";
const BASE_URL = (process.env.INTER_BASE_URL ?? SANDBOX_URL).replace(/\/+$/, "");
const SCOPES = "boleto-cobranca.read boleto-cobranca.write";

let cachedDispatcher = null;
function getDispatcher() {
  if (cachedDispatcher) return cachedDispatcher;
  const certPath = process.env.INTER_CERT_FILE;
  const keyPath = process.env.INTER_KEY_FILE;
  if (!certPath || !keyPath) {
    throw new Error("INTER_CERT_FILE e INTER_KEY_FILE precisam estar configurados");
  }
  cachedDispatcher = new Agent({
    connect: {
      cert: readFileSync(resolve(certPath)),
      key: readFileSync(resolve(keyPath)),
    },
  });
  return cachedDispatcher;
}

let cachedToken = null;
let cachedTokenExpiresAt = 0;
const TOKEN_SAFETY_MARGIN_MS = 30_000;

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt - TOKEN_SAFETY_MARGIN_MS) {
    return cachedToken;
  }
  const clientId = process.env.INTER_CLIENT_ID;
  const clientSecret = process.env.INTER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("INTER_CLIENT_ID e INTER_CLIENT_SECRET precisam estar configurados");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: SCOPES,
    grant_type: "client_credentials",
  });

  const res = await fetch(`${BASE_URL}/oauth/v2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    dispatcher: getDispatcher(),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "(corpo ilegível)");
    throw new Error(`Inter OAuth → HTTP ${res.status}: ${errBody.slice(0, 500)}`);
  }
  const json = await res.json();
  if (!json?.access_token) {
    throw new Error(`Inter OAuth → resposta sem access_token: ${JSON.stringify(json).slice(0, 300)}`);
  }

  cachedToken = json.access_token;
  cachedTokenExpiresAt = Date.now() + (Number(json.expires_in) || 3600) * 1000;
  return cachedToken;
}

function buildHeaders(token, extra = {}) {
  const h = { authorization: `Bearer ${token}`, ...extra };
  if (process.env.INTER_CONTA_CORRENTE) {
    h["x-conta-corrente"] = process.env.INTER_CONTA_CORRENTE;
  }
  return h;
}

export async function createCobranca(payload) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}/cobranca/v3/cobrancas`, {
    method: "POST",
    headers: buildHeaders(token, { "content-type": "application/json" }),
    body: JSON.stringify(payload),
    dispatcher: getDispatcher(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(corpo ilegível)");
    throw new Error(`Inter POST /cobranca/v3/cobrancas → HTTP ${res.status}: ${body.slice(0, 500)}`);
  }
  return res.json();
}

export async function getCobranca(codigoSolicitacao) {
  const token = await getAccessToken();
  const res = await fetch(
    `${BASE_URL}/cobranca/v3/cobrancas/${encodeURIComponent(codigoSolicitacao)}`,
    {
      method: "GET",
      headers: buildHeaders(token),
      dispatcher: getDispatcher(),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "(corpo ilegível)");
    throw new Error(`Inter GET /cobrancas/${codigoSolicitacao} → HTTP ${res.status}: ${body.slice(0, 500)}`);
  }
  return res.json();
}

export async function getBoletoPdf(codigoSolicitacao) {
  const token = await getAccessToken();
  const res = await fetch(
    `${BASE_URL}/cobranca/v3/cobrancas/${encodeURIComponent(codigoSolicitacao)}/pdf`,
    {
      method: "GET",
      headers: buildHeaders(token),
      dispatcher: getDispatcher(),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "(corpo ilegível)");
    throw new Error(
      `Inter GET /cobrancas/${codigoSolicitacao}/pdf → HTTP ${res.status}: ${body.slice(0, 500)}`
    );
  }
  const json = await res.json().catch(() => null);
  if (!json?.pdf) {
    throw new Error(
      `Inter GET PDF → resposta sem campo "pdf" (esperado base64). Body: ${JSON.stringify(json).slice(0, 200)}`
    );
  }
  return Buffer.from(json.pdf, "base64");
}

export function getInterBaseUrl() {
  return BASE_URL;
}

export const INTER_ENVIRONMENTS = { SANDBOX_URL, PROD_URL };
