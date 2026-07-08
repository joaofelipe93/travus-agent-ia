# Baixa de pagamento e lembretes de atraso

Cron diário que consulta status de cada parcela na Inter, marca as pagas, e escala lembretes de atraso pelo WhatsApp: **D+1, D+5, D+15**. No D+15 notifica o consultor.

## Gatilho

Cron `0 9 * * *` (todo dia 09:00 BRT).

## Componentes

- `src/scheduler/contrato-atrasos-cron.js` — registra o cron
- `src/jobs/contrato-atrasos.js` — lógica completa
- `src/integrations/inter.js` — `getCobranca(codigoSolicitacao)` retorna situação atual
- `src/db.js` — helpers `getParcelasParaAcompanhar`, `updateParcelaStatus`, `bumpParcelaAtrasoLevel`

## Sequência

```
1. Cron → runContratoAtrasos(sock)
2. getParcelasParaAcompanhar():
   SELECT * FROM boletos_contrato_parcelas
   WHERE pdf_sent = 1 AND paid_at IS NULL AND codigo_solicitacao IS NOT NULL

3. Pra cada parcela:
   a. getCobranca(codigo) → resposta com situacao
   b. Se situacao ∈ {RECEBIDO, MARCADO_RECEBIDO}:
      updateParcelaStatus com paid_at=now → skip resto
   c. Senão: updateParcelaStatus (mantém paid_at NULL, atualiza status)
   d. dias_atraso = today - vencimento
   e. nextLevelToFire(dias, atraso_level_atual):
      - se dias >= 15 e level < 3 → return 3 (D+15)
      - senão se dias >= 5 e level < 2 → return 2 (D+5)
      - senão se dias >= 1 e level < 1 → return 1 (D+1)
      - senão null
   f. Se novo_nivel != null:
      - Envia msg do nível (template D+1/D+5/D+15)
      - bumpParcelaAtrasoLevel
      - Se nível 3: notifyConsultor
   g. sleep(PACING_MS) antes da próxima
```

## Escalada por nível (D+1, D+5, D+15)

Configurável via `ATRASO_DIAS_NIVEL_1/2/3`. Defaults:

| Nível | Dias após vencimento | Tom | Notifica consultor? |
|---|---|---|---|
| 1 | 1 | Suave ("se já pagou, ignora") | Não |
| 2 | 5 | Lembrete amigável | Não |
| 3 | 15 | Firme ("consultor vai entrar em contato") | Sim |

Após enviar nível N, `atraso_level = N`. Não reenviado.

## Catch-up

Se o bot ficou off por dias e a parcela tá com 20 dias de atraso mas `atraso_level=0`, o cron **não manda 3 mensagens** (D+1, D+5, D+15). Manda só o último nível elegível (D+15). Evita spam.

## Mensagens (customizáveis via env)

**D+1** (suave):
```
Oi, {{primeiro_nome}}! 😊

Vi aqui que a parcela {{parcela_n}}/{{total_parcelas}} do seu contrato venceu ontem e ainda não tá baixada no nosso sistema. Caso já tenha pago, é só desconsiderar (a baixa às vezes demora 1-2 dias úteis).

Qualquer dúvida, conta comigo!
```

**D+5** (lembrete):
```
Oi, {{primeiro_nome}}! 😊

Só pra lembrar: a parcela {{parcela_n}}/{{total_parcelas}} do seu contrato (vencida em {{data_vencimento}}) ainda não foi paga. Conseguiria regularizar? Qualquer dúvida ou se precisar de uma 2ª via, é só me chamar!
```

**D+15** (firme):
```
Oi, {{primeiro_nome}}.

A parcela {{parcela_n}}/{{total_parcelas}} do seu contrato continua em atraso há 15 dias. Pra mantermos a consultoria ativa, é importante regularizar. O consultor vai entrar em contato em breve.

Qualquer dúvida, tô aqui.
```

**Ao consultor (D+15)**:
```
[ATRASO 15 DIAS] Cliente {{cliente_nome}} (deal {{deal_id}}) com a parcela {{parcela_n}}/{{total_parcelas}} vencida há 15 dias. Bot já enviou D+1, D+5, D+15. Hora de contato direto.
```

## Env vars

| Var | Default | Nota |
|---|---|---|
| `ATRASO_ENABLED` | `true` | `false` desativa |
| `ATRASO_CRON` | `0 9 * * *` | Expressão node-cron |
| `ATRASO_DIAS_NIVEL_1` | `1` | Dias mín. após vencimento pra D+1 |
| `ATRASO_DIAS_NIVEL_2` | `5` | D+5 |
| `ATRASO_DIAS_NIVEL_3` | `15` | D+15 |
| `ATRASO_PACING_MS` | `1500` | Pacing entre msgs |
| `ATRASO_INTER_CHECK_PACING_MS` | `300` | Pacing entre consultas Inter |
| `ATRASO_TEMPLATE_D1/D5/D15` | (defaults) | Custom |
| `ATRASO_TEMPLATE_CONSULTOR` | (default) | Custom |
| `CONSULTOR_WHATSAPP` | — | Necessário pra D+15 |

## Como testar

Simula parcela com 5 dias de atraso + cron em 2 min:

```bash
# Backdate + reset atraso_level
cd /opt/travus-bot && sudo -u travus node -e "
const Database = require('better-sqlite3');
const db = new Database('data/conversations.db');
const past = new Date(Date.now() - 5*86400000).toISOString().slice(0,10);
const r = db.prepare(\"UPDATE boletos_contrato_parcelas SET data_vencimento = ?, pdf_sent = 1, atraso_level = 0, paid_at = NULL WHERE deal_id = '60996889' AND parcela_n = 2\").run(past);
console.log('linhas:', r.changes, '| nova venc:', past);
"

echo 'ATRASO_CRON=*/2 * * * *' | sudo -u travus tee -a /opt/travus-bot/.env > /dev/null
sudo -u travus pm2 restart travus-bot

# Aguarda 2-3 min e confere
sudo -u travus pm2 logs travus-bot --lines 30 --nostream | grep ATRASO
```

**Restaura defaults:**

```bash
sudo -u travus sed -i '/^ATRASO_CRON=/d' /opt/travus-bot/.env
sudo -u travus pm2 restart travus-bot
```

## O que pode dar errado

| Sintoma | Causa |
|---|---|
| `nenhuma parcela pendente pra acompanhar — skip` | Não há parcelas com `pdf_sent=1 AND paid_at IS NULL` |
| Consultor não recebeu no D+15 | `CONSULTOR_WHATSAPP` vazio ou número não existe no WhatsApp |
| Cliente pagou mas cron ainda cobra | Delay: Inter demora 1-2 dias pra atualizar `situacao`; próxima execução resolve |
| `erro getCobranca` | Token Inter expirou (raro), ou API do Inter fora — próximo dia tenta de novo |
