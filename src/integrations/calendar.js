import { google } from "googleapis";

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID ?? "primary";
const TIMEZONE = "America/Sao_Paulo";
const EVENT_DURATION_MINUTES = 60;
const CREATED_PROXIMITY_MS = Number(process.env.CONFIRMACAO_INVITE_CREATED_WINDOW_MS ?? 300000);
const LOOKAHEAD_DAYS = Number(process.env.CONFIRMACAO_INVITE_LOOKAHEAD_DAYS ?? 60);

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

export async function createCalendarEvent({ nome, email, celular, renda_mensal, data_agendamento, hora_agendamento }) {
  if (!data_agendamento || !hora_agendamento) return null;

  const auth = getAuth();
  const calendar = google.calendar({ version: "v3", auth });

  const [h, m] = hora_agendamento.split(":").map(Number);
  const endTotalMin = h * 60 + m + EVENT_DURATION_MINUTES;
  const endH = String(Math.floor(endTotalMin / 60) % 24).padStart(2, "0");
  const endM = String(endTotalMin % 60).padStart(2, "0");

  const description = [
    `Celular: ${celular}`,
    email ? `Email: ${email}` : null,
    renda_mensal ? `Renda mensal: R$ ${renda_mensal}` : null,
  ].filter(Boolean).join("\n");

  const event = {
    summary: `Lead WhatsApp - ${nome}`,
    description,
    start: { dateTime: `${data_agendamento}T${hora_agendamento}:00`, timeZone: TIMEZONE },
    end: { dateTime: `${data_agendamento}T${endH}:${endM}:00`, timeZone: TIMEZONE },
  };

  const res = await calendar.events.insert({ calendarId: CALENDAR_ID, resource: event, sendUpdates: "none" });
  return res.data;
}

export async function findEventByDealTitle({ dealTitle, firstName, closedAt }) {
  if (!dealTitle) return null;

  const auth = getAuth();
  const calendar = google.calendar({ version: "v3", auth });

  const now = new Date();
  const max = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: now.toISOString(),
    timeMax: max.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    q: dealTitle,
    maxResults: 25,
  });

  const items = res.data.items ?? [];
  if (items.length === 0) return null;

  const closedAtMs = closedAt ? new Date(closedAt).getTime() : Date.now();

  const scored = items.map((ev) => {
    const text = `${ev.summary ?? ""} ${ev.description ?? ""}`;
    const titleMatch = text.toLowerCase().includes(dealTitle.toLowerCase());
    const firstNameMatch = firstName ? text.toLowerCase().includes(firstName.toLowerCase()) : false;
    const createdMs = ev.created ? new Date(ev.created).getTime() : 0;
    const proximityMs = Math.abs(createdMs - closedAtMs);
    return { ev, titleMatch, firstNameMatch, proximityMs };
  });

  const withTitle = scored.filter((s) => s.titleMatch);
  const pool = withTitle.length > 0 ? withTitle : scored.filter((s) => s.firstNameMatch);
  if (pool.length === 0) return null;

  pool.sort((a, b) => a.proximityMs - b.proximityMs);
  const best = pool[0];
  if (best.proximityMs > CREATED_PROXIMITY_MS && !best.titleMatch) return null;
  return best.ev;
}

export async function enrichEventDescriptionWithPhone(eventId, phone) {
  if (!eventId || !phone) return null;

  const auth = getAuth();
  const calendar = google.calendar({ version: "v3", auth });

  const current = await calendar.events.get({ calendarId: CALENDAR_ID, eventId });
  const description = current.data.description ?? "";
  const phoneRegex = new RegExp(`\\b${phone}\\b`);
  if (phoneRegex.test(description)) return current.data;

  const newDescription = description
    ? `${description}\n\nContato: ${phone}`
    : `Contato: ${phone}`;

  const res = await calendar.events.patch({
    calendarId: CALENDAR_ID,
    eventId,
    resource: { description: newDescription },
    sendUpdates: "none",
  });
  return res.data;
}

export function formatEventDateTimeBRT(isoDateTime) {
  const d = new Date(isoDateTime);
  const dataStr = d.toLocaleDateString("pt-BR", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "2-digit",
  });
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const horaStr = m === 0 ? `${h}h` : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return { data: dataStr, hora: horaStr };
}
