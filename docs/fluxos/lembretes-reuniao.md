# Lembretes de reunião

Bot lembra o lead da call agendada com o consultor. Envia até 5 lembretes por evento: **imediato** (após criação), **dia anterior** (manhã/tarde/noite) e **T-15min**.

## Gatilho

Scheduler `startMeetingReminderScheduler` roda a cada **2 minutos**, consulta o Google Calendar dos próximos 26h, e dispara lembretes que caíram na janela.

## Pré-requisitos no Google Calendar

Diferente dos outros fluxos, aqui a preparação é no **Google Calendar do consultor**, não no Piperun. Duas situações:

### Situação A — Event criado pelo bot (durante agendamento com a Ana)

**Nada a fazer manualmente.** A Ana cria o event automaticamente ao capturar o lead completo, injetando o telefone na descrição em formato `55XXXXXXXXXXX` e mantendo o link do Meet.

### Situação B — Consultor cria event à mão (ex: reunião extra, reagendamento)

Pra que o bot mande lembretes, **o event tem que ter 2 coisas**:

1. **Telefone do lead** no título OU na descrição, no formato `55` + DDD + número **sem espaços ou pontuação**. Regex do bot: `\b(55\d{10,11})\b`.

   ✅ Aceita:
   - `"558491646369"` (13 dígitos)
   - `"5511987654321"` (13 dígitos)

   ❌ Não aceita:
   - `"55 84 99164-6369"` (com espaços/hífen)
   - `"+55 84 9 9164-6369"` (com +)
   - `"84 99164-6369"` (sem DDI)

2. **Link do Meet** (`hangoutLink` no Calendar). Google adiciona automaticamente se você marcar "Adicionar chamada do Google Meet" ao criar o event.

### Exemplos práticos

**Título válido** (leva ao envio de lembrete):
```
Call Travus — João Felipe 558491646369
```

**Descrição válida** (também funciona):
```
Reagendamento da consultoria.
Contato: 558491646369
```

### E se o lead não estiver na tabela `leads` do banco?

Bot loga `[REMINDER] aviso: telefone 55... não corresponde a nenhum lead`. Não envia lembrete.

Situações comuns:
- Event pra pessoa que **nunca passou pelo bot** (indicação, cliente antigo etc)
- Lead antigo com dados desatualizados no banco

Se precisar registrar manualmente pra que o lembrete funcione: preencher a tabela `leads` com nome, celular e `conversation_id`. Sem script pronto pra isso (ver [troubleshooting](../operacao/troubleshooting.md)).

## Componentes

- `src/integrations/meeting-reminders.js` — scheduler + envio (todo o fluxo num arquivo)
- `googleapis` — lista events do Calendar
- `src/db.js` — `getLeadAndJidByCelular` (relaciona telefone do evento ao lead), `meeting_reminders` (idempotência), `hasUserMessageAfter` (dedupe extra)

## Sequência

```
1. A cada 2min → runReminders()
2. Calendar API: lista events com hangoutLink (Meet) das próximas 26h
3. Pra cada event:
   a. Extrai telefone via regex \b(55\d{10,11})\b no título+descrição
   b. getLeadAndJidByCelular(celular) → { nome, jid }
      Se não achar: log warn (evento criado manualmente sem passar pelo bot)
   c. Calcula reminderSchedule(startTime):
      - immediate: fallback caso event tenha sido criado tarde
      - d1_morning: dia anterior às 09:00
      - d1_afternoon: dia anterior às 17:00
      - d1_evening: dia anterior às 20:00
      - day_morning: manhã do dia (se call for após 11h)
      - t15min: 15 min antes
   d. Cada lembrete tem uma janela (windowMin) e um dependsOn:
      - Se hoje/agora cai na janela do lembrete
      - E o lembrete "dependsOn" já foi enviado (ou é null)
      - E ainda não foi enviado (recordReminderSent com UNIQUE)
      - E o lead não respondeu no meio-tempo (hasUserMessageAfter)
      → envia
```

## Templates de mensagem

| Tipo | Texto (resumo) |
|---|---|
| `immediate` | "Tô confirmando nossa call hoje/amanhã às XX. Segue o link do Meet: ..." |
| `d1_morning` | "Bom dia! Já tá tudo pronto pra amanhã às XX. Tenha um ótimo dia!" |
| `d1_afternoon` | "Viu minha última mensagem?" |
| `d1_evening` | "Não sei se houve algum imprevisto, que tal remarcarmos?" |
| `day_morning` | "Bom dia! Deixar o link da call abaixo das XX. Até daqui a pouco!" |
| `t15min` | "Já já estou entrando na sala ☺️" |

## Idempotência

- Tabela `meeting_reminders` com `UNIQUE(event_id, reminder_type)`.
- Se um lembrete já foi enviado, `hasReminderBeenSent` bloqueia.

## Dedupe extra

Se o lead **respondeu depois do último lembrete enviado**, o próximo é pulado (`hasUserMessageAfter`). Evita cobrar quando o lead já demonstrou que tá vivo.

## Env vars

| Var | Uso |
|---|---|
| `GOOGLE_SA_KEY_FILE` | Caminho do JSON da service account |
| `GOOGLE_CALENDAR_ID` | E-mail do calendário do consultor |
| `GOOGLE_IMPERSONATE_USER` | Domain-Wide Delegation |

## Como testar

Cria event no Google Calendar do consultor com:
- Título ou descrição contendo um número no formato `558491646369`
- Link do Meet (Calendar cria por padrão)
- Startdate: amanhã às 15h (pra ver d1_afternoon/d1_evening)

Bot deve mandar os lembretes conforme janela.

Se quiser forçar teste rápido: cria event que começa daqui a 20 min, o t15min dispara em ~5 min.

## O que pode dar errado

| Sintoma | Causa |
|---|---|
| `evento com Meet sem WhatsApp identificável` | Título/descrição do event não tem número no formato 55XXXXXXXXXXX |
| `telefone 55... não corresponde a nenhum lead` | Event criado manualmente, sem passar pelo bot (lead não está na tabela `leads`) |
| Nenhum lembrete chega | Google Calendar não retorna events — checar service account + DWD |
| Lembrete duplicado | Não devia acontecer; `meeting_reminders` UNIQUE bloqueia |
