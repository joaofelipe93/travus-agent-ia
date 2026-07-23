# Confirmação de invite pós-agendamento

Quando o consultor dá **"Ganhar e Agendar"** no funil Prospecção, o Piperun ganha o deal, cria um evento no Google Calendar e dispara webhook. O bot então **envia uma mensagem no WhatsApp confirmando o convite** e enriquece o evento do Calendar com o telefone do lead (o que também destrava os lembretes do [scheduler existente](./lembretes-reuniao.md)).

## Gatilho

Webhook `POST /webhook/piperun/confirmacao-invite` disparado pelo Piperun quando:
- `stage.id === 648386` (Agendamento / Funil Prospecção — configurável via `CONFIRMACAO_INVITE_STAGE_ID`)
- `status === 1` (ganho)
- `action.trigger_type === "Uma oportunidade for ganha"`

## Pré-requisitos no CRM

Antes do consultor dar "Ganhar e Agendar":

- Pessoa do deal precisa ter **telefone principal** preenchido (`contact_phones[].number`). Se `is_main === true` não existir em nenhum item, o bot usa o primeiro do array (fallback).
- Telefone precisa **existir no WhatsApp** (validado via `sock.onWhatsApp`).
- Deal precisa ter `title` preenchido — é a âncora usada pra achar o evento no Calendar.

## Pré-requisitos no Calendar

Nenhum — o evento é criado automaticamente pelo Piperun quando o consultor dá "Ganhar e Agendar". Basta que a integração Piperun ↔ Google Calendar esteja ativa na conta do consultor.

O bot **não depende** do evento ter o telefone na descrição — ele localiza por `deal.title` + proximidade temporal e, se achar, adiciona o telefone ele mesmo.

## Componentes

- `src/api/webhook-confirmacao-invite.js` — handler do webhook
- `src/integrations/calendar.js` — `findEventByDealTitle`, `enrichEventDescriptionWithPhone`, `formatEventDateTimeBRT`
- `src/db.js` — `webhook_dispatches` (idempotência), `ensureContact`
- `googleapis` — `events.list` (com param `q` de full-text) + `events.patch`

## Sequência

```
1. POST /webhook/piperun/confirmacao-invite
2. Valida stage.id === 648386, status === 1, trigger_type esperado
3. Extrai telefone via pickPhone(contact_phones) — fallback pro [0] se nenhum is_main
4. hasWebhookDispatched(person_id, stage_id) → skip se já enviado
5. sock.onWhatsApp(phone) → valida existência
6. ensureContact + recordWebhookDispatch
7. Responde 202 ao Piperun imediatamente (evita timeout)
8. Enfileira job async (enqueue por jid):
   a. locateEventWithRetry (3× a cada 3s):
      - calendar.events.list({ q: deal.title, timeMin: now, timeMax: now+60d })
      - filtra por título contendo deal.title (ou firstName como fallback)
      - ordena por proximidade temporal (event.created ≈ deal.closed_at)
      - retorna o mais próximo (janela default: 5min)
   b. Se achou:
      - enrichEventDescriptionWithPhone(event.id, phone) → patch da descrição
      - formatEventDateTimeBRT(event.start.dateTime) → { data: "DD/MM", hora: "HHh" }
      - renderiza CONFIRMACAO_INVITE_TEMPLATE
   c. Se não achou:
      - renderiza CONFIRMACAO_INVITE_FALLBACK_TEMPLATE (sem data/hora)
   d. sendWithPresence(sock, jid, message)
```

## Templates

**Default** (com data/hora):
```
Oi {{primeiro_nome}}, confirmando nosso bate-papo para {{data}} às {{hora}}hrs. Veja se você recebeu o convite no seu e-mail ou se já aparece direto na sua agenda, por favor?
```

**Fallback** (sem data/hora — evento não localizado):
```
Oi {{primeiro_nome}}, confirmando nosso bate-papo. Veja se você recebeu o convite no seu e-mail ou se já aparece direto na sua agenda, por favor?
```

Placeholders disponíveis: `{{primeiro_nome}}`, `{{data}}` (formato `DD/MM`), `{{hora}}` (formato `HHh` ou `HH:MM`).

## Idempotência

Usa a tabela `webhook_dispatches` com `UNIQUE(person_id, stage_id)`. Se o mesmo lead voltar a ser ganho na mesma stage (raro), não reenvia.

## Enriquecimento do evento (efeito colateral)

Depois de localizar o evento, o bot adiciona `Contato: 55XX9NNNNNNNN` na descrição via `calendar.events.patch()`. Isso resolve um problema histórico: eventos criados automaticamente pelo Piperun não tinham telefone identificável, então o [reminder scheduler](./lembretes-reuniao.md) não conseguia associar ao lead. Com o enrich, todos os lembretes D-1 / dia / T-15min voltam a funcionar pra esses eventos.

## Env vars

| Var | Default | Nota |
|---|---|---|
| `CONFIRMACAO_INVITE_STAGE_ID` | `648386` | Stage que dispara |
| `CONFIRMACAO_INVITE_TRIGGER_TYPE` | `Uma oportunidade for ganha` | Filtro extra por trigger |
| `CONFIRMACAO_INVITE_RETRY_MS` | `3000` | Espera entre tentativas de achar evento |
| `CONFIRMACAO_INVITE_MAX_RETRIES` | `3` | Máximo de tentativas |
| `CONFIRMACAO_INVITE_LOOKAHEAD_DAYS` | `60` | Janela de busca no Calendar (dias) |
| `CONFIRMACAO_INVITE_CREATED_WINDOW_MS` | `300000` | Tolerância entre event.created e closed_at (ms) |
| `CONFIRMACAO_INVITE_TEMPLATE` | (texto default) | Msg com data/hora |
| `CONFIRMACAO_INVITE_FALLBACK_TEMPLATE` | (texto default) | Msg sem data/hora |

## Como testar

### Local (sem chegar no WhatsApp real)

Simula o payload:

```bash
curl -X POST http://localhost:3000/webhook/piperun/confirmacao-invite \
  -H "Content-Type: application/json" \
  -d '{
    "id": 99999999,
    "title": "Test Confirmacao",
    "status": 1,
    "closed_at": "2026-07-21 21:20:07",
    "stage": {"id": 648386, "name": "Agendamento"},
    "person": {
      "id": 12345,
      "name": "Fulano de Tal",
      "contact_phones": [{"number": "55XX9NNNNNNNN", "is_main": 0}]
    },
    "action": {"trigger_type": "Uma oportunidade for ganha"}
  }'
```

Substituir `55XX9NNNNNNNN` por um telefone real com WhatsApp (por ex: o seu próprio pra teste).

### Fluxo completo em prod

1. Criar deal de teste no CRM com pessoa contendo telefone válido no WhatsApp
2. Mover deal pra stage Agendamento (648386) do funil Prospecção
3. Dar "Ganhar e Agendar" — Piperun cria evento no Calendar E dispara webhook
4. Verificar:
   - WhatsApp recebeu msg de confirmação com data/hora correta
   - Descrição do evento no Calendar foi enriquecida com `Contato: 55...`
   - Log `[CONFIRMA-INVITE] enviado person_id=X → JID`

## O que pode dar errado

| Sintoma | Causa |
|---|---|
| `stage_mismatch` no response | Piperun disparou o webhook em stage diferente de 648386 |
| `not_won` no response | Deal não foi ganho (status !== 1) — trigger errado |
| `sem telefone identificável` | Pessoa no CRM sem `contact_phones` — consultor precisa preencher |
| `número X não existe no WhatsApp` | Telefone no CRM é fixo, antigo ou de outro app |
| `evento não encontrado após retries — usando fallback` | Piperun não criou o evento OU criou com título muito diferente de `deal.title`. Msg vai sem data/hora |
| `falha ao enriquecer evento` | Sem permissão de write no Calendar (checar DWD do service account com scope `calendar` não `calendar.readonly`) |
| Msg com data/hora errada | Fuso do event.start.dateTime não é BRT — bot já converte pra America/Sao_Paulo, verificar se o evento tá em outro fuso |
