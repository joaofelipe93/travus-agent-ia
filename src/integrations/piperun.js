const ENDPOINT = `https://app.pipe.run/webservice/integradorJson?hash=${process.env.PIPERUN_HASH}`;

function formatCurrencyBRL(input) {
  const n = Number(String(input ?? "").replace(/\D/g, ""));
  if (!Number.isFinite(n) || n === 0) return String(input ?? "");
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatBrazilianPhone(input) {
  const d = String(input ?? "").replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) {
    return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  }
  if (d.length === 11) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  return String(input ?? "");
}

export async function enviarLeadPipeRun({ nome, email, celular, renda_mensal, data_agendamento, hora_agendamento }) {
  if (!process.env.PIPERUN_HASH) {
    throw new Error("Variável PIPERUN_HASH não configurada no .env.");
  }

  const agendamento = [data_agendamento, hora_agendamento].filter(Boolean).join(" às ");
  const valorFormatado = formatCurrencyBRL(renda_mensal);
  const telefoneFormatado = formatBrazilianPhone(celular);

  const body = {
    rules: { update: true, status: "open", equal_pipeline: true, filter_status_update: "open" },
    leads: [
      {
        id: email,
        title: `Lead WhatsApp Travus - ${nome}`,
        name: nome,
        email: email,
        mobile_phone: telefoneFormatado,
        value: valorFormatado,
        notes: [
          `Renda mensal informada: ${valorFormatado}`,
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

  if (!res.ok) {
    const responseBody = await res.text().catch(() => "(corpo da resposta ilegível)");
    throw new Error(
      `Piperun respondeu com HTTP ${res.status}. Payload enviado: ${JSON.stringify(body)}. Resposta: ${responseBody.slice(0, 500)}`
    );
  }

  const json = await res.json();
  if (json?.success === false) {
    const motivo = json.data?.friendlyMsg ?? json.message ?? "(sem detalhe)";
    throw new Error(
      `Piperun retornou success=false. Motivo: ${motivo}. Payload enviado: ${JSON.stringify(body)}. Resposta: ${JSON.stringify(json).slice(0, 500)}`
    );
  }
  return json;
}
