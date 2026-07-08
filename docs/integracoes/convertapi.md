# ConvertAPI

Conversão `.docx` → PDF do contrato via cloud.

## Por que ConvertAPI

LibreOffice headless na VPS renderizava mal o template (fonte gigante, logo cortado). ConvertAPI usa Word real e devolve PDF fiel ao original. Ver [issue #91](https://github.com/joaofelipe93/travus-agent-ia/issues/91) pra histórico.

## Auth

- **Bearer token** no header `Authorization`.
- Token vem do dashboard em https://www.convertapi.com

## Endpoint usado

```
POST https://v2.convertapi.com/convert/docx/to/pdf
Headers: Authorization: Bearer <token>
Body: multipart/form-data com campo "File" (o .docx)

Response:
{
  "ConversionCost": 1,
  "Files": [
    {
      "FileName": "contrato.pdf",
      "FileSize": 145545,
      "FileData": "<base64>"       // ← decodificar
    }
  ]
}
```

## Free tier

- **1500 segundos/mês** (uma conversão de docx→pdf leva ~3-5s)
- ~400 conversões/mês grátis
- Sobra pro volume da Travus (~10-30 contratos/mês)

## Custo se passar

- Plano Small: US$ 9/mês → 5000 conversões
- Só precisa se Travus fizer 500+ contratos/mês

## Pegadinhas

- **1 conversão = 1 crédito** independente do tamanho do arquivo.
- **FileData é base64**, não binário. Sempre decodificar antes de mandar como PDF.
- **Validar magic `%PDF`** — se retornar HTML de erro por token inválido, evita mandar lixo pro cliente.
- **IPs registrados no log da ConvertAPI**: aparece IP da VPS (produção) e do PC de dev (testes locais).

## Env vars

| Var | Uso |
|---|---|
| `CONVERTAPI_TOKEN` | Bearer |
| `CONTRATO_FORMAT` | `pdf` ativa ConvertAPI. Default `docx` (fallback direto sem conversão) |

## Fallback

Se ConvertAPI cair ou `CONVERTAPI_TOKEN` estiver vazio, o bot **envia `.docx`** e alerta o consultor. Não bloqueia o fluxo.

## Como testar

```bash
node --input-type=module -e "
import { renderContratoPdf } from './src/integrations/contrato-template.js';
import { writeFileSync } from 'node:fs';

const buf = await renderContratoPdf({
  person: { name: 'Teste', cpf: '12345678909', gender: 'Feminino',
    address: { street: 'X', number: '1', district: 'Y', postal_code: '00000000' },
    city: { name: 'Natal', uf: 'RN' } },
  valor: 300, parcelas: 3,
  vencimentos: ['2026-07-01','2026-08-01','2026-09-01']
});
writeFileSync('/tmp/teste.pdf', buf);
console.log('OK:', buf.length, 'bytes');
"
```
