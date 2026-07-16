# WhatsApp via Baileys

Cliente WhatsApp Web multi-device sem Chromium. Escolhido em vez de `whatsapp-web.js` pra caber em VPS de 1 GB.

## Auth

- Sessão persistida em `/opt/travus-bot/.baileys-auth/` (gitignored)
- Primeiro boot: gera QR code no terminal → escanear no WhatsApp do cliente (Aparelhos Conectados)
- Reset da sessão: `sudo bash /opt/travus-bot/scripts/reset-session.sh`

## Handlers principais em `src/whatsapp/index.js`

| Event Baileys | Handler | O que faz |
|---|---|---|
| `messages.upsert` | Handler grande | Roteia msg pra `handler.js` (texto ou áudio transcrito) |
| `connection.update` | Reconecta | Se `loggedOut`, exit(1) — precisa reset manual |
| `creds.update` | `saveCreds` do Baileys | Salva token de sessão |
| `call` | `markCallAnswered` | Se lead atendeu ligação, desativa follow-ups |

## Camadas antes do handler

Ordem de processamento de uma mensagem inbound:

```
messages.upsert (Baileys)
      ↓
markMessageProcessed (dedupe por message_id)  ← evita reprocessar
      ↓
resolveLidToPn (@lid → @s.whatsapp.net)       ← normaliza JID
      ↓
Filtro: msg não tem texto? áudio → Whisper; outro → ignora
      ↓
bufferText (coalesce ~4s)                     ← agrupa rajadas
      ↓
enqueue(jid, task)                            ← fila serial por contato
      ↓
handler.handleMessage
```

## LID vs PN

WhatsApp Web multi-device introduziu **LID** (Linked Device ID, anonimizado):

- `msg.key.remoteJid` pode vir como `NNNNNNNNNNNNNN@lid` ao invés de `55XX9NNNNNNNN@s.whatsapp.net`
- Nosso banco indexa por telefone (PN), então **resolvemos LID → PN** na entrada usando `sock.signalRepository.lidMapping.getPNForLID(lid)`
- Se não resolver, cai no `@lid` mesmo (degradação graciosa) — mas isso quebra idempotência de contatos que também aparecem via PN

## Envio de mensagens

`sendWithPresence(sock, jid, text)`:
1. Marca "typing" no WhatsApp
2. Aguarda proporção ao tamanho do texto (parece humano)
3. Envia texto

Documentos: `sock.sendMessage(jid, { document, mimetype, fileName })`.

## Rate limit / boas práticas

- **1.5s de pacing** entre envios pro mesmo JID (nos crons)
- **3s de pacing** entre clientes diferentes (no cron mensal Canopus)
- **Sessão única por número WhatsApp** — rodar 2 bots com mesma sessão dá `Stream Errored (conflict)`
- **Sempre `pm2 stop travus-bot` antes de rodar comandos manuais** (`inter:test`, `boletos:run`)

## Idempotência de mensagens recebidas

Baileys pode reentregar msgs em reconexão. Tabela `processed_messages` com `UNIQUE(message_id)` bloqueia dupes.

## Env vars

Sem env vars específicas. Session dir hardcoded em `.baileys-auth/`.
