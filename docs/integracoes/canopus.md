# Consórcio Canopus

API pública sem autenticação usada pra emitir boletos mensais do consórcio dos clientes ativos.

## 3 endpoints usados

Base URL (default): `https://www.consorciocanopus.com.br/extensions/boleto-facil-rolledback/public/index.php`

| Endpoint | Uso |
|---|---|
| `GET /find-cota/{cpf}` | Lista cotas do CPF |
| `GET /generate-bill/{grupo}/{cota}/{idCota}` | Lista bills da cota |
| `GET /print-overdue-bill/{grupo}/{cota}/{billId}/{txId}` | PDF do boleto |

Zero auth. Só CPF já basta pra achar as cotas.

## Formato das respostas

### `find-cota`

```json
{
  "cotas": [
    {"ID_Cota": 468379, "CD_Grupo": "006650", "CD_Cota": 3419, "Versao": 0},
    ...
  ]
}
```

### `generate-bill`

```json
{
  "bills": [
    {
      "id": 25651,
      "parcelNumber": "014",          // ← parcela real
      "date": "2026-07-14",
      "price": 644.62,
      "type": "overdue",
      "group": "006650",
      "cota": "3419",
      "transactionId": 169509431
    },
    {
      "id": 25650,
      "parcelNumber": "DIF",          // ← correção; sempre R$ 0; filtramos
      "price": 0,
      ...
    }
  ]
}
```

### `print-overdue-bill`

Retorna PDF cru (Content-Type: application/pdf). Nosso wrapper valida magic bytes `%PDF` porque em caso de erro Canopus devolve HTML.

## WAF Cloudflare (importante)

Canopus tá atrás de Cloudflare, e o **IP da VPS DigitalOcean é barrado** (retorna HTTP 403 com HTML de challenge). Solução: proxy.

## Proxy no Render

Rodamos `scripts/canopus-proxy-server.js` num Web Service do Render (free tier). O bot chama o proxy em vez do Canopus direto:

```
Bot (VPS) → travus-agent-ia.onrender.com/canopus/{path}
Render Proxy → cdpj.canopus/{path}
```

O proxy passa headers de browser real (user-agent Chrome/Windows) e devolve a resposta. Valida `x-proxy-token` compartilhado.

### Setup do proxy

1. Web Service no Render: `node scripts/canopus-proxy-server.js`
2. Env var `SHARED_TOKEN` = mesmo valor do `CANOPUS_PROXY_TOKEN` no `.env` da VPS
3. `.env` da VPS aponta `CANOPUS_BASE_URL=https://travus-agent-ia.onrender.com/canopus` e `CANOPUS_PROXY_TOKEN=...`

### Se o IP do Render também for barrado

Migra pra Fly.io, Railway, etc. Só muda `CANOPUS_BASE_URL` no `.env` — código não precisa.

## Retry

- Requests com status **403, 429, 503, 5xx** retentam com backoff exponencial: 2s, 4s, 8s.
- Max 3 tentativas por padrão (`CANOPUS_MAX_RETRIES`).
- Cover o cold start do Render (~30s) e rate limits ocasionais do Canopus.

## Pegadinhas

- **PDF pode retornar HTML** se Cloudflare rejeitar — sempre validar magic bytes.
- **`type: "overdue"` está em todas as bills**, incluindo as futuras. Não é indicador confiável de "vencido".
- **`parcelNumber: "DIF"`** deve ser sempre pulado — não é boleto pagável.
- **Free tier do Render dorme após 15min sem requests** → cold start ~30s no primeiro request do mês. Aceitável.

## Env vars

| Var | Default | Uso |
|---|---|---|
| `CANOPUS_BASE_URL` | canopus direto | Aponta pro proxy Render |
| `CANOPUS_PROXY_TOKEN` | — | Header `x-proxy-token` |
| `CANOPUS_USER_AGENT` | Chrome/Linux | UA nas requests diretas (sem proxy) |
| `CANOPUS_MAX_RETRIES` | `3` | Retry em 429/5xx |
| `CANOPUS_RETRY_BASE_MS` | `2000` | Base do backoff exponencial |
