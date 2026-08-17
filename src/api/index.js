import express from "express";
import { piperunWebhookHandler } from "./webhook-piperun.js";
import { novoClienteWebhookHandler } from "./webhook-novo-cliente.js";
import { emissaoContratoWebhookHandler } from "./webhook-emissao-contrato.js";
import { confirmacaoInviteWebhookHandler } from "./webhook-confirmacao-invite.js";
import { adminDashboardHtmlHandler, adminDashboardJsonHandler } from "./admin-dashboard.js";

let currentSock = null;
let started = false;

export function setSock(sock) {
  currentSock = sock;
}

export function getSock() {
  return currentSock;
}

export function startApi() {
  if (started) return;
  started = true;

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", whatsapp_connected: currentSock !== null });
  });

  app.post("/webhook/piperun", piperunWebhookHandler);
  app.post("/webhook/piperun/novo-cliente", novoClienteWebhookHandler);
  app.post("/webhook/piperun/emissao-contrato", emissaoContratoWebhookHandler);
  app.post("/webhook/piperun/confirmacao-invite", confirmacaoInviteWebhookHandler);

  app.get("/admin/dashboard", adminDashboardHtmlHandler);
  app.get("/admin/dashboard.json", adminDashboardJsonHandler);

  const port = Number(process.env.API_PORT ?? 3000);
  app.listen(port, () => {
    console.log(`[API] ouvindo na porta ${port}`);
  });
}
