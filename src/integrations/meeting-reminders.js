import { google } from "googleapis";
import {
  getLeadAndJidByCelular,
  hasReminderBeenSent,
  recordReminderSent,
} from "../db.js";
import { sendWithPresence } from "../whatsapp/presence.js";
import { enqueue } from "../whatsapp/queue.js";

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID ?? "primary";
const POLL_INTERVAL_MS = 2 * 60 * 1000;
const PHONE_REGEX = /\b(55\d{10,11})\b/;
const LOOKAHEAD_MS = 25 * 60 * 60 * 1000;

const REMINDERS = [
  { type: "1d",    offsetMin: 24 * 60, maxDelayMin: 4 * 60 },
  { type: "2h",    offsetMin: 2 * 60,  maxDelayMin: 75 },
  { type: "30min", offsetMin: 30,      maxDelayMin: 25 },
];

let currentSock = null;
let intervalStarted = false;

function getAuth() {
  const keyFile = process.env.GOOGLE_SA_KEY_FILE;
  if (!keyFile) throw new Error("GOOGLE_SA_KEY_FILE não configurado no .env");
  return new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  });
}

function formatTime(date) {
  return date.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function firstName(fullName) {
  return (fullName ?? "").trim().split(/\s+/)[0] || "";
}

function buildMessage(type, lead, startTime, meetLink) {
  const nome = firstName(lead.nome);
  const hora = formatTime(startTime);
  const saudacao = nome ? `Oi, ${nome}!` : "Oi!";

  switch (type) {
    case "1d":
      return `${saudacao} Passando pra lembrar: amanhã às ${hora} tem sua reunião com o especialista.\n\nLink do Meet: ${meetLink}`;
    case "2h":
      return `${saudacao} Hoje às ${hora} tem sua reunião com o especialista. Tô confirmando que você consegue!\n\nLink do Meet: ${meetLink}`;
    case "30min":
      return `${saudacao} Em 30 minutos começa sua reunião com o especialista.\n\nLink: ${meetLink}`;
    default:
      return "";
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

  const now = Date.now();

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

    for (const reminder of REMINDERS) {
      const targetTime = startTime.getTime() - reminder.offsetMin * 60 * 1000;
      const elapsedMin = (now - targetTime) / 60000;
      if (elapsedMin < 0 || elapsedMin > reminder.maxDelayMin) continue;
      if (hasReminderBeenSent(event.id, reminder.type)) continue;

      const message = buildMessage(reminder.type, lead, startTime, event.hangoutLink);
      const jid = lead.jid;

      enqueue(jid, async () => {
        if (hasReminderBeenSent(event.id, reminder.type)) return;
        try {
          await sendWithPresence(currentSock, jid, message);
          recordReminderSent(event.id, reminder.type);
          console.log(`[REMINDER] ${reminder.type} → ${jid} (event=${event.id})`);
        } catch (err) {
          console.error(`[REMINDER] erro ao enviar ${reminder.type} para ${jid}: ${err?.message ?? err}`);
        }
      });
    }
  }
}
