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
        id: email,
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

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Piperun respondeu com HTTP ${res.status}`);
  return res.json();
}
