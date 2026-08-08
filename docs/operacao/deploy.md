# Deploy na VPS

## Estrutura em produção

- **VPS**: DigitalOcean (`s-1vcpu-1gb`) rodando Ubuntu
- **Diretório**: `/opt/travus-bot`
- **Usuário do processo**: `travus` (sem shell, criado no setup)
- **Process manager**: PM2 (`ecosystem.config.cjs`)
- **Node**: 22 via NodeSource

## Setup inicial

Uma vez, como root:

```bash
curl -fsSL https://raw.githubusercontent.com/joaofelipe93/travus-agent-ia/main/scripts/setup-vps.sh | sudo bash
```

O script:
1. `apt update` + instala `curl git`
2. Instala Node 22 via NodeSource
3. Instala PM2 global
4. Cria user `travus`
5. Clona repo em `/opt/travus-bot`
6. Guia próximos passos manuais

Passos manuais depois:

1. Cria `/opt/travus-bot/.env` com todas as vars (ver `docs/operacao/env-vars.md`)
2. Sobe secrets:
   - `secrets/inter/inter.crt` e `secrets/inter/inter.key` (mTLS Banco Inter, `chmod 600` na key)
   - `google-credentials.json` (Service Account do Calendar)
   - `src/assets/contrato-template.docx` (template do contrato)
   - `src/assets/material.pdf` (material de apresentação)
3. Sessão WhatsApp:
   ```bash
   sudo -u travus pm2 start /opt/travus-bot/ecosystem.config.cjs
   sudo -u travus pm2 logs travus-bot   # ver QR code
   ```
   Escaneia no WhatsApp Business do consultor.

## Deploy incremental (feature já mergeada em main)

```bash
sudo -u travus git -C /opt/travus-bot pull
sudo -u travus npm ci --prefix /opt/travus-bot --omit=dev
sudo -u travus pm2 restart travus-bot
```

**Nunca esquecer o `npm ci`** — se a PR incluiu nova dep, sem isso o boot dá `ERR_MODULE_NOT_FOUND`.

## Testar branch antes de mergear

Fluxo padrão (ver [feedback-test-on-vps-before-merge](../../.claude/projects/-home-larissa-Documentos-travus-agent-ia/memory/feedback_test_on_vps_before_merge.md)):

```bash
# Puxa a branch da PR
sudo -u travus git -C /opt/travus-bot fetch origin
sudo -u travus git -C /opt/travus-bot checkout <nome-da-branch>
sudo -u travus npm ci --prefix /opt/travus-bot --omit=dev   # só se PR tem dep nova
sudo -u travus pm2 restart travus-bot

# Testa o fluxo real

# Se ok, avisa autor pra mergear; se não ok, volta pra main:
sudo -u travus git -C /opt/travus-bot checkout main
sudo -u travus pm2 restart travus-bot
```

## Comandos úteis

```bash
# Status do processo
sudo -u travus pm2 status

# Logs em tempo real
sudo -u travus pm2 logs travus-bot

# Logs recentes (últimas 100 linhas, sem streaming)
sudo -u travus pm2 logs travus-bot --lines 100 --nostream

# Filtra por tag
sudo -u travus pm2 logs travus-bot --lines 200 --nostream | grep -E "CRON|CONTRATO|BOLETOS"

# Restart
sudo -u travus pm2 restart travus-bot

# Rodar cron manualmente
sudo -u travus pm2 stop travus-bot
sudo -u travus -E npm run boletos:run --prefix /opt/travus-bot   # cron Canopus
sudo -u travus -E npm run inter:test --prefix /opt/travus-bot    # teste Inter
sudo -u travus pm2 start travus-bot

# Backup do SQLite
sudo -u travus npm run backup:db --prefix /opt/travus-bot

# Reset da sessão WhatsApp (novo cliente)
sudo bash /opt/travus-bot/scripts/reset-session.sh
```

## Verificar boot bem-sucedido

Após restart, checar:

```bash
sudo -u travus pm2 logs travus-bot --lines 30 --nostream | grep -E "OK|API|CRON|Error"
```

Esperado:
```
[API] ouvindo na porta 3000
[OK] Conectado ao WhatsApp.
[BOLETOS_CRON] agendado: "0 9 8 * *" (America/Sao_Paulo)
[CONTRATO_REMINDER_CRON] agendado: "0 9 * * *" (America/Sao_Paulo)
[ATRASO_CRON] agendado: "0 9 * * *" (America/Sao_Paulo)
[FOLLOWUP] scheduler iniciado (checa a cada 60s)
[REMINDER] scheduler de reuniões iniciado (poll cada 2min)
```

Sem `Error` nem `ENOENT`.
