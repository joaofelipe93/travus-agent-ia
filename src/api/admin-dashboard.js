import { getSystemEventStats } from "../db.js";

const TZ = "America/Sao_Paulo";

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

function renderHtml(stats) {
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
    footer { margin-top: 30px; font-size: 0.8rem; opacity: 0.6; text-align: center; }
  </style>
</head>
<body>
  <h1>📊 Travus Bot — Admin Dashboard</h1>

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
    res.type("html").send(renderHtml(stats));
  } catch (err) {
    console.error(`[ADMIN] erro ao renderizar dashboard: ${err?.message ?? err}`);
    res.status(500).json({ error: "internal", detail: err?.message });
  }
}

export function adminDashboardJsonHandler(req, res) {
  const auth = checkAuth(req);
  if (!auth.ok) return res.status(auth.code).json({ error: auth.error });

  try {
    res.json(getSystemEventStats());
  } catch (err) {
    console.error(`[ADMIN] erro ao gerar JSON: ${err?.message ?? err}`);
    res.status(500).json({ error: "internal", detail: err?.message });
  }
}
