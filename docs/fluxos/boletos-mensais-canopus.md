# Boletos mensais do consórcio (Canopus)

Cron mensal que busca no Piperun os clientes de consórcio ativos, consulta a Canopus pra pegar os boletos do mês, e envia pelo WhatsApp.

## Gatilho

Cron `0 9 8 * *` — **dia 8 de cada mês às 09:00 BRT**.

## Pré-requisitos no CRM (cliente por cliente)

Pra que o boleto do consórcio saia pro cliente todo dia 8, o deal dele precisa estar em ordem no Piperun **antes** do cron rodar. Se faltar qualquer coisa, ele é pulado silenciosamente (só aparece no summary do log).

### 1. Estar na stage correta

Deal do cliente ativo do consórcio deve estar na stage **`679217` — "Consórcio ativo"** (configurável via `PIPERUN_BOLETOS_STAGE_ID`). Deals em qualquer outra stage são ignorados pelo cron.

**Quando mover pra essa stage:** logo depois do cliente assinar o contrato de consórcio e o cadastro no Canopus estar concluído (não adianta mover antes — o `find-cota/{cpf}` vai retornar vazio).

**Filtro adicional (desde PR #107):** o bot pede `deleted=0&freezed=0` na query. Deals soft-deleted ou congelados no CRM **não** aparecem no cron, mesmo estando nominalmente na stage.

### 2. Campos da pessoa preenchidos

Bot lê a **pessoa** do deal (não o deal). Campos necessários:

| Campo Piperun | Uso | Se faltar → summary mostra |
|---|---|---|
| CPF | Chamada `find-cota/{cpf}` no Canopus | `sem_cpf: N` |
| Telefone (contato principal) | Envio pelo WhatsApp | `sem_telefone: N` |

#### Formato do CPF

Bot normaliza (`String(cpf).replace(/\D/g, "")`) — aceita qualquer formato:

✅ `123.456.789-09` → 11 dígitos
✅ `12345678909` → 11 dígitos
✅ `123 456 789 09` → 11 dígitos (bot tira espaços)

❌ CPF com dígito faltando ou parcial (só 10 dígitos) → `throw new Error("CPF inválido (esperado 11 dígitos)")` no log

⚠️ **CPF precisa estar cadastrado no Canopus.** Não basta ter no Piperun. Se o cliente ainda não foi cadastrado no consórcio, o `find-cota` retorna vazio → summary mostra `sem_cotas: N`.

#### Formato do telefone

Piperun aceita máscara `(84) 99164-6369` — Baileys normaliza. Depois o bot faz `sock.onWhatsApp(phone)` — se **o número não existe no WhatsApp**, summary mostra `fora_do_whatsapp: N` e cliente é pulado.

**Erros comuns de telefone:**
- Cliente deu o fixo em vez do celular
- Número antigo/desativado
- Faltando o 9 do celular (Piperun aceita, mas WhatsApp não valida)

### 3. Cliente precisa ter parcela pagável no mês

Mesmo que tudo esteja OK no CRM e no Canopus, se o cliente **não tem parcela vencendo** nesse ciclo, o bot registra `sem_bills` e não envia mensagem nenhuma. Isso é **comportamento correto**, não bug.

Dois cenários que geram `sem_bills` legítimo:

**Cenário A — cliente só tem bill de correção monetária (DIF):**
- Canopus retorna 1 cota
- `generateBills` devolve 1 bill com `parcelNumber = "DIF"` (correção monetária, R$ 0)
- Bot filtra DIF automaticamente → nada pra enviar → `sem_bills`
- **Ação:** nenhuma. Quando ele tiver parcela real, o bot envia.

**Cenário B — cliente em dia, múltiplas cotas sem parcela ativa:**
- Canopus retorna várias cotas
- Nenhuma delas com parcela cobrável nesse ciclo (cliente pagou antecipado, ou o grupo não emitiu ainda)
- Confirmável direto no site da Canopus: colunas Parcela/Vencimento/Valor vazias
- **Ação:** nenhuma.

### O que o consultor deve fazer

| Quando | Ação no CRM |
|---|---|
| Onboarding de cliente novo do consórcio | Mover deal pra stage `679217` **depois** que o cadastro no Canopus estiver concluído. Confirmar CPF + telefone preenchidos na pessoa |
| Cliente trocou de telefone | Atualizar em "Contatos → Telefone principal" antes do dia 8 do mês |
| Cliente saiu do consórcio | Mover pra outra stage (ex: "Encerrado") ou marcar `deleted` no CRM. O cron para de tentar |
| Cliente com `sem_cotas` no summary | Confirmar CPF no Piperun bate com CPF cadastrado no Canopus. Se bate e ainda dá sem_cotas, cliente não tá cadastrado no consórcio |
| Cliente com `sem_bills` recorrente | Investigar direto no site da Canopus (`consorciocanopus.com.br`) — se ele realmente não tem parcela pagável, tá tudo certo |

### Checklist antes do dia 8

- [ ] Todos os clientes ativos estão em `679217`
- [ ] Nenhum cliente encerrado ficou nessa stage
- [ ] CPF preenchido em todas as pessoas
- [ ] Telefone principal preenchido e válido (celular com 9, em uso, no WhatsApp)
- [ ] Nenhum deal marcado como `deleted` ou `freezed` que deveria estar ativo

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
| `BOLETOS_CRON` | `0 9 8 * *` | Expressão node-cron |
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
| Cron não disparou dia 8 | Bot estava off — só roda quando PM2 tá up. Sem catch-up automático |
| Summary com `sem_telefone: N` alto | Muitos leads no CRM sem telefone preenchido |
