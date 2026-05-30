import { createServer } from "node:http";
import { registry, whatsappConnected } from "./metrics.js";
import { pingDb } from "./db.js";
import { logger } from "./logger.js";

const startedAt = Date.now();

async function whatsappState() {
  const metric = await whatsappConnected.get();
  return metric.values[0]?.value === 1;
}

async function buildHealth() {
  const db_ok = pingDb();
  const wa = await whatsappState();
  const ok = db_ok && wa;
  return {
    body: {
      status: ok ? "ok" : "degraded",
      uptime_s: Math.floor((Date.now() - startedAt) / 1000),
      whatsapp_connected: wa,
      db_ok,
    },
    code: ok ? 200 : 503,
  };
}

export function startHttpServer() {
  const port = Number(process.env.METRICS_PORT ?? 9090);
  const host = process.env.METRICS_HOST ?? "127.0.0.1";

  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/health") {
        const { body, code } = await buildHealth();
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
        return;
      }
      if (req.url === "/metrics") {
        res.writeHead(200, { "Content-Type": registry.contentType });
        res.end(await registry.metrics());
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
    } catch (err) {
      logger.error({ event: "http.error", err: err?.message ?? String(err) });
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "internal" }));
    }
  });

  server.listen(port, host, () => {
    logger.info({ event: "http.listening", host, port });
  });

  return server;
}
