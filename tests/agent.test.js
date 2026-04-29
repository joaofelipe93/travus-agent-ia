import { mock, test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.AGENTENDPOINT = "https://test.agents.do-ai.run";
process.env.SECRETKEYAGENT = "test-secret-key";

const { askAgent } = await import("../src/agent.js");

function makeClient(createFn) {
  return { chat: { completions: { create: createFn } } };
}

describe("askAgent", () => {
  test("retorna o conteúdo da resposta do agente", async () => {
    const mockCreate = mock.fn(async () => ({
      choices: [{ message: { content: "Olá, sou o agente!" } }],
    }));

    const resposta = await askAgent("Olá!", makeClient(mockCreate));

    assert.equal(resposta, "Olá, sou o agente!");
    assert.equal(mockCreate.mock.calls.length, 1);

    const [args] = mockCreate.mock.calls[0].arguments;
    assert.equal(args.model, "n/a");
    assert.deepEqual(args.messages, [{ role: "user", content: "Olá!" }]);
  });

  test("retorna string vazia quando não há choices na resposta", async () => {
    const client = makeClient(async () => ({ choices: [] }));
    const resposta = await askAgent("qualquer coisa", client);
    assert.equal(resposta, "");
  });

  test("propaga erro quando a API falha", async () => {
    const client = makeClient(async () => {
      throw new Error("Timeout");
    });
    await assert.rejects(() => askAgent("mensagem", client), {
      message: "Timeout",
    });
  });
});
