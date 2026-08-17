import cron from "node-cron";
import { runContratoAtrasos } from "../jobs/contrato-atrasos.js";
import { getSock } from "../api/index.js";
import { alertConsultor } from "../utils/alerts.js";
import { recordSystemEvent } from "../db.js";

const DEFAULT_SCHEDULE = "0 9 * * *";
const TZ = "America/Sao_Paulo";

let scheduled = false;

export function startContratoAtrasosCron() {
  if (scheduled) return;
  if (process.env.ATRASO_ENABLED === "false") {
    console.log("[ATRASO_CRON] desativado via ATRASO_ENABLED=false");
    return;
  }

  const schedule = process.env.ATRASO_CRON ?? DEFAULT_SCHEDULE;
  if (!cron.validate(schedule)) {
    console.error(`[ATRASO_CRON] expressão inválida "${schedule}", abortando agendamento`);
    return;
  }

  cron.schedule(
    schedule,
    async () => {
      console.log("[ATRASO_CRON] disparado");
      recordSystemEvent("info", "atrasos-cron", "cron disparado");
      const sock = getSock();
      try {
        await runContratoAtrasos(sock);
        recordSystemEvent("info", "atrasos-cron", "cron concluído com sucesso");
      } catch (err) {
        console.error(`[ATRASO_CRON] erro no run: ${err?.message ?? err}`);
        await alertConsultor(
          `⚠️ Cron de atrasos do contrato falhou:\n\n${err?.message ?? err}`,
          { dedupeKey: "atrasos-cron-error", source: "atrasos-cron" },
        );
      }
    },
    { timezone: TZ }
  );

  scheduled = true;
  console.log(`[ATRASO_CRON] agendado: "${schedule}" (${TZ})`);
}
