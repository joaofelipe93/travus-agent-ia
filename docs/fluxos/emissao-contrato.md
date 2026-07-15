# Emissão de contrato + boletos

Fluxo mais denso do bot. Quando o lead chega na stage "Emissão de Contrato" no Piperun (após consultor fechar valor), o bot:

1. Emite N cobranças na Inter
2. Renderiza o contrato em PDF com dados do cliente
3. Envia mensagem + contrato + 1º boleto no WhatsApp
4. Deixa as demais parcelas pro [cron de lembretes](./lembretes-parcelas.md)

## Gatilho

Webhook `POST /webhook/piperun/emissao-contrato` disparado pelo Piperun quando deal entra na stage `654265`.

## Pré-requisitos no CRM (o consultor precisa preencher ANTES de mover a stage)

Sem os dados abaixo o webhook chega, o bot alerta o consultor no WhatsApp e **não emite os boletos**. Nenhum deles pode ficar vazio.

> **Regra de ouro:** preencher **na pessoa do deal**, não no deal em si. O Piperun tem campos duplicados — o bot só olha os da pessoa.

### 1. Valor e parcelas — campo "Observação" da PESSOA

⚠️ Piperun tem 2 campos "Observação": um do **deal** (log automático, o bot ignora) e um da **pessoa** (editável). **O bot lê da pessoa** ([extractObservationFromPerson](../../src/api/piperun-api.js)).

Formato esperado (regex `R\$\s*([\d.,]+)\s*x\s*(\d+)`):

```
Valor do contrato de consultoria:
R$ 300 x 12
```

#### Template pronto pra copiar

**Cobrança normal:**
```
Valor do contrato de consultoria:
R$ {VALOR} x {PARCELAS}
```

Exemplos que funcionam:
```
R$ 300 x 12                    ← R$ 300,00 em 12 parcelas
R$300 x12                      ← sem espaços, tudo bem
R$ 1.500,00 x 6                ← ponto de milhar + vírgula decimal ok
R$1.234,56x24                  ← tudo grudado, tudo bem
R$ 500 X 10                    ← X maiúsculo NÃO funciona (regex é minúsculo)
```

**Cobrança em cortesia** (contrato sem boletos):
```
Sem cobrança
```

Basta essa frase em qualquer lugar da observação. O bot detecta ([parseCortesia](../../src/api/webhook-emissao-contrato.js)), pula a Inter e envia só o contrato com a Cláusula 4ª (pagamento) removida em memória.

#### Erros comuns na observação

| ❌ Errado | Por que | ✅ Corrigido |
|---|---|---|
| `R$300 por 12` | "por" não bate na regex (espera `x`) | `R$300 x 12` |
| `12x de R$300` | Ordem invertida | `R$300 x 12` |
| `R$ 300 X 12` | `X` maiúsculo não bate | `R$ 300 x 12` |
| `R$ 300,00 x 12 meses` | O `12 meses` é OK (regex captura só até o primeiro grupo de dígitos), mas evite ambiguidade | `R$ 300 x 12` |
| Só `300 x 12` (sem R$) | Falta o `R$` obrigatório na regex | `R$ 300 x 12` |
| Escreveu no **deal** e não na **pessoa** | Bot não lê o deal | Copiar pra pessoa |

### 2. Dados do pagador (obrigatórios pela Inter)

Na **pessoa** do deal, todos os campos abaixo precisam estar preenchidos:

| Campo Piperun | Exemplo válido | Nota |
|---|---|---|
| CPF | `123.456.789-09` ou `12345678909` | Bot normaliza (só usa dígitos). CPF precisa ser válido — Inter valida |
| Endereço → Rua | `Avenida Moema Tinoco da Cunha Lima` | Só o nome da rua, sem número |
| Endereço → Número | `883` | Opcional. Se vazio, bot manda só a rua |
| Endereço → CEP | `59133-090` ou `59133090` | 8 dígitos após tirar hífen |
| Endereço → Bairro | `Pajuçara` | |
| Cidade | Selecionar `Natal/RN` no autocomplete | Piperun tem cadastro estruturado — não vale digitar texto livre |
| Telefone (contato principal) | `(84) 99164-6369` | **Precisa existir no WhatsApp** (validado antes de emitir) |
| E-mail (contato principal) | `joao@dominio.com` | Opcional, mas recomendado — aparece no boleto |

#### Exemplo completo de pessoa preenchida corretamente

```
Nome:           João Felipe Rodrigues da Silva
CPF:            123.456.789-09
Sexo:           Masculino
E-mail:         joao@dominio.com
Telefone:       (84) 99164-6369      ← contato marcado como "principal"
Endereço:
  Rua:          Avenida Moema Tinoco da Cunha Lima
  Número:       883
  Bairro:       Pajuçara
  CEP:          59133-090
  Cidade:       Natal/RN             ← autocomplete estruturado
Observação:     Valor do contrato de consultoria:
                R$ 300 x 12
```

### 3. Gênero (opcional, mas melhora o contrato)

Campo Piperun: `Sexo` / `Gênero` da pessoa. Aceita `Masculino` ou `Feminino`.

- `Masculino` → contrato usa **"brasileiro"**, **"inscrito"**, **"assessorá-lo"**, **"informado"**
- `Feminino` OU vazio → usa versão feminina (default)

Se o cliente é homem e o campo ficar vazio, o contrato sai no feminino ("brasileira", "inscrita"). O boleto sai normal.

### Como o bot reage se faltar algo

| Faltando | Bot faz |
|---|---|
| Observação com `R$X xN` ou `Sem cobrança` | Alerta consultor por WhatsApp e para. Boletos NÃO são emitidos |
| CPF, endereço, bairro, CEP, cidade ou UF | Alerta consultor por WhatsApp com lista dos campos faltantes e para |
| Telefone | Alerta consultor por WhatsApp e para |
| Telefone não existe no WhatsApp | Alerta consultor por WhatsApp e para. Cliente pode ter dado número fixo, número antigo ou de outro app |
| Gênero | Assume feminino (default) e continua sem alerta |

Depois de corrigir no CRM, mover o deal **pra fora** da stage "Emissão de Contrato" e depois **de volta** — isso reenvia o webhook. Se preferir, pedir ao suporte técnico pra reprocessar direto no banco.

### Checklist rápido antes de mover pra "Emissão de Contrato"

- [ ] Pessoa tem CPF válido (11 dígitos)
- [ ] Pessoa tem telefone principal marcado, e o número existe no WhatsApp
- [ ] Endereço completo: rua, bairro, CEP, cidade (autocomplete)
- [ ] Observação da **pessoa** (não do deal) tem `R$ X x N` OU `Sem cobrança`
- [ ] Sexo/Gênero preenchido se for homem

## Componentes

- `src/api/webhook-emissao-contrato.js` — orquestrador
- `src/integrations/inter.js` — OAuth mTLS + createCobranca + getBoletoPdf
- `src/integrations/contrato-template.js` — render docx via `docxtemplater` + PDF via ConvertAPI
- `src/assets/contrato-template.docx` — template (gitignored)
- `src/db.js` — `boletos_contrato_parcelas` (idempotência + rastreio)

## Sequência

```
1. POST /webhook/piperun/emissao-contrato
2. Valida stage_id === 654265
3. Idempotência: hasWebhookDispatched OU countContratoParcelas > 0
4. Detecta modo cortesia (parseCortesia no observation)
5. Se não cortesia: parseObservation → { valor, parcelas }
6. Valida pagador: CPF, endereço, bairro, CEP, cidade, UF
7. Valida telefone existe no WhatsApp
8. ensureContact + recordWebhookDispatch

9. Se NÃO cortesia:
   a. Loop emite N cobranças na Inter (500ms entre cada)
      seuNumero = C<dealId>P<NN>
      vencimento: P1 = hoje + 1 dia; PN = mesmo dia do mês, +N-1 meses
   b. recordContratoParcela pra cada (com jid + nome, pra cron achar depois)
   c. Aguarda 2s pra Inter disponibilizar PDF
   d. Baixa APENAS o PDF da parcela 1 (as demais ficam pro cron)

10. Renderiza contrato:
    - renderContrato → docx com placeholders substituídos
    - Se CONTRATO_FORMAT=pdf: convertDocxToPdf via ConvertAPI
    - Fallback: envia .docx se PDF falhar

11. Envia no WhatsApp:
    - Mensagem
    - Contrato (.pdf ou .docx)
    - Se não cortesia: PDF da parcela 1
```

## Regras de vencimento das parcelas

- **Parcela 1**: emissão + `INTER_CONTRATO_VENC_PRIMEIRA_DIAS` (default: 1 dia)
- **Parcelas 2..N**: mesmo dia do mês da P1, avançando N-1 meses
- Edge case: se dia não existir no mês alvo (ex: dia 31 em fevereiro), usa último dia do mês

## Concordância de gênero

Template default é feminino ("brasileira", "inscrita", "assessorá-la", "informada"). Se `person.gender === "Masculino"` no CRM, substituições in-memory:

| Feminino | Masculino |
|---|---|
| brasileira | brasileiro |
| inscrita | inscrito |
| assessorá-la | assessorá-lo |
| informada | informado |

Detalhes em [contrato-template.js](../../src/integrations/contrato-template.js).

## Placeholders do template `.docx`

15 placeholders únicos:

- `{{cliente_nome_maiusculo}}`, `{{cliente_nome}}`, `{{cliente_cpf}}`
- `{{cliente_endereco}}`, `{{cliente_bairro}}`, `{{cliente_cep}}`, `{{cliente_cidade_uf}}`
- `{{valor_total}}`, `{{total_parcelas}}`, `{{valor_parcela}}`
- `{{primeira_parcela_vencimento}}`, `{{segunda_parcela_vencimento}}`, `{{ultima_parcela_vencimento}}`, `{{dia_do_mes_vencimento}}`
- `{{cidade_assinatura}}`, `{{data_assinatura_extenso}}`

## Env vars

| Var | Default | Nota |
|---|---|---|
| `INTER_CONTRATO_STAGE_ID` | `654265` | Stage que dispara |
| `INTER_CONTRATO_MULTA_PCT` | `2` | Multa (%) |
| `INTER_CONTRATO_MORA_PCT` | `1` | Mora ao mês (%) |
| `INTER_CONTRATO_VENC_PRIMEIRA_DIAS` | `1` | Dias até vencimento da P1 |
| `INTER_COBRANCA_DELAY_MS` | `500` | Pacing entre POSTs na Inter |
| `INTER_PDF_DELAY_MS` | `1500` | Pacing entre PDFs no WhatsApp |
| `CONTRATO_MESSAGE_TEMPLATE` | (texto default) | Personaliza msg do webhook |
| `CONTRATO_MESSAGE_TEMPLATE_CORTESIA` | (texto default) | Personaliza msg do modo cortesia |
| `CONTRATO_FORMAT` | `docx` | `pdf` ativa ConvertAPI |
| `CONVERTAPI_TOKEN` | — | Necessário se `CONTRATO_FORMAT=pdf` |
| `CONTRATO_TEMPLATE_PATH` | `src/assets/contrato-template.docx` | Caminho do .docx |
| `CONSULTOR_WHATSAPP` | — | Recebe alertas em caso de erro |

## Como testar

1. No CRM, garante que `person.observation` = `R$ 5 x3` (ou `Sem cobrança`).
2. Move o deal pra fora e volta na stage "Emissão de Contrato".
3. Log esperado:
   ```
   [CONTRATO] deal X → valor lido de person.observation: 3x R$ 5
   [CONTRATO] deal X → parcela 1/3 emitida (codigo=..., vence 2026-06-29)
   ...
   [CONTRATO] deal X → contrato PDF renderizado (cortesia opcional) (N bytes)
   [CONTRATO] deal X (Nome) → contrato + 1ª parcela (de 3) entregues para JID
   ```
4. No WhatsApp: msg + contrato + 1 boleto (não N).
5. Confirma no DB:
   ```sql
   SELECT parcela_n, pdf_sent FROM boletos_contrato_parcelas WHERE deal_id = 'X';
   -- Parcela 1: pdf_sent=1. Parcelas 2..N: pdf_sent=0.
   ```

## O que pode dar errado

| Sintoma | Causa |
|---|---|
| `Formato esperado: R$XXX xNN` no consultor | Regex não casou — consultor esqueceu de preencher `observation` |
| `missing_data` no log | CPF, CEP, endereço, cidade ou UF vazio no CRM — alerta consultor |
| `phone_not_on_whatsapp` | Número no CRM não existe no WhatsApp |
| Emitiu 3 boletos e enviou os 3 (não só o 1º) | Versão antiga — atualize pra depois do PR #101 |
| Fonte gigante ou logo faltando no PDF | `CONTRATO_FORMAT=pdf` sem `CONVERTAPI_TOKEN` — cai pro libreoffice broken. Configura ConvertAPI |
| Vencimento errado (dia 32) | Bug — regra é "mesmo dia do mês da P1"; com edge case de mês curto usa último dia |
