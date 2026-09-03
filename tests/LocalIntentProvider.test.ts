import { describe, expect, it } from "vitest";
import { LocalIntentProvider } from "../src/conversation/LocalIntentProvider";

const provider = new LocalIntentProvider();

async function intentFor(text: string, allowedIntents: readonly string[]) {
  return provider.analyze({ text, locale: "pt-BR", allowedIntents });
}

describe("LocalIntentProvider", () => {
  it.each([
    "Sim, preciso de ajuda.",
    "Pode me ajudar?",
    "Preciso de ajuda.",
    "Você pode me ajudar?",
  ])("maps equivalent help phrases: %s", async (text) => {
    const result = await intentFor(text, ["need_help", "no_help"]);
    expect(result.intent).toBe("need_help");
    expect(result.status).toBe("understood");
    expect(result.understood).toBe(true);
  });

  it.each([
    [
      "Não peguei minha bagagem.",
      ["already_have_baggage", "baggage_not_collected"],
      "baggage_not_collected",
    ],
    [
      "Minha bagagem não chegou.",
      ["baggage_problem", "baggage_not_collected"],
      "baggage_problem",
    ],
    [
      "Estou procurando a bagagem.",
      ["confirm_baggage_area", "deny"],
      "confirm_baggage_area",
    ],
    [
      "Não sei onde fica.",
      ["ask_location", "know_location"],
      "ask_location",
    ],
    ["À direita, entendi.", ["understood"], "understood"],
    ["Muito obrigado.", ["thanks", "understood"], "thanks"],
    ["Pode repetir?", ["repeat_request", "slow_request"], "repeat_request"],
    ["Fale mais devagar.", ["repeat_request", "slow_request"], "slow_request"],
  ] as const)("maps %s to %s", async (text, allowed, expected) => {
    const result = await intentFor(text, allowed);
    expect(result.intent).toBe(expected);
    expect(result.status).toBe("understood");
  });

  it("distinguishes a partial domain answer", async () => {
    const result = await intentFor("Bagagem.", [
      "already_have_baggage",
      "baggage_problem",
    ]);
    expect(result.status).toBe("ambiguous");
    expect(result.alternatives).toEqual([
      "already_have_baggage",
      "baggage_problem",
    ]);
  });

  it("returns partial_match when one intent has an incomplete signal", async () => {
    const result = await intentFor("Preciso...", ["need_help", "no_help"]);
    expect(result.status).toBe("partial_match");
    expect(result.intent).toBe("need_help");
    expect(result.understood).toBe(false);
  });

  it("identifies an explicitly unclear response", async () => {
    const result = await intentFor("Não entendi.", ["understood", "thanks"]);
    expect(result.status).toBe("unclear");
    expect(result.intent).toBe("unclear");
  });

  it("identifies a clearly off-topic response", async () => {
    const result = await intentFor("Quero assistir futebol com meus amigos.", [
      "need_help",
      "no_help",
    ]);
    expect(result.status).toBe("off_topic");
    expect(result.intent).toBe("off_topic");
  });

  it("does not invent a disallowed intent", async () => {
    const result = await intentFor("Obrigado.", ["need_help", "no_help"]);
    expect(result.understood).toBe(false);
    expect(result.status).toBe("unclear");
  });
});
