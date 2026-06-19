// Proxy HTTP standalone pra contornar o WAF do Canopus quando o IP da VPS
// (e até o Worker da Cloudflare) é barrado.
//
// Hospede em qualquer plataforma com IP não-Cloudflare. Recomendado: Render.com
// (free tier, sem cartão). Setup ao final do arquivo.
//
// Uso: GET /canopus/<resto-do-path> com header x-proxy-token
// Responde com o body cru do Canopus, propaga status e content-type.

import http from "node:http";

const PORT = Number(process.env.PORT ?? 3000);
const SHARED_TOKEN = process.env.SHARED_TOKEN;
const CANOPUS_ORIGIN =
  "https://www.consorciocanopus.com.br/extensions/boleto-facil-rolledback/public/index.php";

const BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "sec-ch-ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  referer: "https://www.consorciocanopus.com.br/",
  origin: "https://www.consorciocanopus.com.br",
};

function send(res, status, body, contentType = "text/plain") {
  res.writeHead(status, { "content-type": contentType });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") return send(res, 200, "ok");

  if (req.method !== "GET") return send(res, 405, "method not allowed");
  if (!req.url.startsWith("/canopus/")) return send(res, 404, "not found");

  if (SHARED_TOKEN && req.headers["x-proxy-token"] !== SHARED_TOKEN) {
    return send(res, 403, "forbidden");
  }

  const upstreamPath = req.url.slice("/canopus".length);
  const upstreamUrl = `${CANOPUS_ORIGIN}${upstreamPath}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        ...BROWSER_HEADERS,
        accept: req.headers.accept ?? "application/json, text/plain, */*",
      },
    });
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "content-length": buffer.length,
    });
    res.end(buffer);
  } catch (err) {
    console.error("upstream error:", err?.message ?? err);
    send(res, 502, "upstream error");
  }
});

server.listen(PORT, () => {
  console.log(`canopus-proxy listening on :${PORT}`);
});

// ============================================================================
// Setup no Render.com (free, sem cartão):
//
// 1. Suba esse arquivo num repo público no GitHub (ou usa o próprio
//    travus-agent-ia mesmo — Render aceita Dockerfile/Node).
//
// 2. Em https://render.com → New + → Web Service → Connect Repository.
//
// 3. Configurações:
//    - Build Command:    (vazio — não precisa)
//    - Start Command:    node scripts/canopus-proxy-server.js
//    - Environment:      Node
//    - Plan:             Free
//
// 4. Em Environment Variables: adicione SHARED_TOKEN com o mesmo valor que
//    você configurou no CANOPUS_PROXY_TOKEN da VPS.
//
// 5. Deploy. Aguarde até ficar "Live" (~2 min). Anote a URL gerada
//    (ex: https://canopus-proxy-XXXX.onrender.com).
//
// 6. Teste:
//    curl -H "x-proxy-token: SEU_TOKEN" \
//         "https://canopus-proxy-XXXX.onrender.com/canopus/find-cota/35643655837"
//    Esperado: {"cotas":[...]}.
//
// 7. No .env da VPS, troque o CANOPUS_BASE_URL pra apontar pro Render em vez
//    do Worker da Cloudflare.
//
// NOTA: o free tier do Render dorme após 15min sem requests. A primeira
// chamada do cron mensal vai esperar ~30s pelo cold start. Aceitável.
// ============================================================================
