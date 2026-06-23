# Banco Inter — credenciais e certificados

Esta pasta guarda os arquivos sensíveis necessários pra autenticação mTLS com a API de cobrança do Banco Inter. **Nada aqui dentro vai pro Git** (exceto este README e o `.gitkeep`).

## O que precisa estar aqui

| Arquivo | Origem |
|---|---|
| `inter.crt` | Certificado público (`.crt` ou `.pem`) baixado no Internet Banking PJ |
| `inter.key` | Chave privada associada ao certificado (mostrada **uma única vez** no momento da emissão) |

Os caminhos exatos são configurados via env (`INTER_CERT_FILE`, `INTER_KEY_FILE` — ver `.env.example`).

## Como obter

1. Internet Banking PJ → **Cobranças** → **API Cobrança** → **Aplicações**.
2. Crie (ou edite) uma aplicação com escopo `boleto-cobranca.read` e `boleto-cobranca.write`.
3. Anote o `client_id` e `client_secret` na hora da criação — vão pro `.env`.
4. Gere o par certificado + chave. O `.key` é mostrado uma vez só: copia e salva. Se perder, tem que rotacionar a aplicação.

## Como subir pra VPS

```bash
# do seu PC, supondo arquivos em ~/Downloads/
scp ~/Downloads/inter.crt ~/Downloads/inter.key root@vps:/tmp/

# na VPS
sudo mkdir -p /opt/travus-bot/secrets/inter
sudo mv /tmp/inter.crt /tmp/inter.key /opt/travus-bot/secrets/inter/
sudo chown -R travus:travus /opt/travus-bot/secrets
sudo chmod 600 /opt/travus-bot/secrets/inter/inter.key
sudo chmod 644 /opt/travus-bot/secrets/inter/inter.crt
```

## Permissões

A chave privada (`inter.key`) **tem que estar com `chmod 600`** (só o owner lê). Se ficar com permissões mais abertas, o Node não vai recusar — mas qualquer outro usuário da VPS consegue ler. Padrão de higiene de segredo.

## Rotação

Se suspeitar que vazou (ex: commitou por engano, copiou pro pastebin, etc):

1. Internet Banking PJ → Aplicações → desativa a aplicação atual.
2. Cria nova com mesmo escopo.
3. Atualiza `.env` com o novo client_id/secret e substitui os arquivos.
4. Restart do bot.
