import { google } from "googleapis";
import {
  getLeadAndJidByCelular,
  hasReminderBeenSent,
  hasAnyReminderSent,
  recordReminderSent,
  getReminderSentAt,
  hasUserMessageAfter,
} from "../db.js";
import { sendWithPresence } from "../whatsapp/presence.js";
import { enqueue } from "../whatsapp/queue.js";

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID ?? "primary";
const POLL_INTERVAL_MS = 2 * 60 * 1000;
const PHONE_REGEX = /\b(55\d{10,11})\b/;
const LOOKAHEAD_MS = 26 * 60 * 60 * 1000;
const TZ = "America/Sao_Paulo";

let currentSock = null;
let intervalStarted = false;
let isRunning = false;

function getAuth() {
  const keyFile = process.env.GOOGLE_SA_KEY_FILE;
  if (!keyFile) throw new Error("GOOGLE_SA_KEY_FILE não configurado no .env");
  const subject = process.env.GOOGLE_IMPERSONATE_USER;
  return new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/calendar"],
    ...(subject ? { clientOptions: { subject } } : {}),
  });
}

function firstName(fullName) {
  return (fullName ?? "").trim().split(/\s+/)[0] || "";
}

function formatHora(date) {
  const hh = date.toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" });
  const mm = date.toLocaleString("en-GB", { timeZone: TZ, minute: "2-digit" });
  const h = parseInt(hh, 10);
  const m = parseInt(mm, 10);
  return m === 0 ? `${h}h` : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function brasiliaDateParts(date) {
  const iso = date.toLocaleDateString("en-CA", { timeZone: TZ });
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

function brasiliaTimeAt({ y, m, d }, hour, minute = 0) {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return new Date(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T${hh}:${mm}:00-03:00`);
}

function dayBefore(parts) {
  const d = new Date(Date.UTC(parts.y, parts.m - 1, parts.d) - 24 * 60 * 60 * 1000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

function brasiliaHour(date) {
  return parseInt(date.toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }), 10);
}

function isSameBrasiliaDay(a, b) {
  return a.toLocaleDateString("en-CA", { timeZone: TZ }) === b.toLocaleDateString("en-CA", { timeZone: TZ });
}

function reminderSchedule(meetingStart) {
  const meetingParts = brasiliaDateParts(meetingStart);
  const dayBeforeParts = dayBefore(meetingParts);
  const meetingHour = brasiliaHour(meetingStart);

  return {
    d1_morning:   { target: brasiliaTimeAt(dayBeforeParts, 9, 0),  windowMin: 240, dependsOn: null },
    d1_afternoon: { target: brasiliaTimeAt(dayBeforeParts, 17, 0), windowMin: 120, dependsOn: "d1_morning" },
    d1_evening:   { target: brasiliaTimeAt(dayBeforeParts, 20, 0), windowMin: 150, dependsOn: "d1_afternoon" },
    day_morning:  { target: brasiliaTimeAt(meetingParts, 9, 0),    windowMin: 120, dependsOn: null, skipIf: meetingHour < 11 },
    t15min:       { target: new Date(meetingStart.getTime() - 15 * 60 * 1000), windowMin: 12, dependsOn: null },
  };
}

function buildTemplate(type, nome, hora, meetLink, when) {
  const n = nome || "";
  switch (type) {
    case "immediate": {
      const despedida = when === "hoje" ? "Até logo!" : "Até amanhã!";
      return `Olá, ${n}! Tô confirmando nossa call ${when} às ${hora} ☺️\n\nSegue o Link do Meet: ${meetLink}\n\n${despedida}`;
    }
    case "d1_morning":
      return `Olá ${n}, bom dia! Tudo bom? Já estamos com tudo pronto para amanhã às ${hora} te apresentar ☺️. Tenha um ótimo dia!`;
    case "d1_afternoon":
      return `${n}, viu minha última mensagem?`;
    case "d1_evening":
      return `${n}, não sei se houve algum imprevisto, mas como trabalhamos com horário marcado e não conseguimos contato com você, que tal remarcarmos?`;
    case "day_morning":
      return `Oi ${n}, bom dia! Deixar o link da call abaixo das ${hora}. Até daqui a pouco, e um excelente dia!\n\n${meetLink}`;
    case "t15min":
      return `Oi ${n}, já já estou entrando na sala ☺️`;
    default:
      return null;
  }
}

export function startMeetingReminderScheduler(sock) {
  currentSock = sock;
  if (intervalStarted) return;
  intervalStarted = true;
  setInterval(runReminders, POLL_INTERVAL_MS);
  console.log("[REMINDER] scheduler de reuniões iniciado (poll cada 2min)");
}

async function runReminders() {
  if (!currentSock) return;
  if (isRunning) {
    console.warn("[REMINDER] execução anterior ainda em andamento, pulando este tick");
    return;
  }
  isRunning = true;
  try {
    await runRemindersBody();
  } finally {
    isRunning = false;
  }
}

async function runRemindersBody() {
  let events;
  try {
    const auth = getAuth();
    const calendar = google.calendar({ version: "v3", auth });
    const now = new Date();
    const max = new Date(now.getTime() + LOOKAHEAD_MS);
    const res = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: now.toISOString(),
      timeMax: max.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });
    events = res.data.items ?? [];
  } catch (err) {
    console.error(`[REMINDER] erro ao consultar Calendar: ${err?.message ?? err}`);
    return;
  }

  const nowMs = Date.now();

  for (const event of events) {
    if (!event.hangoutLink) continue;
    if (!event.start?.dateTime) continue;

    const text = `${event.summary ?? ""} ${event.description ?? ""}`;
    const match = text.match(PHONE_REGEX);
    if (!match) {
      console.warn(`[REMINDER] aviso: evento com Meet sem WhatsApp identificável: "${event.summary ?? "(sem título)"}" (id=${event.id})`);
      continue;
    }

    const celular = match[1];
    const lead = getLeadAndJidByCelular(celular);
    if (!lead) {
      console.warn(`[REMINDER] aviso: telefone ${celular} no evento "${event.summary}" não corresponde a nenhum lead`);
      continue;
    }

    const startTime = new Date(event.start.dateTime);
    const schedule = reminderSchedule(startTime);
    const hora = formatHora(startTime);
    const jid = lead.jid;
    const nome = firstName(lead.nome);

    // Immediate: evento criado em cima da hora (depois de toda a janela do d1_morning)
    // e ainda falta tempo suficiente até o início. Garante uma confirmação imediata.
    const d1MorningCfg = schedule.d1_morning;
    const d1MorningWindowEnd = d1MorningCfg.target.getTime() + d1MorningCfg.windowMin * 60000;
    const timeToEventMin = (startTime.getTime() - nowMs) / 60000;
    if (
      nowMs > d1MorningWindowEnd &&
      timeToEventMin > 30 &&
      !hasAnyReminderSent(event.id)
    ) {
      const when = isSameBrasiliaDay(startTime, new Date(nowMs)) ? "hoje" : "amanhã";
      const message = buildTemplate("immediate", nome, hora, event.hangoutLink, when);
      enqueue(jid, async () => {
        if (hasAnyReminderSent(event.id)) return;
        try {
          await sendWithPresence(currentSock, jid, message);
          recordReminderSent(event.id, "immediate");
          console.log(`[REMINDER] immediate → ${jid} (event=${event.id}, when=${when})`);
        } catch (err) {
          console.error(`[REMINDER] erro ao enviar immediate para ${jid}: ${err?.message ?? err}`);
        }
      });
      continue;
    }

    for (const [type, cfg] of Object.entries(schedule)) {
      if (cfg.skipIf) continue;
      const targetMs = cfg.target.getTime();
      const elapsedMin = (nowMs - targetMs) / 60000;
      if (elapsedMin < 0 || elapsedMin > cfg.windowMin) continue;
      if (hasReminderBeenSent(event.id, type)) continue;

      if (cfg.dependsOn) {
        const prevSent = getReminderSentAt(event.id, cfg.dependsOn);
        if (!prevSent) continue;
        if (hasUserMessageAfter(jid, prevSent)) continue;
      }

      const message = buildTemplate(type, nome, hora, event.hangoutLink);
      if (!message) continue;

      enqueue(jid, async () => {
        if (hasReminderBeenSent(event.id, type)) return;
        if (cfg.dependsOn) {
          const prevSent = getReminderSentAt(event.id, cfg.dependsOn);
          if (!prevSent || hasUserMessageAfter(jid, prevSent)) return;
        }
        try {
          await sendWithPresence(currentSock, jid, message);
          recordReminderSent(event.id, type);
          console.log(`[REMINDER] ${type} → ${jid} (event=${event.id})`);
        } catch (err) {
          console.error(`[REMINDER] erro ao enviar ${type} para ${jid}: ${err?.message ?? err}`);
        }
      });
    }
  }
}
