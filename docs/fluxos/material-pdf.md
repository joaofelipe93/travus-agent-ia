# Envio de material PDF

Quando um deal do Piperun entra em determinada stage, o bot manda pra o lead o PDF de apresentação da Travus.

## Gatilho

Webhook `POST /webhook/piperun` disparado pelo Piperun quando o deal entra em stage configurada.

## Componentes

- `src/api/webhook-piperun.js` — handler
- `src/db.js` — `webhook_dispatches` (idempotência)
- `src/assets/material.pdf` — PDF a ser enviado (gitignored, sobe manual na VPS)

## Sequência

```
1. POST /webhook/piperun com payload do Piperun
2. Valida person.id + stage.id
3. Extrai person.contact_phones[main].number
4. Se já dispatched (por person_id + stage_id): ignora (200 already_dispatched)
5. sock.onWhatsApp(phone) → resolve JID (@s.whatsapp.net)
6. phoneFromJid → canonicalPhone
7. ensureContact + recordWebhookDispatch (idempotência)
8. Enfileira: sendWithPresence(msg) → sock.sendMessage(document: material.pdf)
```

## Env vars

| Var | Default |
|---|---|
| `WEBHOOK_PDF_PATH` | `src/assets/material.pdf` |
| `WEBHOOK_PDF_FILENAME` | `Travus Capital.pdf` |

## Como testar

1. No Piperun, move um lead pra stage que dispara esse webhook.
2. No WhatsApp do lead, deve chegar: 1 mensagem de apresentação + 1 PDF.

## O que pode dar errado

| Sintoma | Causa |
|---|---|
| `WhatsApp não conectado` (503) | Bot desconectou — restart PM2 |
| `phone not on whatsapp` (404) | Número no CRM não existe no WhatsApp — normal, log e segue |
| PDF não encontrado (ENOENT) | Arquivo em `src/assets/material.pdf` não foi upload pra VPS |
| Dispatch duplicado | `webhook_dispatches` UNIQUE(person_id, stage_id) já bloqueia |
