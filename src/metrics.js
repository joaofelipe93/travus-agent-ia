import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "prom-client";

export const registry = new Registry();
registry.setDefaultLabels({ service: "travus-agent-ia" });
collectDefaultMetrics({ register: registry });

export const messagesInTotal = new Counter({
  name: "messages_in_total",
  help: "Mensagens recebidas do WhatsApp processadas pelo bot",
  registers: [registry],
});

export const messagesOutTotal = new Counter({
  name: "messages_out_total",
  help: "Mensagens enviadas pelo bot ao WhatsApp",
  labelNames: ["kind"],
  registers: [registry],
});

export const agentRequestsTotal = new Counter({
  name: "agent_requests_total",
  help: "Chamadas ao endpoint do agente DigitalOcean",
  labelNames: ["status"],
  registers: [registry],
});

export const agentRequestDuration = new Histogram({
  name: "agent_request_duration_seconds",
  help: "Latência das chamadas ao agente DigitalOcean",
  buckets: [0.5, 1, 2, 5, 10, 20, 40],
  registers: [registry],
});

export const leadsCapturedTotal = new Counter({
  name: "leads_captured_total",
  help: "Leads completos capturados localmente",
  registers: [registry],
});

export const leadsRejectedTotal = new Counter({
  name: "leads_rejected_total",
  help: "Leads rejeitados antes de capturar",
  labelNames: ["reason"],
  registers: [registry],
});

export const piperunRequestsTotal = new Counter({
  name: "piperun_requests_total",
  help: "Envios pro webhook do Piperun",
  labelNames: ["status"],
  registers: [registry],
});

export const piperunRequestDuration = new Histogram({
  name: "piperun_request_duration_seconds",
  help: "Latência das chamadas ao webhook do Piperun",
  buckets: [0.1, 0.3, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

export const calendarRequestsTotal = new Counter({
  name: "calendar_requests_total",
  help: "Chamadas à API do Google Calendar",
  labelNames: ["operation", "status"],
  registers: [registry],
});

export const followupsSentTotal = new Counter({
  name: "followups_sent_total",
  help: "Mensagens de follow-up enviadas",
  labelNames: ["step"],
  registers: [registry],
});

export const remindersSentTotal = new Counter({
  name: "reminders_sent_total",
  help: "Lembretes de reunião enviados",
  labelNames: ["type"],
  registers: [registry],
});

export const whatsappConnected = new Gauge({
  name: "whatsapp_connected",
  help: "1 quando a sessão Baileys está aberta, 0 caso contrário",
  registers: [registry],
});

export const queueTasksFailedTotal = new Counter({
  name: "queue_tasks_failed_total",
  help: "Tarefas da fila por-JID que falharam",
  registers: [registry],
});
