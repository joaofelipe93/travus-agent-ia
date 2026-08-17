import cron from "node-cron";
import { runMonthlyBoletos } from "../jobs/monthly-boletos.js";
import { getSock } from "../api/index.js";
import { alertConsultor } from "../utils/alerts.js";
import { recordSystemEvent } from "../db.js";

const DEFAULT_SCHEDULE = "0 9 8 * *";
const TZ = "America/Sao_Paulo";

let scheduled = false;

export function startBoletosCron() {
  if (scheduled) return;
  if (process.env.BOLETOS_ENABLED === "false") {
    console.log("[BOLETOS_CRON] desativado via BOLETOS_ENABLED=false");
    return;
  }

  const schedule = process.env.BOLETOS_CRON ?? DEFAULT_SCHEDULE;
  if (!cron.validate(schedule)) {
    console.error(`[BOLETOS_CRON] expressão inválida "${schedule}", abortando agendamento`);
    return;
  }

  cron.schedule(
    schedule,
    async () => {
      console.log("[BOLETOS_CRON] disparado");
      recordSystemEvent("info", "boletos-cron", "cron disparado");
      const sock = getSock();
      try {
        await runMonthlyBoletos(sock);
        recordSystemEvent("info", "boletos-cron", "cron concluído com sucesso");
      } catch (err) {
        console.error(`[BOLETOS_CRON] erro no run: ${err?.message ?? err}`);
        await alertConsultor(
          `⚠️ Cron mensal de boletos (Canopus) falhou:\n\n${err?.message ?? err}\n\nVerifique os logs.`,
          { dedupeKey: "boletos-cron-error", source: "boletos-cron" },
        );
      }
    },
    { timezone: TZ }
  );

  scheduled = true;
  console.log(`[BOLETOS_CRON] agendado: "${schedule}" (${TZ})`);
}
