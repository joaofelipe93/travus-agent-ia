# Captação de lead + qualificação (Ana)

Fluxo principal do bot: cliente escreve no WhatsApp, Ana qualifica, coleta dados, agenda ligação com o consultor.

## Gatilho

Mensagem chega no WhatsApp do bot (`messages.upsert` do Baileys).

## Componentes envolvidos

- `src/whatsapp/index.js` — recebe e roteia
- `src/whatsapp/queue.js` — serializa mensagens por JID
- `src/whatsapp/buffer.js` — coalesce mensagens em rajada (~4s)
- `src/handler.js` — orquestrador (100+ linhas de lógica)
- `src/agent.js` — chama OpenAI com o prompt da Ana
- `prompts/ana.md` — system prompt (versionado no repo)
- `src/integrations/whisper.js` — transcreve áudio, se mensagem for de voz
- `src/integrations/piperun.js` — envia lead pro CRM
- `src/integrations/calendar.js` — cria evento no Google Calendar
- `src/api/piperun-api.js` — move deal pra stage "Conexão"

## Sequência

```
1. WhatsApp msg → messages.upsert
2. Resolve JID: se @lid, usa lidMapping.getPNForLID pra achar @s.whatsapp.net
3. Se áudio: baixa buffer, chama Whisper, usa transcrição como texto
4. Buffer coalesce (se lead mandar 3 msgs em 4s, combina)
5. enqueue(jid, task) — fila serial por contato
6. handler.handleMessage(from, text, sock):
   a. Gate "lead antigo": se history vazio E texto sem "formulário", silencia bot
   b. Salva msg como user na db
   c. Gate "modo manual": se bot_enabled=0, ignora
   d. Gate "scheduled": se agendamento já foi feito, manda canned + silencia
   e. Injeta contexto no input: [Número do WhatsApp], [Data e horário BRT], [Contexto LP]
   f. askAgent(history, input) — OpenAI gpt-4o-mini + prompt Ana
   g. processAgentResponse(resposta): extrai JSON de lead ou encerramento
   h. Se JSON de encerramento (moradia/capacidade_baixa/renda_baixa): disableFollowUps
   i. Se JSON de lead completo:
      - recordLeadCapture na db
      - enviarLeadPipeRun (webhook integrador Piperun)
      - createCalendarEvent (Google Calendar com link Meet)
      - Se Calendar OK: markConversationScheduled + moveDealToStage("Conexão")
7. Envia cleanText (resposta sem JSON) pelo WhatsApp com sendWithPresence
```

## Detalhes importantes

- **Ana** vive no prompt `prompts/ana.md` — editar exige deploy (versionado no Git).
- **JSON de lead** tem 6 campos: `nome`, `email`, `celular`, `renda_mensal`, `data_agendamento`, `hora_agendamento`. Se algum faltar, não captura ainda.
- **Celular**: se veio JID válido (`@s.whatsapp.net`), o bot **ignora** o celular do JSON e usa o do JID — evita cliente colocar número fake.
- **Encerramento**: 3 motivos (moradia, capacidade_baixa, renda_baixa) → apenas desliga follow-ups; conversa segue viva.
- **Stage Conexão** (id `648383`): pra onde o deal é movido após agendamento OK.
- **Deal ID**: pra saber qual deal mover, o bot busca em cascata:
  1. `conversations.piperun_deal_id` (salvo pelo webhook LP)
  2. Extraído da resposta do integrador Piperun
  3. Fallback: `GET /v1/persons?email` → `GET /v1/deals?person_id`

## Como testar

1. Mande "Oi" pra o WhatsApp do bot de um contato novo.
2. Se for lead vindo da LP, o bot já se apresenta e a próxima msg do lead é tratada como parte do fluxo.
3. Passe pelos passos: nome, intenção (morar/investir), capacidade financeira, renda, cidade, e finalmente aceita horário.
4. Ao final, deve chegar: mensagem de confirmação com hora + link Meet no Calendar do consultor + deal em "Conexão" no Piperun.

## O que pode dar errado

| Sintoma | Causa provável |
|---|---|
| Bot não responde a msg do WhatsApp | JID `@lid` sem mapping — cai no gate "lead antigo" | 
| `FOREIGN KEY constraint failed` | Contato salvo com phone diferente do JID canônico (bug antigo, resolvido) |
| Bot manda "Bom dia" 2x | Saudação foi consumida na proativa (LP) e código deveria pular — checar `history.length === 1` |
| Lead com celular fake | Bot prioriza o JID quando é `@s.whatsapp.net`, mas se veio de `@lid` sem mapping, pode aceitar o do JSON |
| Calendar OK mas deal fica em "Abertura" | Falha ao resolver `deal_id` — checar log `[CRM] deal_id não resolvido` |
