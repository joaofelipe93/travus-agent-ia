# Schema do banco (SQLite)

`data/conversations.db` — WAL mode. Fonte: [`src/db.js`](../../src/db.js).

## Tabelas principais

### `contacts`

Um por número de WhatsApp.

| Coluna | Tipo | Descrição |
|---|---|---|
| `phone` | TEXT PK | 5584991646369 |
| `jid` | TEXT UNIQUE | 5584991646369@s.whatsapp.net |
| `created_at` | INTEGER | unixepoch |

### `conversations`

Uma por conversa ativa. Um `phone` pode ter várias historicamente, mas só uma com `status=active`.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | INTEGER PK | |
| `phone` | TEXT FK contacts | |
| `status` | TEXT | `active` (padrão) |
| `last_user_message_at` | INTEGER | Pra follow-up scheduler |
| `followup_step` | INTEGER | 0..3 (contador de follow-ups) |
| `created_at`, `updated_at` | INTEGER | |
| `disqualified` | TEXT | motivo (`moradia`/`capacidade_baixa`/`renda_baixa`) |
| `bot_enabled` | INTEGER | 0 = modo manual, 1 = ativo |
| `call_answered_at` | INTEGER | Quando lead atendeu ligação → follow-ups off |
| `piperun_deal_id` | TEXT | Salvo pelo webhook LP pra depois mover pra "Conexão" |
| `scheduled_at` | INTEGER | Quando lead completou agendamento → bot cala |

### `messages`

Histórico completo de user + assistant.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | INTEGER PK | |
| `conversation_id` | INTEGER FK | |
| `role` | TEXT | `user` ou `assistant` |
| `content` | TEXT | Texto (sem JSON — filtrado) |
| `created_at` | INTEGER | |

### `leads`

Um por conversa que completou o agendamento.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | INTEGER PK | |
| `conversation_id` | INTEGER UNIQUE FK | 1 lead por conversa |
| `phone` | TEXT FK contacts | |
| `nome`, `email`, `celular`, `renda_mensal`, `data_agendamento`, `hora_agendamento` | TEXT | Campos do JSON da Ana |
| `piperun_sent_at` | INTEGER | Quando foi mandado pro Piperun (histórico) |
| `created_at` | INTEGER | |

## Idempotência de webhooks / eventos

### `processed_messages`

Dedupe de mensagens recebidas do Baileys (reentregas em reconexão).

- `message_id` TEXT PK
- Auto-limpado após 7 dias (`pruneProcessedMessages`)

### `webhook_dispatches`

Dedupe de webhooks Piperun (mesmo deal entrando 2x na stage).

- `UNIQUE(person_id, stage_id)`

### `meeting_reminders`

Dedupe de lembretes de reunião.

- `UNIQUE(event_id, reminder_type)`

## Boletos

### `boleto_clients`

Cache dos clientes do consórcio (cron mensal Canopus).

- `deal_id` PK
- `cpf`, `nome`, `phone`, `jid` (populados no cron pra depois evitar consulta Piperun)
- `synced_at`

### `boletos_sent`

Rastreio dos boletos Canopus enviados. Idempotência do cron mensal.

- `UNIQUE(deal_id, bill_id)`

### `boletos_contrato_parcelas`

Cada parcela do contrato emitido via Inter.

| Coluna | Tipo | Descrição |
|---|---|---|
| `deal_id` | TEXT | Deal do Piperun |
| `parcela_n` | INTEGER | 1..N |
| `total_parcelas` | INTEGER | N |
| `codigo_solicitacao` | TEXT | ID da cobrança na Inter |
| `seu_numero` | TEXT | `C<dealId>P<NN>` |
| `valor_nominal`, `data_vencimento`, `linha_digitavel`, `pix_copia_e_cola` | | Snapshot da cobrança |
| `pdf_sent` | INTEGER | 0 = não enviado, 1 = enviado pelo WhatsApp |
| `jid`, `nome` | TEXT | Snapshot pra cron achar cliente sem re-consulta |
| `paid_at` | INTEGER | Quando Inter retornou `RECEBIDO` |
| `status` | TEXT | Última situação Inter |
| `status_checked_at` | INTEGER | Último check |
| `atraso_level` | INTEGER | 0/1/2/3 (D+1/D+5/D+15) |
| `atraso_notified_at` | INTEGER | |
| `error` | TEXT | Msg de erro se algum ponto falhou |
| `created_at` | INTEGER | |
| `UNIQUE(deal_id, parcela_n)` | | Idempotência |

### `boletos_emitidos` (legado)

Fase 1b — 1 boleto único por deal. Substituída pela `boletos_contrato_parcelas` que suporta parcelamento. **Não usada em código novo**, mantida por histórico.

## Migrations

Sem sistema formal de migrations. Novas colunas são adicionadas via `ensureColumn(table, column, definition)` — checa `PRAGMA table_info` e faz `ALTER TABLE` se ausente. Idempotente, roda a cada boot.

Novas tabelas: `CREATE TABLE IF NOT EXISTS` no bloco inicial do `db.js`.

## Backup

```bash
sudo -u travus npm run backup:db --prefix /opt/travus-bot
```

Gera cópia em `data/backup-YYYY-MM-DDTHH-MM-SS.db` usando `sqlite3_backup_api` (safe com WAL).
