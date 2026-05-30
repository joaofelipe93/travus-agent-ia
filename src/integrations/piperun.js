import { piperunRequestsTotal, piperunRequestDuration } from "../metrics.js";

const ENDPOINT = `https://app.pipe.run/webservice/integradorJson?hash=${process.env.PIPERUN_HASH}`;

export async function enviarLeadPipeRun({ nome, email, celular, renda_mensal, data_agendamento, hora_agendamento }) {
  if (!process.env.PIPERUN_HASH) {
    throw new Error("Variável PIPERUN_HASH não configurada no .env.");
  }

  const agendamento = [data_agendamento, hora_agendamento].filter(Boolean).join(" às ");

  const body = {
    rules: { update: true, status: "open", equal_pipeline: true, filter_status_update: "open" },
    leads: [
      {
        id: celular,
        title: `Lead WhatsApp Travus - ${nome}`,
        name: nome,
        email: email,
        mobile_phone: celular,
        value: renda_mensal,
        notes: [
          `Renda mensal: ${renda_mensal}`,
          agendamento ? `Agendamento: ${agendamento}` : null,
        ].filter(Boolean),
      },
    ],
  };

  const endTimer = piperunRequestDuration.startTimer();
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    endTimer();
    piperunRequestsTotal.inc({ status: "network_error" });
    throw err;
  }
  endTimer();

  if (!res.ok) {
    piperunRequestsTotal.inc({ status: `http_${res.status}` });
    const responseBody = await res.text().catch(() => "(corpo da resposta ilegível)");
    throw new Error(
      `Piperun respondeu com HTTP ${res.status}. Payload enviado: ${JSON.stringify(body)}. Resposta: ${responseBody.slice(0, 500)}`
    );
  }
  piperunRequestsTotal.inc({ status: "ok" });
  return res.json();
}
