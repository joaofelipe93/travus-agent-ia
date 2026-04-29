#!/usr/bin/env bash
# Setup inicial da VPS — rodar uma vez como root ou com sudo
set -euo pipefail

REPO_URL="https://github.com/joaofelipe93/travus-agent-ia.git"
APP_DIR="/opt/travus-bot"
APP_USER="travus"

echo "==> Atualizando pacotes..."
apt-get update -qq && apt-get upgrade -y -qq

echo "==> Instalando dependências do sistema..."
apt-get install -y -qq curl git

echo "==> Instalando Node.js 22 via NodeSource..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

echo "==> Instalando PM2 globalmente..."
npm install -g pm2

echo "==> Criando usuário '$APP_USER' (sem login)..."
id "$APP_USER" &>/dev/null || useradd --system --shell /usr/sbin/nologin --create-home "$APP_USER"

echo "==> Clonando repositório em $APP_DIR..."
if [ -d "$APP_DIR" ]; then
  echo "    Diretório já existe — atualizando..."
  git -C "$APP_DIR" pull
else
  git clone "$REPO_URL" "$APP_DIR"
fi

chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

echo "==> Instalando dependências Node..."
sudo -u "$APP_USER" npm ci --prefix "$APP_DIR"

echo "==> Criando pasta de logs..."
sudo -u "$APP_USER" mkdir -p "$APP_DIR/logs"

echo ""
echo "==================================================================="
echo "Setup concluído!"
echo ""
echo "Próximos passos:"
echo ""
echo "  1. Crie o arquivo .env:"
echo "       sudo -u $APP_USER nano $APP_DIR/.env"
echo "     Conteúdo:"
echo "       AGENTENDPOINT=https://<id>.agents.do-ai.run"
echo "       SECRETKEYAGENT=<sua-chave>"
echo ""
echo "  2. Escaneie o QR code (sessão única):"
echo "       sudo -u $APP_USER node $APP_DIR/src/index.js"
echo "     Escaneie o QR no WhatsApp e aguarde a mensagem:"
echo "       [OK] Conectado ao WhatsApp. Aguardando mensagens..."
echo "     Depois pressione Ctrl+C — a sessão ficou salva em .baileys-auth/"
echo ""
echo "  3. Inicie o bot com PM2:"
echo "       cd $APP_DIR && sudo -u $APP_USER pm2 start ecosystem.config.cjs"
echo "       sudo -u $APP_USER pm2 save"
echo ""
echo "  4. Configure o PM2 para iniciar no boot:"
echo "       pm2 startup systemd -u $APP_USER --hp /home/$APP_USER"
echo "     (cole e execute o comando que o PM2 imprimir)"
echo ""
echo "  Comandos úteis:"
echo "    Logs em tempo real : sudo -u $APP_USER pm2 logs travus-bot"
echo "    Status             : sudo -u $APP_USER pm2 status"
echo "    Reiniciar          : sudo -u $APP_USER pm2 restart travus-bot"
echo "    Atualizar código   : cd $APP_DIR && git pull && npm ci && pm2 restart travus-bot"
echo "==================================================================="
