# Lembretes de reunião

Bot lembra o lead da call agendada com o consultor. Envia até 5 lembretes por evento: **imediato** (após criação), **dia anterior** (manhã/tarde/noite) e **T-15min**.

## Gatilho

Scheduler `startMeetingReminderScheduler` roda a cada **2 minutos**, consulta o Google Calendar dos próximos 26h, e dispara lembretes que caíram na janela.

## Pré-requisitos no Google Calendar

Diferente dos outros fluxos, aqui a preparação é no **Google Calendar do consultor** (email configurado em `GOOGLE_CALENDAR_ID`), não no Piperun. Duas situações:

### Situação A — Event criado pelo bot (durante agendamento com a Ana)

**Nada a fazer manualmente.** A Ana cria o event automaticamente ao capturar o lead completo, injetando o telefone na descrição em formato `55XXXXXXXXXXX` e mantendo o link do Meet. Fica assim:

```
Título:      Lead WhatsApp - <Nome do Lead>
Descrição:   Celular: 55XXNNNNNNNNN
             Email: <email do lead>
             Renda mensal: R$ <valor>
```

### Situação B — Consultor cria event à mão (reunião extra, reagendamento, indicação)

Pra que o bot mande lembretes, **o event tem que ter 3 coisas**:

#### 1. Telefone do lead no formato E.164 sem pontuação

No **título OU na descrição** (qualquer um dos dois basta), o número precisa aparecer como `55` + DDD (2 dígitos) + número (8 ou 9 dígitos), tudo grudado. Regex que o bot procura: `\b(55\d{10,11})\b`.

✅ **Aceita** (13 dígitos — DDI + DDD + 9 dígitos):
```
55XX9NNNNNNNN    (ex: 55119NNNNNNNN)
```

✅ **Aceita** (12 dígitos — DDI + DDD + 8 dígitos, fixo):
```
55XX9NNNNNNNN    (celular 9 dígitos → 13 total)
55XXNNNNNNNN     (fixo 8 dígitos → 12 total)
```

❌ **NÃO aceita** (bot ignora o evento):
```
55 XX 9NNNN-NNNN     ← tem espaço e hífen
+55 XX 9 NNNN-NNNN   ← tem + e espaços
(XX) 9NNNN-NNNN      ← falta o 55 na frente
XX 9NNNN-NNNN        ← falta o 55 e tem espaço
```

#### 2. Link do Google Meet (`hangoutLink`)

Ao criar o event, marcar **"Adicionar videochamada do Google Meet"** no formulário. Sem isso, o bot pula o evento inteiro (`if (!event.hangoutLink) continue`).

#### 3. Lead precisa existir na tabela `leads` do banco

O bot faz `SELECT ... FROM leads WHERE celular = ?`. Se o número no evento não bate com nenhum lead que já conversou pela Ana no WhatsApp, o log mostra:

```
[REMINDER] aviso: telefone 55... não corresponde a nenhum lead
```

Nesse caso o lembrete **não sai**. Ver seção "Casos que exigem ação" abaixo.

### Template pronto pra copiar

**Título** (formato recomendado):
```
Call Travus — {NOME DO LEAD} 55{DDD}{NÚMERO}
```

Exemplo (com placeholders):
```
Call Travus — <Nome do Lead> 55XX9NNNNNNNN
```

**Descrição** (formato recomendado, opcional se telefone já tá no título):
```
Consultoria financeira.
Contato: 55XX9NNNNNNNN
Origem: indicação
```

### Padrão que falha — evento manual sem telefone

Padrão comum de erro: consultor cria evento com título genérico e nome do lead entre parênteses na descrição, sem o telefone em formato E.164.

```
Título:      1ª Reunião
Descrição:   (NOME DO LEAD)
Meet:        sim
```

Resultado no log do bot:
```
[REMINDER] aviso: evento com Meet sem WhatsApp identificável: "1ª Reunião" (id=<eventId>)
```

**Por que falha:** nem o título nem a descrição contêm um número no formato `55XXXXXXXXXXX`. O bot não tem como associar o evento ao lead — o nome não é usado como chave (nome comum tem chance de bater com lead errado).

**Como deveria ser criado** (mesmo evento, corrigido):

```
Título:      1ª Reunião — <Nome do Lead> 55XX9NNNNNNNN
Descrição:   Contato: 55XX9NNNNNNNN
Meet:        sim
```

Com isso o bot acharia o lead na tabela `leads` (se ele já passou pelo bot) e dispararia os lembretes D-1 → dia → T-15min.

### Casos que exigem ação do consultor

| Situação | Log do bot | Ação |
|---|---|---|
| Evento sem número no título/descrição | `evento com Meet sem WhatsApp identificável` | Editar evento e adicionar `55XXXXXXXXXXX` |
| Evento com número, mas lead não conversou pelo WhatsApp | `telefone 55... não corresponde a nenhum lead` | Sem lembrete automático. Consultor lembra pelo canal habitual |
| Evento sem Meet | (silencioso) | Adicionar Meet ao evento se quiser lembrete |
| Evento pra pessoa que passou pelo bot com outro número | `telefone ... não corresponde a nenhum lead` | Colocar no evento o número que a pessoa usou no WhatsApp (não o secundário) |

### Janela de tempo do scheduler

O scheduler consulta o Calendar a cada **2 minutos** e olha apenas eventos das próximas **26 horas** ([LOOKAHEAD_MS](../../src/integrations/meeting-reminders.js#L16)).

**Consequência prática:** um evento marcado pra sexta 16h só entra na janela na quinta ~14h. Se você quer verificar se o bot está "vendo" seu evento hoje mas ele é depois de amanhã, o log NÃO vai mostrar nada relacionado ainda — está correto. Aguarde a janela.

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

Placeholders internos: `${nome}`, `${hora}` (ex: "16h" ou "16:30"), `${data}` (DD/MM), `${meetLink}`, `${when}` ("hoje" ou "amanhã", só no `immediate`).

| Tipo | Texto |
|---|---|
| `immediate` | "Olá, {nome}! Tô confirmando nossa call {hoje/amanhã} às {hora} ☺️\n\nSegue o Link do Meet: {meetLink}\n\n{Até logo/Até amanhã}!" |
| `d1_morning` | "Olá, {nome}, Bom dia! Tudo bom?\n\nJá estamos com tudo pronto para te apresentar amanhã, {data}, as {hora}hrs.\n\nTenha um ótimo dia!" |
| `d1_afternoon` | "{nome}, viu minha última mensagem?" |
| `d1_evening` | "{nome}, não sei se houve algum imprevisto, mas como trabalhamos com horário marcado e não conseguimos contato com você, que tal remarcarmos?" |
| `day_morning` | "Oi {nome}, Bom dia! Deixar o link da call abaixo das {hora}hrs. Até daqui a pouco, e um excelente dia!\n{meetLink}" |
| `t15min` | "Oi {nome}, nosso especialista que falará com você, que é o {CONSULTOR_NOME}, em 15 minutos já estará na sala." (se `CONSULTOR_NOME` vazio, cai em "nosso especialista que falará com você em 15 minutos já estará na sala") |

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
- Título ou descrição contendo um número no formato `55XX9NNNNNNNN`
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
