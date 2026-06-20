# Travus Agent IA

Backend Node.js que conecta o WhatsApp à **Ana** — agente SDR baseado em OpenAI **gpt-4o-mini** — pra qualificação automática de leads da **Travus Capital**. Captura nome, e-mail, telefone, renda, agenda a primeira reunião no Google Calendar, registra o lead no Piperun e move pra etapa de "Conexão". Também dispara mensalmente os boletos do consórcio Canopus pros clientes ativos.

---

## Funcionalidades

- **Conversa qualificadora em PT-BR** seguindo o prompt versionado em `prompts/ana.md`
- **Transcrição automática de áudio** via OpenAI Whisper
- **Buffer de mensagens em rajada** (coalescing por JID) e fila serial por contato
- **Webhook entrante do Piperun** envia material em PDF quando o deal entra numa etapa específica
- **Webhook proativo da Landing Page**: bot inicia a conversa quando o lead se cadastra
- **Agendamento automático** no Google Calendar (com link Meet)
- **Sincronização Piperun**: cria deal, move pra "Abertura" ao iniciar conversa, "Conexão" após agendar
- **Cron mensal de boletos**: dia 10 às 09:00 BRT, busca clientes na etapa do CRM e envia PDFs do Canopus pelo WhatsApp
- **Lembretes automáticos de reunião** (1 dia antes, manhã do dia, 15 min antes)
- **Estado de conversa**: detecção de lead antigo, modo manual, conversa agendada (silencia bot após confirmação)
- **Idempotência**: dedupe por message_id e por (deal_id, bill_id) pra evitar reenvio

---

## Arquitetura

```
                       ┌──────────────────────────────────────────────┐
                       │ VPS Ubuntu (DigitalOcean / s-1vcpu-1gb)      │
                       │                                              │
   WhatsApp ─Baileys─▶ │  src/whatsapp  ─▶  src/handler ─▶ openai     │
                       │      │              │                ▲       │
                       │      │              ├─ recordLead    │       │
                       │      │              ├─ Piperun (POST)│       │
                       │      │              ├─ Calendar      │       │
                       │      │              └─ moveDeal      │       │
                       │      │                               │       │
   Piperun webhook ──▶ │  src/api/* ───────▶ webhook handlers │       │
                       │                                      │       │
                       │  src/scheduler/boletos-cron ──▶ jobs │       │
                       │                          │           │       │
                       │  better-sqlite3 (data/conversations.db)      │
                       └──────────────────────┬───────────────────────┘
                                              │
                                              ▼
                          Render.com (proxy HTTP, free tier)
                                              │
                                              ▼
                          Canopus (find-cota / generate-bill / print)
```

Detalhes do proxy do Canopus: o WAF deles bloqueia o IP da VPS, então as chamadas vão por [scripts/canopus-proxy-server.js](scripts/canopus-proxy-server.js) hospedado em Render (IP AWS, passa no WAF). Mais em **Cron mensal de boletos** abaixo.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 22 (ESM, `"type": "module"`) |
| WhatsApp | [baileys](https://github.com/WhiskeySockets/Baileys) (sem Chromium) |
| LLM | OpenAI SDK — gpt-4o-mini (chat) + Whisper (transcrição) |
| Banco | better-sqlite3 (WAL mode, `data/conversations.db`) |
| API HTTP | Express 5 (webhooks Piperun) |
| Google APIs | googleapis (Calendar + Service Account com DWD) |
| Scheduler | node-cron (TZ `America/Sao_Paulo`) |
| Processo | PM2 (`ecosystem.config.cjs`) |

---

## Estrutura

```
src/
├── agent.js                   # cliente OpenAI + carga do prompt
├── handler.js                 # orquestrador da conversa
├── db.js                      # SQLite (contacts, conversations, messages, leads, ...)
├── index.js                   # bootstrap (API + WhatsApp + cron)
├── api/                       # Express + webhook handlers
├── integrations/
│   ├── calendar.js            # Google Calendar
│   ├── canopus.js             # 3 endpoints do consórcio
│   ├── piperun.js             # integrador (criar lead)
│   ├── meeting-reminders.js   # lembretes de reunião
│   └── whisper.js             # transcrição de áudio
├── jobs/monthly-boletos.js    # rotina mensal
├── scheduler/boletos-cron.js  # cron registration
├── whatsapp/                  # Baileys, buffer, queue, presence, follow-ups
└── utils/

prompts/ana.md                 # system prompt da Ana (versionado)
scripts/                       # setup-vps, reset-session, backup-db, boletos:run, proxy server
tests/                         # node:test suite (unit)
```

---

## Setup local

```bash
git clone git@github.com:joaofelipe93/travus-agent-ia.git
cd travus-agent-ia
npm install
cp .env.example .env
# preencha as vars obrigatórias (ver tabela abaixo)
npm run dev
```

Escaneie o QR code que aparece no terminal:
> WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho

A sessão fica em `.baileys-auth/` (gitignored). Não precisa re-escanear toda vez.

### Variáveis de ambiente

Obrigatórias:

| Variável | Função |
|---|---|
| `OPENAI_API_KEY` | API key da OpenAI (chat + Whisper) |
| `PIPERUN_HASH` | Hash do integrador no Piperun (criar deal via webhook) |
| `PIPERUN_API_TOKEN` | Token de API REST do Piperun (consultas e move de stage) |
| `GOOGLE_SA_KEY_FILE` | Caminho do JSON da service account |
| `GOOGLE_CALENDAR_ID` | E-mail do calendário do consultor |
| `GOOGLE_IMPERSONATE_USER` | E-mail do usuário pra Domain-Wide Delegation |

Opcionais relevantes (defaults sensatos):

| Variável | Default | Função |
|---|---|---|
| `OPENAI_MODEL` | `gpt-4o-mini` | Modelo de chat |
| `API_PORT` | `3000` | Porta do Express |
| `PIPERUN_CONNECTION_STAGE_ID` | `648383` | Stage "Conexão" |
| `PIPERUN_BOLETOS_STAGE_ID` | `679217` | Stage com clientes pro cron de boletos |
| `BOLETOS_CRON` | `0 9 10 * *` | Quando o cron roda (TZ BRT) |
| `BOLETOS_ENABLED` | `true` | Pra desativar o cron |
| `CANOPUS_BASE_URL` | (URL real do Canopus) | Trocar pelo proxy se IP da VPS for barrado |
| `CANOPUS_PROXY_TOKEN` | — | Header `x-proxy-token` enviado ao proxy |
| `SCHEDULED_REPLY_TEMPLATE` | (canned) | Resposta automática quando lead já agendou |

Lista completa: [`.env.example`](.env.example).

---

## Comandos

```bash
npm run dev           # start local (QR code no terminal)
npm test              # node:test suite (sem chamadas externas)
npm run test:agent    # smoke test contra a OpenAI
npm run boletos:run   # dispara a rotina mensal de boletos manualmente
npm run backup:db     # snapshot do SQLite
```

---

## Deploy na VPS

Provisionamento (executar uma vez como root):

```bash
curl -fsSL https://raw.githubusercontent.com/joaofelipe93/travus-agent-ia/main/scripts/setup-vps.sh | sudo bash
```

O script instala Node.js 22, PM2, clona o repo em `/opt/travus-bot` e cria o usuário `travus`. Depois é só preencher `/opt/travus-bot/.env` e rodar:

```bash
sudo -u travus pm2 start /opt/travus-bot/ecosystem.config.cjs
```

### Trocar a sessão WhatsApp

```bash
sudo bash /opt/travus-bot/scripts/reset-session.sh
```

Apaga `.baileys-auth/` e reinicia o PM2 — QR code aparece em `pm2 logs`.

### Deploy incremental

```bash
sudo -u travus git -C /opt/travus-bot pull
sudo -u travus npm ci --prefix /opt/travus-bot --omit=dev
sudo -u travus pm2 restart travus-bot
```

⚠️ Sempre rode `npm ci` (ou `npm install`) depois do pull — esquecer disso é a forma mais comum de quebrar o bot quando uma nova dependência é adicionada.

---

## Cron mensal de boletos

Roda automaticamente todo dia 10 às 09:00 BRT. Lista os deals na etapa `PIPERUN_BOLETOS_STAGE_ID` no Piperun, para cada um: pega CPF + telefone, busca cotas no Canopus, gera boletos, envia PDFs por WhatsApp. Idempotente — boletos já enviados (`UNIQUE(deal_id, bill_id)`) são pulados em reruns.

Dispara manualmente:

```bash
sudo -u travus -E npm run boletos:run --prefix /opt/travus-bot
```

### Proxy do Canopus

A API do Canopus está atrás de WAF (Cloudflare) que barra o IP da VPS. Pra contornar, [scripts/canopus-proxy-server.js](scripts/canopus-proxy-server.js) é um proxy Node mínimo que deve ser hospedado em um provedor com IP que ainda não foi marcado pelo WAF. Render free tier funciona; instruções no header do arquivo.

Setup resumido:
1. Cria Web Service no Render apontando pra este repo, `node scripts/canopus-proxy-server.js`.
2. Adiciona env var `SHARED_TOKEN`.
3. No `.env` da VPS: `CANOPUS_BASE_URL=https://SEU_RENDER.onrender.com/canopus` e `CANOPUS_PROXY_TOKEN=<mesmo SHARED_TOKEN>`.
4. Reinicia PM2.

Se o IP do Render também virar marcado, é só re-hospedar em outro lugar (Fly.io, Railway, etc.) e atualizar a env var — nenhum código muda.

---

## Operações comuns

```bash
# Logs ao vivo
sudo -u travus pm2 logs travus-bot

# Últimos N erros
sudo -u travus pm2 logs travus-bot --err --lines 100 --nostream

# Restart
sudo -u travus pm2 restart travus-bot

# Inspecionar o banco
cd /opt/travus-bot && sudo -u travus sqlite3 data/conversations.db
```

---

## Testes

```bash
npm test
```

Cobertura atual é só de unidades em `db.js`. Handler e integrações ainda não têm testes de fluxo — abrir issue se quiser ajudar.

---

## Troubleshooting

| Sintoma | Possível causa |
|---|---|
| `ERR_MODULE_NOT_FOUND` no boot | Esqueceu `npm install` após pull com nova dependência |
| Bot conecta mas não responde | `bot_enabled = 0` em `conversations` (modo manual) ou `scheduled_at` setado |
| `[BOLETOS] ... sem telefone` | Lead sem `contactPhones` no Piperun, ou versão antiga da VPS sem `?with=contactPhones` |
| `[BOLETOS] ... HTTP 403` | WAF Canopus barrando — configurar `CANOPUS_BASE_URL` apontando pro proxy |
| `FOREIGN KEY constraint failed` | JID `@lid` vs `@s.whatsapp.net` divergindo — versão antiga sem normalização |
| `[REMINDER] ... não corresponde a nenhum lead` | Evento criado manualmente no Calendar (sem passar pelo bot) |

---

## O que NÃO está aqui (e por quê)

- **DigitalOcean Gradient / Claude API**: a Ana já rodou no Gradient (DeepSeek/Claude). Migrou pra OpenAI gpt-4o-mini direto pra reduzir latência e simplificar. SDK Anthropic não é usado.
- **MCP / Google Drive**: planejado, ainda não scaffolded.
- **Múltiplas sessões WhatsApp**: 1 bot, 1 número. Pra multi-tenant teria que isolar o `.baileys-auth/` e o DB por instância.
