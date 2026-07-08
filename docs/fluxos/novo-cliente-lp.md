# Boas-vindas ao lead da Landing Page

Quando um lead se cadastra no formulário da LP e vira deal no Piperun na stage "Novos", o bot puxa iniciativa: manda a primeira mensagem apresentando a Ana.

## Gatilho

Webhook `POST /webhook/piperun/novo-cliente` — Piperun dispara quando deal entra na stage "Novos".

## Filtro

Só processa se `payload.origin.name === "LP V2"`. Outras origens retornam 200 `ignored_origin`.

## Componentes

- `src/api/webhook-novo-cliente.js` — handler
- `src/api/piperun-api.js` — chama Piperun REST pra pegar person + move deal
- `src/db.js` — `webhook_dispatches`, `conversations.piperun_deal_id`

## Sequência

```
1. POST /webhook/piperun/novo-cliente
2. Valida payload (id, person.id, stage.id) + filtra origin
3. Idempotência: hasWebhookDispatched(person_id, stage_id)
4. GET /v1/persons/{id}?with=contactPhones,contactEmails na Piperun
5. Extrai nome + telefone
6. sock.onWhatsApp(phone) → JID canônico
7. ensureContact + recordWebhookDispatch
8. Enfileira: sendWithPresence(mensagem proativa) + salva em conversations
9. setConversationDealId (deal_id do payload → guardado pra fluxo Conexão depois)
10. moveDealToStage(dealId, 648382 "Abertura") — sinaliza que o bot pegou
```

## Mensagem proativa

Template default:
```
Olá, [Nome]! [Bom dia/tarde/noite]. Aqui é a Ana, da Travus Capital.

Vi que você se cadastrou na nossa página, fico feliz com o interesse! 😊

Posso te fazer algumas perguntas rápidas pra entender se a nossa consultoria faz sentido pra você?
```

Quando o lead responde ("Sim"), a próxima mensagem chega no [fluxo de captação](./captacao-lead.md) — o handler injeta um marcador `[Contexto: Lead veio do formulário da LP...]` que faz a Ana pular a saudação e a pergunta de nome.

## Env vars

| Var | Default | Nota |
|---|---|---|
| `PIPERUN_NEW_CLIENT_DESTINATION_STAGE_ID` | `648382` | Stage "Abertura" — pra onde o deal vai após saudação |
| `NOVO_CLIENTE_REQUIRED_ORIGIN` | `LP V2` | Filtro por `origin.name` |

## Como testar

1. Cria lead pelo formulário da LP.
2. Deal aparece no Piperun na stage "Novos" com origin "LP V2".
3. Bot manda mensagem proativa em segundos.
4. Deal move pra "Abertura".
5. Lead responde → cai no fluxo de captação, Ana continua qualificação.

## O que pode dar errado

| Sintoma | Causa |
|---|---|
| `ignored_origin` no log | Origin não é "LP V2" — provavelmente lead veio direto, não da LP |
| `FOREIGN KEY constraint failed` | Bug de LID/PN divergente — resolvido, mas se voltar checar `phoneFromJid(jid)` |
| Bot manda proativa mas Ana repete saudação depois | Marcador de contexto não foi injetado — checar `history.length === 1` no handler |
| Deal não move pra "Abertura" | Envio pelo WhatsApp OK mas persistência falhou — checar log `[NOVO_CLIENTE] gravado em conv_id` |
