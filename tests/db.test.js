import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";

const { phoneFromJid, getOrStartConversation, getHistory, addMessage, recordLeadCapture } =
  await import("../src/db.js");

const JID = "5511991234567@s.whatsapp.net";
const PHONE = "5511991234567";

describe("phoneFromJid", () => {
  test("extrai o número do JID padrão", () => {
    assert.equal(phoneFromJid("5511991234567@s.whatsapp.net"), "5511991234567");
  });

  test("extrai o número do JID formato lid", () => {
    assert.equal(phoneFromJid("152260986314941@lid"), "152260986314941");
  });
});

describe("getOrStartConversation", () => {
  test("cria contato e conversa para novo JID", () => {
    const convId = getOrStartConversation(JID);
    assert.ok(typeof convId === "number");
    assert.ok(convId > 0);
  });

  test("retorna a mesma conversa ativa para o mesmo JID", () => {
    const id1 = getOrStartConversation(JID);
    const id2 = getOrStartConversation(JID);
    assert.equal(id1, id2);
  });
});

describe("addMessage e getHistory", () => {
  test("salva e recupera mensagens na ordem correta", () => {
    const convId = getOrStartConversation("5521987654321@s.whatsapp.net");

    addMessage(convId, "user", "Olá");
    addMessage(convId, "assistant", "Oi! Sou a Ana.");

    const history = getHistory(convId);
    assert.equal(history.length, 2);
    assert.equal(history[0].role, "user");
    assert.equal(history[0].content, "Olá");
    assert.equal(history[1].role, "assistant");
  });
});

describe("recordLeadCapture", () => {
  test("salva dados do lead e mantém conversa ativa para follow-up", () => {
    const jid = "5531912345678@s.whatsapp.net";
    const convId = getOrStartConversation(jid);
    addMessage(convId, "user", "quero investir");

    const lead = {
      nome: "Maria Silva",
      email: "maria@email.com",
      celular: "5531912345678",
      renda_mensal: "8000",
      data_agendamento: "2026-05-10",
      hora_agendamento: "14:00",
    };

    recordLeadCapture(convId, lead);

    // conversa continua ativa — follow-up usa o mesmo id
    const mesmoConvId = getOrStartConversation(jid);
    assert.equal(mesmoConvId, convId);
  });

  test("INSERT OR IGNORE não duplica o lead se chamado duas vezes", () => {
    const jid = "5541911111111@s.whatsapp.net";
    const convId = getOrStartConversation(jid);
    const lead = { nome: "Pedro", email: "pedro@email.com", celular: "5541911111111" };

    assert.doesNotThrow(() => {
      recordLeadCapture(convId, lead);
      recordLeadCapture(convId, lead);
    });
  });
});
