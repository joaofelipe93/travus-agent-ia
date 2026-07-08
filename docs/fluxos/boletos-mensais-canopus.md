# Boletos mensais do consórcio (Canopus)

Cron mensal que busca no Piperun os clientes de consórcio ativos, consulta a Canopus pra pegar os boletos do mês, e envia pelo WhatsApp.

## Gatilho

Cron `0 9 10 * *` — **dia 10 de cada mês às 09:00 BRT**.

## Componentes

- `src/scheduler/boletos-cron.js` — registra o cron
- `src/jobs/monthly-boletos.js` — orquestrador
- `src/api/piperun-api.js` — lista deals na stage
- `src/integrations/canopus.js` — 3 endpoints do consórcio
- `scripts/canopus-proxy-server.js` — proxy no Render (WAF bypass)
- `src/db.js` — `boleto_clients` + `boletos_sent`

## Sequência

```
1. Cron → runMonthlyBoletos(sock)
2. GET /v1/deals?stage_id=679217&with=person na Piperun → lista deals
3. Pra cada deal:
   a. GET /v1/persons/{id}?with=contactPhones → CPF + telefone
   b. Se sem CPF → skip (sem_cpf)
   c. Se sem telefone → skip (sem_telefone)
   d. sock.onWhatsApp → resolve JID (skip fora_do_whatsapp)
   e. upsertBoletoClient (cache)
   f. GET canopus/find-cota/{cpf} → array de cotas
   g. Pra cada cota:
      - GET canopus/generate-bill/{grupo}/{cota}/{idCota} → array de bills
      - Filtra: bill.parcelNumber === "DIF" → skip
      - Filtra: hasBoletoBeenSent(deal_id, bill_id) → skip
      - GET canopus/print-overdue-bill/... → PDF (validado %PDF magic)
      - Colecta em pendingBills
   h. Se pendingBills vazio: skip cliente
   i. Envia 1 mensagem com plural correto ("Anexo o boleto" ou "Anexo os boletos")
   j. Envia N PDFs em sequência (1.5s entre cada)
   k. recordBoletosSent
   l. Pacing 3s antes do próximo cliente
4. Log final com summary
```

## Sobre o proxy Canopus (Render)

Canopus tem Cloudflare WAF que barra o IP da VPS. Solução: proxy em `travus-agent-ia.onrender.com` (free tier, IP AWS).

- Proxy roda `scripts/canopus-proxy-server.js`
- Envia header `x-proxy-token` compartilhado
- Passa por browser-like headers (user-agent Chrome Windows)

Se o Render também for barrado no futuro: trocar host (Fly.io, Railway) — só muda `CANOPUS_BASE_URL` no `.env`.

## Idempotência

- `boletos_sent` com `UNIQUE(deal_id, bill_id)` bloqueia reenvio da mesma bill.
- Mesmo se rodar `boletos:run` manualmente 3x seguidas, cada bill sai 1x só.
- Pra reprocessar de propósito: `DELETE FROM boletos_sent WHERE deal_id = X`.

## Filtro DIF

Cada cota gera 2 bills: uma pagável (parcelNumber "014", "015", etc) e uma DIF (correção monetária, sempre R$ 0). Bot **pula as DIF** — cliente não paga esses.

## Env vars

| Var | Default | Nota |
|---|---|---|
| `BOLETOS_ENABLED` | `true` | `false` desativa |
| `BOLETOS_CRON` | `0 9 10 * *` | Expressão node-cron |
| `PIPERUN_BOLETOS_STAGE_ID` | `679217` | Stage dos clientes ativos |
| `BOLETOS_PACING_MS` | `3000` | Pacing entre clientes |
| `BOLETOS_BILL_PACING_MS` | `1500` | Pacing entre bills do mesmo cliente |
| `CANOPUS_MAX_RETRIES` | `3` | Retry em 429/5xx |
| `CANOPUS_RETRY_BASE_MS` | `2000` | Backoff exponencial |
| `CANOPUS_USER_AGENT` | (Chrome/Linux) | UA da request |
| `CANOPUS_BASE_URL` | (canopus direto) | Aponta pro proxy Render |
| `CANOPUS_PROXY_TOKEN` | — | Header `x-proxy-token` |
| `BOLETOS_MESSAGE_TEMPLATE` | (default) | Personaliza texto |

## Como testar manualmente

```bash
sudo -u travus pm2 stop travus-bot
sudo -u travus -E npm run boletos:run --prefix /opt/travus-bot
sudo -u travus pm2 start travus-bot
```

Roda o fluxo completo sem esperar o cron.

## O que pode dar errado

| Sintoma | Causa |
|---|---|
| HTTP 403 do Canopus | Proxy Render dormiu (cold start) ou IP foi barrado — retry resolve o cold start |
| PDF retornado com magic ≠ `%PDF` | Cloudflare devolveu HTML de erro; retry resolve |
| Cliente sem CPF | Preencher no CRM ou aceitar que ele não recebe automaticamente |
| Cron não disparou dia 10 | Bot estava off — só roda quando PM2 tá up. Sem catch-up automático |
| Summary com `sem_telefone: N` alto | Muitos leads no CRM sem telefone preenchido |
