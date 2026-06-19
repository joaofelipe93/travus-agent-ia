// Cloudflare Worker — proxy pra contornar o WAF da Canopus quando o IP da VPS é barrado.
//
// Setup (5 min):
// 1. Entre em https://dash.cloudflare.com/ → Workers & Pages → Create → Hello World.
// 2. Cole TODO esse arquivo no editor do Worker, substituindo o template.
// 3. Settings → Variables and Secrets → adicione "SHARED_TOKEN" (Secret) com um valor longo aleatório.
// 4. Deploy. Anote a URL gerada (ex: https://canopus-proxy.SEUSUBDOMAIN.workers.dev).
// 5. No .env da VPS, configure:
//      CANOPUS_BASE_URL=https://canopus-proxy.SEUSUBDOMAIN.workers.dev/canopus
//      CANOPUS_PROXY_TOKEN=<o mesmo SHARED_TOKEN>
// 6. Ajuste canopus.js pra enviar o header x-proxy-token (instruções no PR).
//
// Como funciona: o Worker recebe /canopus/<resto-do-path>, propaga o GET pra
// https://www.consorciocanopus.com.br/extensions/boleto-facil-rolledback/public/index.php/<resto-do-path>
// e devolve a resposta. O bot manda x-proxy-token pra evitar que terceiros usem.

const CANOPUS_ORIGIN =
  "https://www.consorciocanopus.com.br/extensions/boleto-facil-rolledback/public/index.php";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/canopus/")) {
      return new Response("not found", { status: 404 });
    }

    if (env.SHARED_TOKEN && request.headers.get("x-proxy-token") !== env.SHARED_TOKEN) {
      return new Response("forbidden", { status: 403 });
    }

    if (request.method !== "GET") {
      return new Response("method not allowed", { status: 405 });
    }

    const upstreamPath = url.pathname.slice("/canopus".length); // "/find-cota/..." etc
    const upstreamUrl = `${CANOPUS_ORIGIN}${upstreamPath}${url.search}`;

    const upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        accept: request.headers.get("accept") ?? "application/json, text/plain, */*",
        "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "accept-encoding": "gzip, deflate, br",
        "sec-ch-ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        referer: "https://www.consorciocanopus.com.br/",
        origin: "https://www.consorciocanopus.com.br",
      },
    });

    const buffer = await upstream.arrayBuffer();
    const responseHeaders = new Headers();
    const passthrough = ["content-type", "content-length", "cache-control"];
    for (const h of passthrough) {
      const v = upstream.headers.get(h);
      if (v) responseHeaders.set(h, v);
    }

    return new Response(buffer, {
      status: upstream.status,
      headers: responseHeaders,
    });
  },
};
