# Troubleshooting

Erros comuns em produção e onde investigar.

## Bot subiu mas não responde no WhatsApp

**Sintomas**: msg chega, log não mostra `[DIRETO]` nem `[AGENTE]`.

Causas possíveis:

| Causa | Debug |
|---|---|
| Conversa em modo manual | `SELECT bot_enabled FROM conversations WHERE phone = '...';` |
| Bot desconectado | `pm2 logs travus-bot --lines 100` — procurar `[OK] Conectado` |
| Sessão deslogada | Log tem `loggedOut` — precisa `reset-session.sh` + escanear QR |
| JID veio como `@lid` sem mapping | Log tem `[LID] sem mapping reverso pra <jid>` |
| Gate "lead antigo" silenciou | Primeira msg sem "formulário" no texto → `disableBot`. Reativar: `UPDATE conversations SET bot_enabled = 1 WHERE ...` |

## `ERR_MODULE_NOT_FOUND` no boot

Alguém fez `git pull` mas esqueceu `npm ci`. Roda:

```bash
sudo -u travus npm ci --prefix /opt/travus-bot --omit=dev
sudo -u travus pm2 restart travus-bot
```

## PM2 log tem `Stream Errored (conflict)`

2 sessões WhatsApp com mesmo device auth. Aconteceu quando alguém rodou `npm run boletos:run` sem parar o `pm2 travus-bot`.

Fix:

```bash
sudo -u travus pm2 stop travus-bot
# Aguarda 5s
sudo -u travus pm2 start travus-bot
```

Se ainda travar: `sudo bash /opt/travus-bot/scripts/reset-session.sh` (perde sessão, precisa QR de novo).

## Cron não disparou

**Sintomas**: 09:00 passou e log não tem `[XXX_CRON] disparado`.

Debug:

```bash
sudo -u travus pm2 logs travus-bot --lines 500 --nostream | grep CRON
```

Esperado: `[XXX_CRON] agendado: "expr" (America/Sao_Paulo)` no boot.

Se não aparece: env `XXX_ENABLED=false` desligou, ou `XXX_CRON` inválido.

Se aparece mas não disparou: bot ficou off na hora exata. Rodar manualmente:

```bash
sudo -u travus pm2 stop travus-bot
sudo -u travus -E npm run boletos:run --prefix /opt/travus-bot   # Canopus
sudo -u travus pm2 start travus-bot
```

Os crons diários (contrato reminders + atrasos) não têm CLI de execução manual — pra testar sem esperar, sobrescrever expressão pra `*/2 * * * *` no `.env` e restart.

## `FOREIGN KEY constraint failed` ao salvar conversa

Bug histórico (resolvido). Se voltar: JID `@lid` sem mapping, `phoneFromJid` retorna phone do LID, `ensureContact` grava com PN diferente do que `getOrStartConversation` procura.

Fix: garantir que `resolveLidToPn(sock, jid)` está sendo chamado ANTES de tudo em `messages.upsert`.

## `Baileys: unknown protocol version` ou similar

Baileys precisa atualizar pra nova versão do WhatsApp Web. Deploy nova versão do bot com `npm install baileys@latest`.

## Fluxo do contrato falhou no meio

**Sintoma**: log tem `[ERRO] ... boletos emitidos na Inter mas falhou render do contrato`.

Situação: N cobranças foram criadas na Inter, mas o contrato não pôde ser gerado/enviado. Cliente não recebeu nada.

Fix:

1. Cancelar as N cobranças no painel Inter (procurar por `seuNumero=C<dealId>P*`).
2. Investigar erro do render (Inter fora? ConvertAPI fora? template com placeholder novo não mapeado?).
3. Depois de resolver: `DELETE FROM boletos_contrato_parcelas WHERE deal_id = X; DELETE FROM webhook_dispatches WHERE person_id = X AND stage_id = 654265;`
4. Mover deal no CRM pra reprocessar.

## Canopus retorna HTTP 403

WAF Cloudflare barrou. Provavelmente proxy do Render dormiu (cold start). Retry automático (default 3x com backoff exponencial) resolve.

Se persistir: verificar se URL do proxy no `.env` (`CANOPUS_BASE_URL`) está correta e proxy tá rodando.

Se o IP do Render também foi barrado: migrar proxy pra outro provedor (Fly.io, Railway) e trocar `CANOPUS_BASE_URL`.

## Cliente pagou mas `ATRASO_CRON` ainda cobra

Inter demora 1-2 dias pra atualizar `situacao` no `GET /cobrancas/{id}`. Próxima execução do cron pega. Se depois de 3 dias ainda cobrar: verificar manualmente no painel Inter se realmente foi baixado.

## Consulta a Piperun retorna sem `contactPhones`

Piperun exige `?with=contactPhones,contactEmails` em **camelCase**. Snake case (`contact_phones`) não funciona.

Ver [integracoes/piperun.md](../integracoes/piperun.md).

## Boleto real emitido em teste

Padrão nos testes: usar CPF fake `12345678909`. Inter aceita em prod (bug reportado). Boleto sai real.

Fix: cancelar no painel Inter buscando por `seuNumero` (formato `T<timestamp>` no `inter:test`, ou `C<dealId>P<NN>` no webhook real).

## Onde estão os logs

- **PM2**: `sudo -u travus pm2 logs travus-bot` ou `/root/.pm2/logs/travus-bot-out.log`
- **ConvertAPI**: dashboard em https://www.convertapi.com → Statistics
- **Inter**: painel PJ → Cobrança → API → Logs
- **Piperun webhook outbound**: painel Piperun → Automações → histórico
- **Canopus**: sem log pra terceiros; sabemos que passou pelo status 200

## Instalar `sqlite3` CLI (opcional)

Vem sem por padrão. Pra queries rápidas:

```bash
sudo apt install -y sqlite3
sudo -u travus sqlite3 /opt/travus-bot/data/conversations.db "SELECT ..."
```

Alternativa sem instalar: usar Node inline (`node -e "const Database = require('better-sqlite3'); ..."`).
