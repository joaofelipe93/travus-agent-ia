#!/usr/bin/env bash
# Troca a sessão do WhatsApp: apaga a sessão atual e gera novo QR para o cliente escanear.
# Uso: sudo bash scripts/reset-session.sh
set -euo pipefail

APP_DIR="/opt/travus-bot"
APP_USER="travus"

if [ "$(id -u)" -ne 0 ]; then
  echo "[ERRO] Execute como root: sudo bash $0"
  exit 1
fi

echo "==> Parando o bot..."
sudo -u "$APP_USER" pm2 stop travus-bot 2>/dev/null || true

echo "==> Removendo sessão anterior..."
rm -rf "$APP_DIR/.baileys-auth/"

TMPLOG=$(mktemp /tmp/travus-qr-XXXXXX.log)

cleanup() {
  pkill -u "$APP_USER" -f "node.*src/index.js" 2>/dev/null || true
  rm -f "$TMPLOG"
}
trap cleanup EXIT

echo ""
echo "==> Aguardando o cliente escanear o QR code..."
echo "    WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho"
echo ""

sudo -u "$APP_USER" stdbuf -oL node "$APP_DIR/src/index.js" 2>&1 | stdbuf -oL tee "$TMPLOG" &
PIPE_PID=$!

until grep -q "\[OK\] Conectado ao WhatsApp" "$TMPLOG" 2>/dev/null; do
  sleep 1
  if ! kill -0 "$PIPE_PID" 2>/dev/null; then
    echo ""
    echo "[ERRO] Processo encerrado antes de conectar. Verifique o .env e tente novamente."
    exit 1
  fi
done

trap - EXIT
cleanup

echo ""
echo "==> Sessão salva! Reiniciando via PM2..."
sudo -u "$APP_USER" pm2 start "$APP_DIR/ecosystem.config.cjs"
sudo -u "$APP_USER" pm2 save

echo ""
echo "==> Concluído! Bot rodando com a sessão do cliente."
echo ""
sudo -u "$APP_USER" pm2 status
