# Google Calendar

Cria e lê events da agenda do consultor da Travus. Usada em [captação de lead](../fluxos/captacao-lead.md) e [lembretes de reunião](../fluxos/lembretes-reuniao.md).

## Auth

**Service Account com Domain-Wide Delegation (DWD)** impersonando o consultor.

### Setup

1. GCP Console → Service Accounts → cria conta
2. Baixa JSON key
3. Google Workspace Admin → Security → API Controls → Domain-wide Delegation → adiciona a service account com scope `https://www.googleapis.com/auth/calendar`
4. Sobe o JSON pra VPS em path definido por `GOOGLE_SA_KEY_FILE`
5. Env `GOOGLE_IMPERSONATE_USER` = email do usuário a impersonar (mesmo do `GOOGLE_CALENDAR_ID`)

### Fluxo no código

```js
new google.auth.GoogleAuth({
  keyFile,
  scopes: ["https://www.googleapis.com/auth/calendar"],
  clientOptions: { subject: process.env.GOOGLE_IMPERSONATE_USER },
})
```

O `subject` é o que faz DWD — sem ele, a auth funciona mas o Calendar retorna erro de permissão.

## Endpoints usados

- `calendar.events.insert` — cria event de 60 min com link Meet automático
- `calendar.events.list` — busca próximos 26h de events com Meet

## Formato do event criado

```json
{
  "summary": "Travus Capital — <Nome do Lead>",
  "description": "Lead: 55XX9NNNNNNNN\n(gerado pelo bot)",
  "start": { "dateTime": "2026-06-24T10:00:00-03:00", "timeZone": "America/Sao_Paulo" },
  "end":   { "dateTime": "2026-06-24T11:00:00-03:00", "timeZone": "America/Sao_Paulo" },
  "conferenceData": { "createRequest": { ... } }
}
```

O bot também injeta o número do lead no título ou description (regex `\b(55\d{10,11})\b` no cron de lembretes lê depois).

## Env vars

| Var | Uso |
|---|---|
| `GOOGLE_SA_KEY_FILE` | Path do JSON da SA |
| `GOOGLE_CALENDAR_ID` | Email do calendário |
| `GOOGLE_IMPERSONATE_USER` | Email pra DWD |

## Pegadinhas

- **Se DWD não estiver configurado** no Workspace, `insert` retorna 403 mesmo com auth ok.
- **Timezone** é sempre `America/Sao_Paulo` (offset `-03:00`).
- **Duração fixa em 60 min** — hardcoded. Pra mudar, editar `src/integrations/calendar.js`.
- **Regex do telefone no lembrete** só reconhece formato `55XXXXXXXXXXX` (DDI+DDD+número) — se o event for criado manualmente com o telefone em outro formato, lembretes não saem.
