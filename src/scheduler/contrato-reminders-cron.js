import cron from "node-cron";
import { runContratoReminders } from "../jobs/contrato-reminders.js";
import { getSock } from "../api/index.js";
import { alertConsultor } from "../utils/alerts.js";
import { recordSystemEvent } from "../db.js";

const DEFAULT_SCHEDULE = "0 9 * * *";
const TZ = "America/Sao_Paulo";

let scheduled = false;

export function startContratoRemindersCron() {
  if (scheduled) return;
  if (process.env.CONTRATO_REMINDER_ENABLED === "false") {
    console.log("[CONTRATO_REMINDER_CRON] desativado via CONTRATO_REMINDER_ENABLED=false");
    return;
  }

  const schedule = process.env.CONTRATO_REMINDER_CRON ?? DEFAULT_SCHEDULE;
  if (!cron.validate(schedule)) {
    console.error(`[CONTRATO_REMINDER_CRON] expressão inválida "${schedule}", abortando agendamento`);
    return;
  }

  cron.schedule(
    schedule,
    async () => {
      console.log("[CONTRATO_REMINDER_CRON] disparado");
      recordSystemEvent("info", "contrato-reminders-cron", "cron disparado");
      const sock = getSock();
      try {
        await runContratoReminders(sock);
        // runContratoReminders registra o resultado próprio baseado no summary
      } catch (err) {
        console.error(`[CONTRATO_REMINDER_CRON] erro no run: ${err?.message ?? err}`);
        await alertConsultor(
          `⚠️ Cron de lembretes de parcelas do contrato falhou:\n\n${err?.message ?? err}`,
          { dedupeKey: "contrato-reminders-cron-error", source: "contrato-reminders-cron" },
        );
      }
    },
    { timezone: TZ }
  );

  scheduled = true;
  console.log(`[CONTRATO_REMINDER_CRON] agendado: "${schedule}" (${TZ})`);
  recordSystemEvent("info", "boot", `contrato-reminders-cron agendado: "${schedule}" (${TZ})`);
}
