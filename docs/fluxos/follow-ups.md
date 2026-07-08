# Follow-ups da Ana

Bot cutuca leads que pararam de responder no meio da qualificação.

## Gatilho

Scheduler `startFollowUpScheduler` roda a cada **60 segundos**, verifica conversas paradas e dispara follow-ups escalonados.

## Componentes

- `src/whatsapp/followup.js` — scheduler + envio
- `src/db.js` — `conversations.last_user_message_at`, `followup_step`, `disqualified`, `call_answered_at`

## Sequência

```
1. A cada 60s → checkFollowUps()
2. getConversationsNeedingFollowUp() →
   SELECT conv WHERE status='active'
     AND disqualified IS NULL         -- não encerrou (moradia/renda/capacidade)
     AND call_answered_at IS NULL     -- não atendeu ligação
     AND bot_enabled = 1              -- não está em modo manual
     AND followup_step < 3
     AND last_user_message_at < (thresholds abaixo)
3. Pra cada conversa:
   - Escolhe mensagem baseado em followup_step (0/1/2)
   - Envia via WhatsApp
   - Incrementa followup_step
   - Atualiza timestamp
```

## Escalada (3 passos)

Após lead ficar N horas sem responder, a Ana manda mensagem cutucando. Cada passo é mais firme que o anterior. Após o 3º sem resposta, o bot para de tentar.

Detalhes exatos dos thresholds e textos em [src/whatsapp/followup.js](../../src/whatsapp/followup.js).

## Gates que desativam o follow-up

| Coluna | Quando setada | Efeito |
|---|---|---|
| `disqualified` | Ana emite JSON `{"encerrar":"..."}` | Follow-ups off (mas conversa segue viva) |
| `call_answered_at` | Evento `call.status === "accept"` do Baileys | Follow-ups off (lead atendeu ligação do consultor) |
| `bot_enabled = 0` | Modo manual (gate de "lead antigo") | Bot inteiro cala |
| `scheduled_at` | Lead completou agendamento | Bot manda canned + `disableBot` |
| `followup_step >= 3` | Já mandou os 3 lembretes | Para de tentar |

## Como testar

Manda uma mensagem inicial "Oi", passa alguns passos com a Ana, e depois **deixa de responder**. Após passar o threshold do passo 0, deve chegar o primeiro follow-up.

Pra acelerar em teste: manipula `last_user_message_at` direto na db pra parecer que já se passou tempo suficiente.

## O que pode dar errado

| Sintoma | Causa |
|---|---|
| Follow-up nunca chega | `disqualified` foi setado (Ana desistiu) ou `bot_enabled=0` |
| Ana manda "Bom dia" 2x no follow-up | Bug do prompt — saudação deve aparecer só na 1ª msg da conversa |
| Follow-up depois do lead ter respondido | Race — resolvido no PR `fix/followup-race-with-user-reply` |
