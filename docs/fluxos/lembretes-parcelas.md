# Lembretes de parcelas do contrato

Cron diário que envia pelo WhatsApp o boleto de cada parcela do contrato quando fica próxima do vencimento. A parcela 1 é enviada no [webhook de emissão](./emissao-contrato.md); as demais (2..N) ficam com `pdf_sent=0` e são despachadas por este cron.

## Gatilho

Cron `0 9 * * *` (todo dia 09:00 BRT).

## Componentes

- `src/scheduler/contrato-reminders-cron.js` — registra o cron
- `src/jobs/contrato-reminders.js` — lógica do envio
- `src/db.js` — helper `getParcelasParaLembrar(windowDays)`
- `src/integrations/inter.js` — baixa o PDF do boleto na Inter

## Sequência

```
1. Cron dispara → runContratoReminders(sock)
2. getParcelasParaLembrar(WINDOW_DAYS=10) →
   SELECT * FROM boletos_contrato_parcelas
   WHERE pdf_sent = 0
     AND parcela_n > 1
     AND date(data_vencimento) BETWEEN today AND today+10 days
3. Pra cada parcela elegível:
   a. getBoletoPdf(codigo_solicitacao) — baixa PDF da Inter
   b. sendWithPresence(mensagem)
   c. sock.sendMessage(document: pdf)
   d. markContratoParcelaPdfSent(deal_id, parcela_n) → pdf_sent = 1
   e. sleep(PACING_MS=1500) antes da próxima
4. Log com summary { total, enviadas, sem_jid, pdf_falhou, envio_falhou }
```

## Mensagem enviada

Template default:

```
Oi, {{primeiro_nome}}! 😊

Segue o boleto da consultoria — parcela {{parcela_n}}/{{total_parcelas}} 📄

Vence em {{data_vencimento}}. Qualquer dúvida, conta comigo!
```

## Env vars

| Var | Default | Nota |
|---|---|---|
| `CONTRATO_REMINDER_ENABLED` | `true` | `false` desativa o cron |
| `CONTRATO_REMINDER_CRON` | `0 9 * * *` | Expressão node-cron |
| `CONTRATO_REMINDER_WINDOW_DIAS` | `10` | Antecipação em dias |
| `CONTRATO_REMINDER_PACING_MS` | `1500` | Pacing entre envios |
| `CONTRATO_REMINDER_TEMPLATE` | (texto default) | Customiza mensagem |

## Idempotência

- `pdf_sent=1` impede reenvio da mesma parcela.
- Se envio falhar (Inter caiu, WhatsApp deu erro), `pdf_sent` continua `0` → próximo dia tenta de novo.

## Como testar

Sem esperar 30 dias, backdate + reduz o cron:

```bash
# Backdate parcela 2 pra vencer amanhã
cd /opt/travus-bot && sudo -u travus node -e "
const Database = require('better-sqlite3');
const db = new Database('data/conversations.db');
const amanha = new Date(Date.now() + 86400000).toISOString().slice(0,10);
const r = db.prepare(\"UPDATE boletos_contrato_parcelas SET data_vencimento = ?, pdf_sent = 0 WHERE deal_id = '60996889' AND parcela_n = 2\").run(amanha);
console.log('linhas:', r.changes, '| nova venc:', amanha);
"

# Cron temporário a cada 2 min
echo 'CONTRATO_REMINDER_CRON=*/2 * * * *' | sudo -u travus tee -a /opt/travus-bot/.env > /dev/null
sudo -u travus pm2 restart travus-bot
```

Aguarda 2-3 min e olha:

```bash
sudo -u travus pm2 logs travus-bot --lines 30 --nostream | grep CONTRATO_REMINDER
```

**Restaura defaults depois:**

```bash
sudo -u travus sed -i '/^CONTRATO_REMINDER_CRON=/d' /opt/travus-bot/.env
sudo -u travus pm2 restart travus-bot
```

## O que pode dar errado

| Sintoma | Causa |
|---|---|
| `nenhuma parcela vencendo nos próximos 10 dias — skip` | Normal se não há parcelas dentro da janela |
| `sem jid registrado, pulando` | Bug antigo (parcela emitida sem `jid`) — só afeta dados legados; hoje o webhook sempre salva |
| `sem codigo_solicitacao registrado` | Cobrança na Inter falhou mas parcela foi gravada — cancela manualmente e re-processa |
| Parcela reenviada 2x | Não devia acontecer; `pdf_sent=1` deveria bloquear. Se acontecer, checar se algum job resetou o flag |
