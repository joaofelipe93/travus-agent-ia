import { mock, test, describe } from "node:test";
import assert from "node:assert/strict";

process.env.OPENAI_API_KEY = "test-openai-key";
process.env.OPENAI_MODEL = "gpt-4o-mini-test";

const { askAgent } = await import("../src/agent.js");

function makeClient(createFn) {
  return { chat: { completions: { create: createFn } } };
}

describe("askAgent", () => {
  test("retorna o conteúdo da resposta do agente", async () => {
    const mockCreate = mock.fn(async () => ({
      choices: [{ message: { content: "Olá, sou a Ana!" } }],
    }));

    const resposta = await askAgent([], "Olá!", makeClient(mockCreate));

    assert.equal(resposta, "Olá, sou a Ana!");
    assert.equal(mockCreate.mock.calls.length, 1);

    const [args] = mockCreate.mock.calls[0].arguments;
    assert.equal(args.model, "gpt-4o-mini-test");

    assert.equal(args.messages[0].role, "system", "primeira mensagem deve ser o system prompt");
    assert.ok(args.messages[0].content.length > 100, "system prompt não deve estar vazio");

    const lastMessage = args.messages.at(-1);
    assert.equal(lastMessage.role, "user");
    assert.match(lastMessage.content, /Data e horário em Brasília:/);
    assert.ok(lastMessage.content.endsWith("Olá!"), "mensagem do usuário deve ser preservada no final");
  });

  test("inclui histórico de conversa nas mensagens enviadas ao agente", async () => {
    const mockCreate = mock.fn(async () => ({
      choices: [{ message: { content: "Tudo bem!" } }],
    }));

    const history = [
      { role: "user", content: "oi" },
      { role: "assistant", content: "Oi! Como posso ajudar?" },
    ];

    await askAgent(history, "Tudo bem?", makeClient(mockCreate));

    const [args] = mockCreate.mock.calls[0].arguments;
    const msgs = args.messages;

    assert.ok(msgs.at(-1).content.endsWith("Tudo bem?"), "última mensagem deve terminar com o texto do usuário");
    assert.ok(msgs.some((m) => m.content === "oi"), "histórico deve estar presente");
  });

  test("retorna string vazia quando não há choices na resposta", async () => {
    const client = makeClient(async () => ({ choices: [] }));
    const resposta = await askAgent([], "qualquer coisa", client);
    assert.equal(resposta, "");
  });

  test("propaga erro quando a API falha", async () => {
    const client = makeClient(async () => {
      throw new Error("Timeout");
    });
    await assert.rejects(() => askAgent([], "mensagem", client), {
      message: "Timeout",
    });
  });
});
