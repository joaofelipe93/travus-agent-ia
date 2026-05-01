import { google } from "googleapis";

const CALENDAR_ID = "luiz.muniz@travuscapital.com.br";
const TIMEZONE = "America/Sao_Paulo";
const EVENT_DURATION_MINUTES = 60;

function getAuth() {
  const keyFile = process.env.GOOGLE_SA_KEY_FILE;
  if (!keyFile) throw new Error("GOOGLE_SA_KEY_FILE não configurado no .env");
  return new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/calendar"],
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
