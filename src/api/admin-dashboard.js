import { readFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { getSystemEventStats, countActiveConversations, getRecentSystemEvents } from "../db.js";
import { getSock } from "./index.js";

const TZ = "America/Sao_Paulo";

let cachedVersion = null;
function getBotVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    cachedVersion = pkg.version ?? "unknown";
  } catch {
    cachedVersion = "unknown";
  }
  return cachedVersion;
}

function fmtUptime(seconds) {
  const s = Math.floor(seconds);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

const CPU_COUNT = cpus().length || 1;
let lastCpuSample = { cpu: process.cpuUsage(), hrtime: process.hrtime.bigint() };

function sampleCpuPercent() {
  const nowCpu = process.cpuUsage();
  const nowHr = process.hrtime.bigint();
  const elapsedMicros = Number(nowHr - lastCpuSample.hrtime) / 1000;
  const cpuMicros = (nowCpu.user - lastCpuSample.cpu.user) + (nowCpu.system - lastCpuSample.cpu.system);
  lastCpuSample = { cpu: nowCpu, hrtime: nowHr };
  if (elapsedMicros < 1) return 0;
  // % de UMA core; multi-core pode passar de 100.
  const pctSingleCore = (cpuMicros / elapsedMicros) * 100;
  // Normalizar como % do sistema total (todos os cores):
  const pctSystem = pctSingleCore / CPU_COUNT;
  return { single: Math.round(pctSingleCore * 10) / 10, system: Math.round(pctSystem * 10) / 10 };
}

function getRuntimeInfo() {
  const uptimeSec = process.uptime();
  const startTimeUnix = Math.floor(Date.now() / 1000 - uptimeSec);
  const mem = process.memoryUsage();
  const whatsappConnected = getSock() !== null;
  const cpu = sampleCpuPercent();
  const load = loadavg(); // [1min, 5min, 15min]
  let activeConversations = 0;
  try {
    activeConversations = countActiveConversations();
  } catch {}
  return {
    whatsappConnected,
    uptimeSeconds: uptimeSec,
    startedAt: startTimeUnix,
    memoryRssMB: Math.round(mem.rss / 1024 / 1024),
    memoryHeapMB: Math.round(mem.heapUsed / 1024 / 1024),
    cpuPercentProcess: cpu.single,
    cpuPercentSystem: cpu.system,
    loadAvg1m: Math.round(load[0] * 100) / 100,
    loadAvg5m: Math.round(load[1] * 100) / 100,
    cpuCount: CPU_COUNT,
    nodeVersion: process.version,
    pid: process.pid,
    botVersion: getBotVersion(),
    activeConversations,
  };
}

function checkAuth(req) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return { ok: false, code: 503, error: "ADMIN_TOKEN não configurado no servidor" };
  const got = req.header("x-admin-token");
  if (!got || got !== expected) return { ok: false, code: 401, error: "unauthorized" };
  return { ok: true };
}

function fmtDateTime(unixSec) {
  if (!unixSec) return "—";
  return new Date(unixSec * 1000).toLocaleString("pt-BR", { timeZone: TZ });
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderHtml(stats, runtime) {
  const errorRows = stats.recentErrors.length === 0
    ? '<tr><td colspan="4" class="empty">Nenhum evento de erro/warn recente 🎉</td></tr>'
    : stats.recentErrors.map((e) => `
        <tr>
          <td>${fmtDateTime(e.created_at)}</td>
          <td class="level level-${e.level}">${e.level}</td>
          <td>${escapeHtml(e.source)}</td>
          <td class="msg">${escapeHtml(e.message).slice(0, 200)}</td>
        </tr>
      `).join("");

  const webhookRows = stats.webhooks.byStageLast7d.length === 0
    ? '<tr><td colspan="2" class="empty">Nenhum webhook nos últimos 7 dias</td></tr>'
    : stats.webhooks.byStageLast7d.map((w) => `
        <tr><td>${escapeHtml(w.stage_id)}</td><td class="num">${w.n}</td></tr>
      `).join("");

  const cronBoletos = stats.lastBoletosCron
    ? `<div class="cron-info">
        <div>Último: <strong>${fmtDateTime(stats.lastBoletosCron.created_at)}</strong></div>
        <div>Nível: <span class="level level-${stats.lastBoletosCron.level}">${stats.lastBoletosCron.level}</span></div>
        <div>Msg: ${escapeHtml(stats.lastBoletosCron.message)}</div>
      </div>`
    : '<div class="empty">Cron ainda não registrado (aguarde próximo dia 8)</div>';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Travus Bot — Admin Dashboard</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 20px; max-width: 1100px; margin-inline: auto; }
    h1 { font-size: 1.5rem; margin: 0 0 20px; }
    h2 { font-size: 1.1rem; margin: 24px 0 12px; padding-bottom: 6px; border-bottom: 1px solid rgba(128,128,128,0.3); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .card { border: 1px solid rgba(128,128,128,0.3); border-radius: 6px; padding: 12px; }
    .card .label { font-size: 0.85rem; opacity: 0.7; }
    .card .value { font-size: 1.6rem; font-weight: 600; margin-top: 4px; }
    .card .sub { font-size: 0.8rem; opacity: 0.7; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid rgba(128,128,128,0.15); }
    th { font-weight: 600; opacity: 0.8; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    td.empty { text-align: center; opacity: 0.6; padding: 16px; }
    td.msg { max-width: 500px; word-break: break-word; }
    .level { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
    .level-info { background: rgba(0, 122, 255, 0.15); color: #0060df; }
    .level-warn { background: rgba(255, 149, 0, 0.15); color: #a06400; }
    .level-error { background: rgba(220, 53, 69, 0.15); color: #b02a37; }
    .cron-info { padding: 10px; border: 1px solid rgba(128,128,128,0.3); border-radius: 6px; font-size: 0.9rem; }
    .cron-info div { margin: 2px 0; }
    .status-ok { color: #1b8a3f; font-weight: 600; }
    .status-down { color: #b02a37; font-weight: 600; }
    .timeline { max-height: 320px; overflow-y: auto; border: 1px solid rgba(128,128,128,0.3); border-radius: 6px; padding: 4px 12px; font-size: 0.85rem; }
    .timeline .entry { padding: 6px 0; border-bottom: 1px solid rgba(128,128,128,0.1); display: grid; grid-template-columns: 90px 60px 160px 1fr; gap: 8px; align-items: baseline; }
    .timeline .entry:last-child { border-bottom: none; }
    .timeline .entry .t { opacity: 0.6; font-variant-numeric: tabular-nums; font-size: 0.8rem; }
    .timeline .entry .src { font-weight: 600; opacity: 0.85; }
    .timeline .entry .msg { word-break: break-word; }
    .timeline .empty { padding: 20px; text-align: center; opacity: 0.6; }
    .timeline-status { font-size: 0.75rem; opacity: 0.6; margin-top: 4px; }
    footer { margin-top: 30px; font-size: 0.8rem; opacity: 0.6; text-align: center; }
  </style>
</head>
<body>
  <h1>📊 Travus Bot — Admin Dashboard</h1>

  <h2>Sistema</h2>
  <div class="grid">
    <div class="card">
      <div class="label">WhatsApp</div>
      <div class="value ${runtime.whatsappConnected ? "status-ok" : "status-down"}">
        ${runtime.whatsappConnected ? "✅ Conectado" : "❌ Desconectado"}
      </div>
    </div>
    <div class="card">
      <div class="label">Uptime</div>
      <div class="value">${fmtUptime(runtime.uptimeSeconds)}</div>
      <div class="sub">desde ${fmtDateTime(runtime.startedAt)}</div>
    </div>
    <div class="card">
      <div class="label">Memória (RSS)</div>
      <div class="value">${runtime.memoryRssMB} MB</div>
      <div class="sub">heap: ${runtime.memoryHeapMB} MB</div>
    </div>
    <div class="card">
      <div class="label">CPU (processo)</div>
      <div class="value">${runtime.cpuPercentProcess}%</div>
      <div class="sub">${runtime.cpuPercentSystem}% do sistema · ${runtime.cpuCount} cores</div>
    </div>
    <div class="card">
      <div class="label">Load average</div>
      <div class="value">${runtime.loadAvg1m}</div>
      <div class="sub">5min: ${runtime.loadAvg5m}</div>
    </div>
    <div class="card">
      <div class="label">Conversas ativas</div>
      <div class="value">${runtime.activeConversations}</div>
    </div>
    <div class="card">
      <div class="label">Versão</div>
      <div class="value">v${runtime.botVersion}</div>
      <div class="sub">Node ${runtime.nodeVersion} · PID ${runtime.pid}</div>
    </div>
  </div>

  <h2>Timeline <span id="tl-status" class="timeline-status">(carregando...)</span></h2>
  <div id="timeline" class="timeline">
    <div class="empty">Aguardando eventos...</div>
  </div>

  <script>
    (function() {
      const MAX_VISIBLE = 50;
      const POLL_MS = 5000;
      const tl = document.getElementById('timeline');
      const statusEl = document.getElementById('tl-status');
      let lastId = 0;
      let pollHandle = null;

      function fmtTime(unix) {
        return new Date(unix * 1000).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      }
      function esc(s) {
        const d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
      }
      function render(events) {
        if (events.length === 0 && tl.querySelector('.empty')) return;
        if (tl.querySelector('.empty')) tl.innerHTML = '';
        for (const e of events) {
          const row = document.createElement('div');
          row.className = 'entry';
          row.innerHTML =
            '<span class="t">' + fmtTime(e.created_at) + '</span>' +
            '<span class="level level-' + esc(e.level) + '">' + esc(e.level) + '</span>' +
            '<span class="src">' + esc(e.source) + '</span>' +
            '<span class="msg">' + esc(e.message).slice(0, 300) + '</span>';
          tl.insertBefore(row, tl.firstChild);
          if (e.id > lastId) lastId = e.id;
        }
        while (tl.children.length > MAX_VISIBLE) tl.removeChild(tl.lastChild);
      }
      async function poll() {
        try {
          const params = new URLSearchParams({ since_id: String(lastId), limit: '100' });
          const r = await fetch('/admin/events?' + params.toString());
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const data = await r.json();
          // API devolve DESC (mais recente primeiro). Pra prepend na ordem certa, iteramos invertido.
          render(data.events.slice().reverse());
          statusEl.textContent = '(atualizado ' + new Date().toLocaleTimeString('pt-BR') + ')';
        } catch (err) {
          statusEl.textContent = '(erro: ' + err.message + ')';
        }
      }
      function startPolling() {
        if (pollHandle) return;
        poll();
        pollHandle = setInterval(poll, POLL_MS);
      }
      function stopPolling() {
        if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
      }
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopPolling();
        else startPolling();
      });
      startPolling();
    })();
  </script>

  <h2>Hoje</h2>
  <div class="grid">
    <div class="card">
      <div class="label">Leads criados</div>
      <div class="value">${stats.leads.today}</div>
      <div class="sub">7d: ${stats.leads.last7d} · total: ${stats.leads.total}</div>
    </div>
    <div class="card">
      <div class="label">Boletos enviados</div>
      <div class="value">${stats.boletos.today}</div>
      <div class="sub">7d: ${stats.boletos.last7d}</div>
    </div>
    <div class="card">
      <div class="label">Lembretes enviados</div>
      <div class="value">${stats.reminders.today}</div>
      <div class="sub">7d: ${stats.reminders.last7d}</div>
    </div>
    <div class="card">
      <div class="label">Webhooks recebidos</div>
      <div class="value">${stats.webhooks.today}</div>
      <div class="sub">7d: ${stats.webhooks.last7d}</div>
    </div>
  </div>

  <h2>Cron mensal Canopus</h2>
  ${cronBoletos}

  <h2>Webhooks por stage (últimos 7 dias)</h2>
  <table>
    <thead><tr><th>Stage ID</th><th class="num">Qtd</th></tr></thead>
    <tbody>${webhookRows}</tbody>
  </table>

  <h2>Últimos 20 eventos de erro/warn</h2>
  <table>
    <thead><tr><th>Quando</th><th>Level</th><th>Source</th><th>Mensagem</th></tr></thead>
    <tbody>${errorRows}</tbody>
  </table>

  <footer>Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: TZ })} — Travus Bot</footer>
</body>
</html>`;
}

export function adminDashboardHtmlHandler(req, res) {
  const auth = checkAuth(req);
  if (!auth.ok) return res.status(auth.code).json({ error: auth.error });

  try {
    const stats = getSystemEventStats();
    const runtime = getRuntimeInfo();
    res.type("html").send(renderHtml(stats, runtime));
  } catch (err) {
    console.error(`[ADMIN] erro ao renderizar dashboard: ${err?.message ?? err}`);
    res.status(500).json({ error: "internal", detail: err?.message });
  }
}

export function adminDashboardJsonHandler(req, res) {
  const auth = checkAuth(req);
  if (!auth.ok) return res.status(auth.code).json({ error: auth.error });

  try {
    res.json({ ...getSystemEventStats(), runtime: getRuntimeInfo() });
  } catch (err) {
    console.error(`[ADMIN] erro ao gerar JSON: ${err?.message ?? err}`);
    res.status(500).json({ error: "internal", detail: err?.message });
  }
}

export function adminEventsHandler(req, res) {
  const auth = checkAuth(req);
  if (!auth.ok) return res.status(auth.code).json({ error: auth.error });

  try {
    const sinceUnix = Number(req.query?.since) || 0;
    const sinceId = Number(req.query?.since_id) || 0;
    const limit = Number(req.query?.limit) || 100;
    const events = getRecentSystemEvents({ sinceId, sinceUnix, limit });
    res.json({ events, serverTime: Math.floor(Date.now() / 1000) });
  } catch (err) {
    console.error(`[ADMIN] erro em /admin/events: ${err?.message ?? err}`);
    res.status(500).json({ error: "internal", detail: err?.message });
  }
}
