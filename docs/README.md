# Documentação — Travus Agent IA

Bot WhatsApp que qualifica leads da Travus Capital via agente Ana (OpenAI gpt-4o-mini), emite contratos e boletos via Banco Inter/consórcio Canopus, e integra com Piperun CRM + Google Calendar.

## Índice

### Visão geral
- [Arquitetura](./arquitetura.md) — componentes, diagrama, quem fala com quem

### Fluxos
- [Captação de lead + qualificação](./fluxos/captacao-lead.md) — Ana + Calendar + Piperun
- [Envio de material PDF](./fluxos/material-pdf.md) — webhook Piperun
- [Boas-vindas ao lead da LP](./fluxos/novo-cliente-lp.md) — mensagem proativa após cadastro
- [Emissão de contrato + boletos](./fluxos/emissao-contrato.md) — Inter + WhatsApp
- [Lembretes de parcelas](./fluxos/lembretes-parcelas.md) — cron diário
- [Baixa de pagamento e atrasos](./fluxos/baixa-pagamento.md) — cron diário + D+1/D+5/D+15
- [Boletos mensais do consórcio](./fluxos/boletos-mensais-canopus.md) — cron dia 10
- [Follow-ups da Ana](./fluxos/follow-ups.md) — bot retoma conversa parada
- [Lembretes de reunião](./fluxos/lembretes-reuniao.md) — D-1, dia, T-15min

### Integrações externas
- [Piperun CRM](./integracoes/piperun.md)
- [Banco Inter](./integracoes/inter.md)
- [ConvertAPI](./integracoes/convertapi.md)
- [Consórcio Canopus](./integracoes/canopus.md)
- [Google Calendar](./integracoes/google.md)
- [OpenAI (chat + Whisper)](./integracoes/openai.md)
- [WhatsApp via Baileys](./integracoes/whatsapp.md)

### Operação
- [Deploy na VPS](./operacao/deploy.md)
- [Variáveis de ambiente](./operacao/env-vars.md)
- [Schema do banco](./operacao/db-schema.md)
- [Troubleshooting](./operacao/troubleshooting.md)

## Convenções desta doc

- **Fluxo**: cadeia de eventos que começa num gatilho (mensagem, webhook, cron) e termina num efeito visível (mensagem enviada, boleto emitido, deal movido).
- **Integração**: como o bot conversa com um serviço externo (auth, endpoints, quirks).
- Cada fluxo termina com **"Como testar"** e **"O que pode dar errado"** — pra facilitar debug e onboarding.
