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
    expect(result.understood).toBe(true);
  });

  it.each([
    ["Não peguei ainda.", ["already_have_baggage", "not_yet"], "not_yet"],
    ["Estou procurando a bagagem.", ["confirm_baggage_area", "deny"], "confirm_baggage_area"],
    ["Não sei onde fica.", ["ask_location", "know_location", "dont_understand"], "ask_location"],
    ["À direita, entendi.", ["understood_direction", "ask_repeat"], "understood_direction"],
    ["Muito obrigado.", ["thanks", "acknowledge"], "thanks"],
  ] as const)("maps %s to %s", async (text, allowed, expected) => {
    expect((await intentFor(text, allowed)).intent).toBe(expected);
  });

  it("returns unknown without inventing an intent", async () => {
    const result = await intentFor("banana aeroporto", ["need_help", "no_help"]);
    expect(result).toEqual({ intent: "unknown", understood: false, confidence: 0 });
  });

  it("only resolves intents allowed by the current node", async () => {
    const result = await intentFor("Obrigado.", ["need_help", "no_help"]);
    expect(result.understood).toBe(false);
  });
});
