import { describe, expect, it } from "vitest";
import {
  rewriteContextualPhrases,
  translatePhraseWithExactLookup,
} from "../src/dictionary/phraseTranslator";

describe("contextual phrase translation", () => {
  it("translates taking a taxi without turning como into como você está", () => {
    expect(rewriteContextualPhrases("como tomo un taxi, gracias", "es-pt")).toEqual([
      { text: "como pego um táxi", translated: true },
      { text: ", gracias", translated: false },
    ]);
  });

  it("handles common travel variants in both directions", () => {
    expect(
      rewriteContextualPhrases("¿Dónde puedo tomar un taxi?", "es-pt")
        .map((segment) => segment.text)
        .join(""),
    ).toBe("¿Onde posso pegar um táxi?");
    expect(
      rewriteContextualPhrases("como pego um táxi?", "pt-es")
        .map((segment) => segment.text)
        .join(""),
    ).toBe("cómo tomo un taxi?");
  });

  it("reproduces the reported phrase with only exact residual word lookups", async () => {
    const translations = new Map([["gracias", "obrigado"]]);
    await expect(
      translatePhraseWithExactLookup(
        "como tomo un taxi, gracias",
        "es-pt",
        async (word) => translations.get(word) ?? null,
      ),
    ).resolves.toEqual({
      translatedText: "como pego um táxi, obrigado",
      unresolvedTerms: [],
    });
  });
});
