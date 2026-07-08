# Arquitetura

## Componentes principais

```
                                              ┌──────────────┐
                                              │  Piperun CRM │
                                              │  (webhooks)  │
                                              └──────┬───────┘
                                                     │
        ┌────────────────────────────────────────────▼──────────────────────────┐
        │  VPS DigitalOcean — /opt/travus-bot (PM2)                            │
        │                                                                       │
        │  ┌─────────────────┐    ┌────────────────┐     ┌────────────────┐    │
        │  │ Express (API)   │    │ Baileys        │     │ node-cron      │    │
        │  │ /webhook/piperun│    │ WhatsApp Web   │     │ 3 jobs diários │    │
        │  │ /health         │    │ QR code sess.  │     │ + 1 mensal     │    │
        │  └────────┬────────┘    └────────┬───────┘     └────────┬───────┘    │
        │           │                       │                       │           │
        │           └───────────┬───────────┴───────────┬───────────┘           │
        │                       ▼                       ▼                        │
        │             ┌──────────────────┐   ┌──────────────────┐              │
        │             │  handler.js      │   │  jobs/*.js       │              │
        │             │  (conversa Ana)  │   │  (atrasos, boletos, lembretes) │
        │             └────────┬─────────┘   └────────┬─────────┘              │
        │                      │                       │                        │
        │             ┌────────▼───────────────────────▼────────┐              │
        │             │  SQLite (data/conversations.db)         │              │
        │             │  contacts, conversations, messages,     │              │
        │             │  leads, boletos_contrato_parcelas,      │              │
        │             │  boletos_sent, ... (ver db-schema.md)   │              │
        │             └─────────────────────────────────────────┘              │
        └──────────────┬──────┬──────┬──────┬──────┬──────┬───────────────────┘
                       │      │      │      │      │      │
              ┌────────▼┐   ┌─▼────┐ ┌─▼──┐ ┌─▼──┐ ┌─▼──┐ ┌▼──────┐
              │ Piperun │   │ Inter│ │ CV │ │ GC │ │ GAI│ │Canopus│
              │  REST   │   │ API  │ │API │ │ API│ │API │ │ (via  │
              │         │   │(mTLS)│ │    │ │    │ │    │ │Render │
              │         │   │      │ │    │ │    │ │    │ │proxy) │
              └─────────┘   └──────┘ └────┘ └────┘ └────┘ └───────┘

Legenda:
- CV     = ConvertAPI (docx → PDF do contrato)
- GC     = Google Calendar (Service Account + DWD)
- GAI    = OpenAI (gpt-4o-mini pra chat + Whisper pra áudio)
- Canopus = consórcio; proxy no Render pra contornar WAF
```

## Componentes do bot

| Camada | Arquivos | Responsabilidade |
|---|---|---|
| API HTTP | `src/api/index.js`, `src/api/webhook-*.js` | Recebe webhooks do Piperun, roteia pros handlers |
| Handler de conversa | `src/handler.js`, `src/agent.js` | Orquestra: history → OpenAI → resposta → captura de lead → side effects |
| WhatsApp | `src/whatsapp/index.js`, `queue.js`, `buffer.js`, `presence.js` | Recebe mensagens do Baileys, resolve LID→PN, buffer, fila serial por JID |
| Persistência | `src/db.js` | SQLite (WAL mode). Contatos, conversas, mensagens, leads, boletos, dispatches |
| Jobs | `src/jobs/*.js` | Lógica dos crons (boletos Canopus, lembretes de parcela, atrasos) |
| Schedulers | `src/scheduler/*.js` | `node-cron` registrando os jobs |
| Integrações | `src/integrations/*.js` | Wrappers das APIs (Inter, Piperun, Canopus, Calendar, Whisper, ConvertAPI) |

## Gatilhos e efeitos (visão macro)

| Gatilho | Efeito principal | Fluxo |
|---|---|---|
| Cliente manda msg WhatsApp | Ana responde, qualifica, agenda call | [captacao-lead](./fluxos/captacao-lead.md) |
| Cliente manda áudio | Transcreve (Whisper) e trata como texto | [captacao-lead](./fluxos/captacao-lead.md) |
| Piperun move deal pra "Material" | Bot envia PDF do material | [material-pdf](./fluxos/material-pdf.md) |
| Piperun move deal pra "Novos" (LP) | Bot manda saudação proativa | [novo-cliente-lp](./fluxos/novo-cliente-lp.md) |
| Piperun move deal pra "Emissão de Contrato" | Bot emite N boletos + envia contrato + 1º boleto | [emissao-contrato](./fluxos/emissao-contrato.md) |
| Dia 10 do mês, 09:00 BRT | Envia boletos do consórcio Canopus | [boletos-mensais-canopus](./fluxos/boletos-mensais-canopus.md) |
| Todo dia 09:00 BRT | Envia parcelas do contrato próximas do vencimento | [lembretes-parcelas](./fluxos/lembretes-parcelas.md) |
| Todo dia 09:00 BRT | Consulta Inter, detecta pagamento, cobra atrasos | [baixa-pagamento](./fluxos/baixa-pagamento.md) |
| A cada 60s | Follow-up da Ana em conversas paradas | [follow-ups](./fluxos/follow-ups.md) |
| A cada 2min | Lembretes de reunião (D-1, dia, T-15min) | [lembretes-reuniao](./fluxos/lembretes-reuniao.md) |

## Regras transversais

- **Idempotência**: quase tudo tem gate via UNIQUE constraint no SQLite (dedupe de mensagens, webhooks, boletos enviados, atrasos por nível).
- **Fila serial por JID** (`src/whatsapp/queue.js`): mensagens do mesmo contato não são processadas em paralelo — evita race condition.
- **Buffer de rajada** (`src/whatsapp/buffer.js`): mensagens em ~4s vindas do mesmo contato são coalesciadas antes de ir pra Ana.
- **Todos os crons** usam TZ `America/Sao_Paulo`.
- **Todos os webhooks** validam a stage do Piperun antes de agir — cada endpoint espera uma stage específica.
