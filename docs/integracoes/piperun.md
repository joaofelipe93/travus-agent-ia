# Piperun CRM

Dois canais: **webhooks** (Piperun → bot) e **REST API** (bot → Piperun).

## Webhooks (Piperun → bot)

3 endpoints Express:

| Path | Gatilho no CRM | Fluxo |
|---|---|---|
| `POST /webhook/piperun` | Deal entra em stage do material | [material-pdf](../fluxos/material-pdf.md) |
| `POST /webhook/piperun/novo-cliente` | Deal entra em "Novos" com origin "LP V2" | [novo-cliente-lp](../fluxos/novo-cliente-lp.md) |
| `POST /webhook/piperun/emissao-contrato` | Deal entra em "Emissão de Contrato" (stage 654265) | [emissao-contrato](../fluxos/emissao-contrato.md) |

### Formato do payload

Piperun envia POST com JSON tipo:

```json
{
  "id": 60996889,             // deal_id
  "title": "Lead LP Travus - X",
  "value": "300.00",
  "observation": "...",       // deal-level (geralmente log automático)
  "stage": { "id": 654265, "name": "..." },
  "pipeline": { "id": 101707, "name": "..." },
  "origin": { "id": 797972, "name": "LP V2" },
  "person": {
    "id": <person_id>,
    "name": "<Nome do Lead>",
    "cpf": "NNN.NNN.NNN-NN",
    "gender": "Masculino",
    "birth_day": "AAAA-MM-DD",
    "observation": "Valor da consultoria: R$ 300 x12",   // PESSOA (usada pelo bot)
    "address": { "street": "...", "postal_code": "...", "number": "...", "district": "..." },
    "city": { "id": <city_id>, "uf": "<UF>", "name": "<Cidade>" },
    "contact_emails": [{ "address": "..." }],
    "contact_phones": [{ "number": "55XX9NNNNNNNN", "is_main": 1 }]
  }
}
```

**Pegadinha**: `payload.observation` (deal-level) geralmente é log automático — o valor real do contrato vai em `payload.person.observation`. O parser tenta os dois em ordem.

## REST API (bot → Piperun)

Wrapper: `src/api/piperun-api.js`.

- **Auth**: header `token: <PIPERUN_API_TOKEN>`
- **Base URL**: `https://api.pipe.run/v1`

### Endpoints usados

| Endpoint | Uso |
|---|---|
| `GET /deals?stage_id=X&with=person&page=N&show=100` | Lista deals paginado — usado no cron Canopus |
| `GET /persons/{id}?with=contactPhones,contactEmails` | Pega dados completos do pagador |
| `PUT /deals/{id}` body `{stage_id: N}` | Move deal entre stages |
| `GET /persons?email=X` + `GET /deals?person_id=X` | Fallback pra descobrir deal_id via email |

### Pegadinhas

- `?with=` usa camelCase: `contactPhones`, `contactEmails`. Snake case (`contact_phones`) **não funciona**.
- Chaves na resposta também vêm em camelCase: `person.contactPhones[0].phone` (não `.number`).
- `person` no payload do webhook usa snake_case (`contact_phones[0].number`), então tem 2 formatos e os helpers normalizam.

## Env vars

| Var | Uso |
|---|---|
| `PIPERUN_HASH` | Hash do integrador (webhook outbound de emissão de lead) |
| `PIPERUN_API_TOKEN` | Bearer da REST API |

## Stages usadas

| ID | Nome | Uso |
|---|---|---|
| `648367` | Novos (pipeline captação) | Webhook LP dispara |
| `648382` | Abertura | Bot move após saudação LP |
| `648383` | Conexão | Bot move após agendamento OK |
| `654265` | Emissão de Contrato | Dispara emissão de boletos + contrato |
| `679217` | (Consórcio ativo) | Cron mensal de boletos Canopus varre esta |

Configuráveis via env: `PIPERUN_CONNECTION_STAGE_ID`, `PIPERUN_BOLETOS_STAGE_ID`, `INTER_CONTRATO_STAGE_ID`.
