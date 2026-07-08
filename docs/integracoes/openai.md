# OpenAI (chat + Whisper)

Duas usos do SDK oficial `openai`:

1. **Chat completion** com `gpt-4o-mini` — o "cérebro" da Ana (`src/agent.js`)
2. **Whisper** — transcrição de áudio recebido no WhatsApp (`src/integrations/whisper.js`)

## Chat completion

- Modelo: `gpt-4o-mini` (configurável via `OPENAI_MODEL`)
- System prompt: `prompts/ana.md` (versionado no repo, carregado uma vez no boot)
- Histórico: bot envia N mensagens anteriores da conversa a cada turno (memória curta natural)

### Fluxo

```
1. handler recebe user msg
2. getHistory(convId) → array [{role, content}]
3. injeta contexto no user msg: [Data e horário Brasília], [Número do WhatsApp], [Contexto LP se aplicável]
4. askAgent(history, novoInput) →
   openai.chat.completions.create({
     model: "gpt-4o-mini",
     messages: [{ role: "system", content: prompts/ana.md }, ...history, { role: "user", content: input }]
   })
5. Retorna resposta.choices[0].message.content
```

## Whisper

- Modelo: `whisper-1`
- Language hint: `pt` (melhora acurácia em português)
- Aceita áudios OGG/OPUS do WhatsApp direto

### Fluxo

```
1. Baileys detecta audioMessage
2. downloadMediaMessage → Buffer
3. transcribeAudio(buffer):
   openai.audio.transcriptions.create({
     file: toFile(buffer, "audio.ogg"),
     model: "whisper-1",
     language: "pt"
   })
4. Retorna result.text
5. handler trata como se fosse texto normal
```

### Custo

- ~$0.006/min
- Áudios típicos WhatsApp têm 30s → $0.003/áudio
- 1000 áudios/mês ≈ $3

## Pegadinhas

- **Whisper transcreve números por extenso** ("oito quatro nove um") — se lead falar o celular em áudio, `extractCelularFromHistory` não pega. Fluxo natural: Ana repergunta.
- **Prompt da Ana é longo** (~330 linhas). Ajustes vão pra `prompts/ana.md` e exigem deploy.
- **Sem streaming** — bot espera a resposta completa antes de mandar no WhatsApp. Se prompt ficar mais complexo e latência subir, avaliar streaming.

## Env vars

| Var | Uso |
|---|---|
| `OPENAI_API_KEY` | Chave (mesma pra chat e Whisper) |
| `OPENAI_MODEL` | Default `gpt-4o-mini`. Não usar `gpt-4o` cheio (custo 5x, ROI baixo aqui) |
