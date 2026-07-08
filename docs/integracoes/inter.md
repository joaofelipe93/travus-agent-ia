# Banco Inter — API Cobrança

Emissão e consulta de boletos via API v3 do Banco Inter. Usada pelo [fluxo de emissão de contrato](../fluxos/emissao-contrato.md), [lembretes de parcela](../fluxos/lembretes-parcelas.md) e [baixa de pagamento](../fluxos/baixa-pagamento.md).

## Auth

**OAuth2 client_credentials + mTLS**. Sem cert cliente, a Inter derruba o handshake TLS antes mesmo do OAuth.

### Setup

1. No Internet Banking PJ → Aplicações → Cobrança, gera `client_id`, `client_secret` e o par certificado + chave privada.
2. Sobe cert e key pra VPS em `/opt/travus-bot/secrets/inter/` com `chmod 600 inter.key`.
3. `.env` aponta pros arquivos.

### Fluxo

```
1. POST /oauth/v2/token com client_id, client_secret, grant_type=client_credentials
   + scope="boleto-cobranca.read boleto-cobranca.write"
   + mTLS (undici Agent com cert+key)
2. Recebe access_token + expires_in (~1h)
3. Token cacheado em memória até expires_in - 30s
4. Requests subsequentes: header Authorization: Bearer <token> + mTLS
```

## Endpoints usados

| Endpoint | Uso |
|---|---|
| `POST /oauth/v2/token` | Obter token |
| `POST /cobranca/v3/cobrancas` | Criar cobrança |
| `GET /cobranca/v3/cobrancas/{codigoSolicitacao}` | Consultar status |
| `GET /cobranca/v3/cobrancas/{codigoSolicitacao}/pdf` | Baixar PDF |

## Payload de criação

```json
{
  "seuNumero": "C60996889P01",           // máx 15 chars, usado como reference
  "valorNominal": 300,                    // mínimo R$ 2,50
  "dataVencimento": "2026-06-28",
  "numDiasAgenda": 60,                    // dias após vencimento pra aceitar pagamento com multa
  "pagador": {
    "cpfCnpj": "12345678909",             // só dígitos
    "tipoPessoa": "FISICA",
    "nome": "João Felipe...",
    "email": "joao@...",
    "ddd": "84",
    "telefone": "991646369",
    "endereco": "Rua X, nº 123",
    "bairro": "Centro",
    "cidade": "Natal",
    "uf": "RN",
    "cep": "59133090"
  },
  "multa": { "taxa": 2, "codigo": "PERCENTUAL" },
  "mora": { "taxa": 1, "codigo": "TAXAMENSAL" }
}
```

## Resposta de status (`getCobranca`)

```json
{
  "cobranca": {
    "codigoSolicitacao": "...",
    "seuNumero": "C60996889P01",
    "situacao": "A_RECEBER",     // ← campo importante pro cron de atrasos
    ...
  },
  "boleto": { "codigoBarras": "...", "linhaDigitavel": "..." },
  "pix": { "txid": "...", "pixCopiaECola": "..." }
}
```

Situações possíveis: `A_RECEBER`, `RECEBIDO`, `MARCADO_RECEBIDO`, `EXPIRADO`, `CANCELADO`, `FALHA_EMISSAO`.

## Pegadinhas

- **`numDiasAgenda` obrigatório se há multa/mora**. Se `numDiasAgenda: 0` + multa/mora → HTTP 400.
- **`seuNumero` limitado a 15 chars**. Nosso formato: `C<dealId>P<NN>` (ex: `C60996889P01`).
- **`valorNominal` mínimo R$ 2,50** — testes menores dão HTTP 400.
- **PDF vem como JSON com campo `pdf` em base64**, não como PDF cru. Decodificar `Buffer.from(json.pdf, "base64")`.
- **Sandbox e prod têm CAs diferentes** — cert de prod não vale em sandbox.
- **Aceita CPF inválido em prod** (`12345678909`, `00000000000`) — reportado ao Inter.

## Env vars

| Var | Uso |
|---|---|
| `INTER_CLIENT_ID` | OAuth |
| `INTER_CLIENT_SECRET` | OAuth |
| `INTER_CERT_FILE` | Path do `.crt` mTLS |
| `INTER_KEY_FILE` | Path do `.key` mTLS |
| `INTER_CONTA_CORRENTE` | Só se app Inter tem múltiplas contas vinculadas |
| `INTER_BASE_URL` | Default: sandbox. Setar pra prod: `https://cdpj.partners.bancointer.com.br` |

## Teste manual

```bash
sudo -u travus pm2 stop travus-bot
sudo -u travus -E npm run inter:test --prefix /opt/travus-bot
sudo -u travus pm2 start travus-bot
```

Emite boleto de R$ 2,50 com CPF fake e salva PDF em `/tmp/inter-boleto-*.pdf`.

**⚠️ Em produção, gera boleto real que precisa ser cancelado pelo painel.**
