# Travus Agent IA

Backend Node.js que conecta o **WhatsApp** a um agente de IA da **DigitalOcean Gradient AI Platform**. O agente qualifica leads, coleta dados e envia automaticamente para o **CRM Piperun**.

## Como funciona

1. Lead envia mensagem no WhatsApp do cliente
2. O bot encaminha ao agente de IA (configurado na DigitalOcean)
3. O agente conduz a conversa, coleta nome, e-mail, celular, renda e agendamento
4. Ao finalizar, os dados são enviados automaticamente ao Piperun
5. O histórico da conversa fica salvo em SQLite para contexto de follow-up

## Stack

- **Node.js 22** (ESM)
- **Baileys** — conexão WhatsApp via QR code (sem Chromium)
- **openai SDK** — consumo do agente DigitalOcean Gradient
- **better-sqlite3** — histórico de conversas por contato
- **PM2** — gerenciamento de processo na VPS

## Pré-requisitos

- Node.js 22+
- VPS Ubuntu com 1GB RAM (ex: DigitalOcean `s-1vcpu-1gb`)
- Agente criado na [DigitalOcean Gradient AI Platform](https://cloud.digitalocean.com/gen-ai)
- Conta no [Piperun CRM](https://pipe.run)

## Variáveis de ambiente

Crie um arquivo `.env` baseado no `.env.example`:

```env
AGENTENDPOINT=https://<id>.agents.do-ai.run
SECRETKEYAGENT=<chave-de-acesso-do-agente>
PIPERUN_HASH=<hash-do-integrador-piperun>
```

## Rodar localmente

```bash
npm install
cp .env.example .env
# preencha o .env com suas credenciais
npm run dev
```

Escaneie o QR code no WhatsApp do celular:
> WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho

## Deploy na VPS

Execute uma vez como root na VPS:

```bash
curl -fsSL https://raw.githubusercontent.com/joaofelipe93/travus-agent-ia/main/scripts/setup-vps.sh | sudo bash
```

O script instala Node.js 22, PM2, clona o repositório e guia pelos próximos passos.

## Trocar sessão WhatsApp

Para conectar o WhatsApp de um novo cliente:

```bash
sudo bash /opt/travus-bot/scripts/reset-session.sh
```

O QR code aparece no terminal. Após o cliente escanear, o PM2 reinicia automaticamente com a nova sessão.

## Comandos úteis na VPS

```bash
# Logs em tempo real
sudo -u travus pm2 logs travus-bot

# Status do processo
sudo -u travus pm2 status

# Reiniciar
sudo -u travus pm2 restart travus-bot

# Atualizar código
sudo -u travus git -C /opt/travus-bot pull
sudo -u travus npm ci --prefix /opt/travus-bot
sudo -u travus pm2 restart travus-bot
```

## Testes

```bash
npm test
```

```bash
# Testar conexão com o agente DigitalOcean
npm run test:agent
```
