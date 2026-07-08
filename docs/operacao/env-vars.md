# Variáveis de ambiente

Referência completa. Fonte da verdade: [`.env.example`](../../.env.example).

## Obrigatórias

| Var | Uso | Fluxo |
|---|---|---|
| `OPENAI_API_KEY` | Chat + Whisper | [captacao-lead](../fluxos/captacao-lead.md) |
| `PIPERUN_HASH` | Webhook integrador Piperun | [captacao-lead](../fluxos/captacao-lead.md) |
| `PIPERUN_API_TOKEN` | REST API Piperun | Vários |
| `GOOGLE_SA_KEY_FILE` | Service Account JSON | [lembretes-reuniao](../fluxos/lembretes-reuniao.md) |
| `GOOGLE_CALENDAR_ID` | E-mail do consultor | Idem |
| `GOOGLE_IMPERSONATE_USER` | DWD | Idem |
| `INTER_CLIENT_ID` | OAuth Inter | [emissao-contrato](../fluxos/emissao-contrato.md) |
| `INTER_CLIENT_SECRET` | Idem | |
| `INTER_CERT_FILE` | Cert mTLS Inter | |
| `INTER_KEY_FILE` | Key mTLS Inter | |
| `INTER_BASE_URL` | Sandbox ou prod (default: sandbox) | |

## Opcionais críticas

| Var | Default | Uso |
|---|---|---|
| `OPENAI_MODEL` | `gpt-4o-mini` | Trocar dá risco de custo |
| `API_PORT` | `3000` | Porta Express |
| `INTER_CONTA_CORRENTE` | — | Se app Inter tem múltiplas contas |
| `CONVERTAPI_TOKEN` | — | Necessário se `CONTRATO_FORMAT=pdf` |
| `CONTRATO_FORMAT` | `docx` | `pdf` ativa ConvertAPI |
| `CONSULTOR_WHATSAPP` | — | Recebe alertas (número Luiz) |

## Stages Piperun (podem mudar sem deploy)

| Var | Default | Nome no CRM |
|---|---|---|
| `PIPERUN_CONNECTION_STAGE_ID` | `648383` | Conexão |
| `PIPERUN_BOLETOS_STAGE_ID` | `679217` | Consórcio ativo |
| `PIPERUN_NEW_CLIENT_DESTINATION_STAGE_ID` | `648382` | Abertura |
| `INTER_CONTRATO_STAGE_ID` | `654265` | Emissão de Contrato |
| `NOVO_CLIENTE_REQUIRED_ORIGIN` | `LP V2` | Filtro de origin no webhook LP |

## Crons

| Var | Default | O que dispara |
|---|---|---|
| `BOLETOS_CRON` | `0 9 10 * *` | Cron mensal Canopus |
| `BOLETOS_ENABLED` | `true` | Desativa cron Canopus |
| `CONTRATO_REMINDER_CRON` | `0 9 * * *` | Cron diário parcelas contrato |
| `CONTRATO_REMINDER_ENABLED` | `true` | Desativa cron parcelas |
| `CONTRATO_REMINDER_WINDOW_DIAS` | `10` | Antecipação em dias |
| `ATRASO_CRON` | `0 9 * * *` | Cron diário atrasos |
| `ATRASO_ENABLED` | `true` | Desativa cron atrasos |
| `ATRASO_DIAS_NIVEL_1/2/3` | `1/5/15` | Thresholds D+ |

## Templates de mensagem

Todos aceitam placeholders `{{primeiro_nome}}`, alguns aceitam mais. Ver docs específicas de cada fluxo.

| Var | Fluxo |
|---|---|
| `CONTRATO_MESSAGE_TEMPLATE` | Emissão contrato normal |
| `CONTRATO_MESSAGE_TEMPLATE_CORTESIA` | Cortesia |
| `CONTRATO_REMINDER_TEMPLATE` | Lembrete de parcela |
| `ATRASO_TEMPLATE_D1/D5/D15` | Cobrança escalonada |
| `ATRASO_TEMPLATE_CONSULTOR` | Alerta pro consultor no D+15 |
| `BOLETOS_MESSAGE_TEMPLATE` | Mensagem do cron Canopus |
| `SCHEDULED_REPLY_TEMPLATE` | Canned pra lead que já agendou |

## Canopus / proxy

| Var | Default | Uso |
|---|---|---|
| `CANOPUS_BASE_URL` | (canopus direto) | Aponta pro proxy Render |
| `CANOPUS_PROXY_TOKEN` | — | Header `x-proxy-token` |
| `CANOPUS_USER_AGENT` | (Chrome) | UA das requests |
| `CANOPUS_MAX_RETRIES` | `3` | Retry em 429/5xx |
| `CANOPUS_RETRY_BASE_MS` | `2000` | Base backoff exp |

## Buffer + pacing

| Var | Default | Uso |
|---|---|---|
| `COALESCE_DELAY_MS` | `4000` | Espera entre msgs |
| `COALESCE_MAX_MS` | `30000` | Timeout do buffer |
| `COALESCE_MAX_COUNT` | `10` | Limite de msgs no buffer |
| `INTER_COBRANCA_DELAY_MS` | `500` | Pacing entre POSTs Inter |
| `INTER_PDF_DELAY_MS` | `1500` | Pacing entre PDFs WhatsApp |
| `BOLETOS_PACING_MS` | `3000` | Pacing entre clientes (Canopus) |
| `BOLETOS_BILL_PACING_MS` | `1500` | Pacing entre bills do mesmo cliente |
| `CONTRATO_REMINDER_PACING_MS` | `1500` | Pacing entre envios (parcelas) |
| `ATRASO_PACING_MS` | `1500` | Pacing entre envios (atrasos) |
| `ATRASO_INTER_CHECK_PACING_MS` | `300` | Pacing entre consultas Inter |

## Assets

| Var | Default |
|---|---|
| `WEBHOOK_PDF_PATH` | `src/assets/material.pdf` |
| `WEBHOOK_PDF_FILENAME` | `Travus Capital.pdf` |
| `CONTRATO_TEMPLATE_PATH` | `src/assets/contrato-template.docx` |

## Boas práticas

- Use `.env.example` como referência — nunca commite `.env` (gitignored).
- Secrets (`INTER_CERT_FILE`, `INTER_KEY_FILE`, `GOOGLE_SA_KEY_FILE`) apontam pra arquivos, não pro conteúdo direto.
- Rotate tokens periodicamente: Inter (via Internet Banking), OpenAI, Piperun, ConvertAPI.
