import type Database from "@tauri-apps/plugin-sql";
import { describe, expect, it, vi } from "vitest";
import {
  dictionarySearchKey,
  guessDictionaryDirection,
  levenshteinDistance,
  normalizeDictionaryTerm,
} from "../src/dictionary/normalize";
import {
  rankAndGroupRows,
  seedStarterLexicon,
} from "../src/dictionary/DictionaryService";
import {
  searchStarterLexicon,
  starterLexicon,
} from "../src/dictionary/starterLexicon";

describe("offline dictionary", () => {
  it("does not rebuild dictionary indexes when the starter source is current", async () => {
    const database = {
      select: vi.fn().mockResolvedValue([
        {
          id: 1,
          status: "imported",
          processedCount: starterLexicon.length,
          acceptedCount: starterLexicon.length,
        },
      ]),
      execute: vi.fn(),
    } as unknown as Database;

    await seedStarterLexicon(database);

    expect(database.execute).not.toHaveBeenCalled();
  });

  it("normalizes Unicode, accents, case and spacing without changing display terms", () => {
    expect(normalizeDictionaryTerm("  OLÁ  ")).toBe("olá");
    expect(dictionarySearchKey("¿Dónde está?")).toBe("donde esta");
  });

  it("searches Portuguese to Spanish and consolidates alternatives", () => {
    expect(searchStarterLexicon("bagagem", "pt-es")[0]?.translations[0]?.term).toBe(
      "equipaje",
    );
    const mala = searchStarterLexicon("mala", "pt-es")[0];
    expect(mala?.translations.map((translation) => translation.term)).toEqual(
      expect.arrayContaining(["maleta", "valija"]),
    );
  });

  it("searches Spanish to Brazilian Portuguese", () => {
    expect(searchStarterLexicon("equipaje", "es-pt")[0]?.translations[0]?.term).toBe(
      "bagagem",
    );
    expect(searchStarterLexicon("hola", "es-pt")[0]?.translations[0]?.term).toBe("olá");
    expect(searchStarterLexicon("valija", "es-pt")[0]?.translations[0]?.term).toBe(
      "mala",
    );
    expect(searchStarterLexicon("hombre", "es-pt")[0]?.translations[0]?.term).toBe(
      "homem",
    );
    expect(searchStarterLexicon("hombre", "es-pt")[0]?.term).toBe("hombre");
  });

  it("ranks accent-insensitive and light typo matches", () => {
    expect(searchStarterLexicon("ola", "pt-es")[0]?.term).toBe("olá");
    expect(searchStarterLexicon("bagagen", "pt-es")[0]?.term).toBe("bagagem");
    expect(levenshteinDistance("bagagen", "bagagem")).toBe(1);
  });

  it("supports exact phrases and automatic direction hints", () => {
    expect(
      searchStarterLexicon("quiero retirar mi equipaje", "es-pt")[0]?.translations[0]?.term,
    ).toBe("quero retirar minha bagagem");
    expect(guessDictionaryDirection("¿Dónde está mi equipaje?")).toBe("es-pt");
    expect(guessDictionaryDirection("Onde está minha bagagem?")).toBe("pt-es");
  });

  it("keeps multiple context-sensitive senses instead of deleting one", () => {
    const result = searchStarterLexicon("gracias", "es-pt")[0];
    expect(result?.translations.map((translation) => translation.term)).toEqual(
      expect.arrayContaining(["obrigado", "obrigada"]),
    );
  });

  it("never lets the nearby word hombro outrank the exact word hombre", () => {
    const rows = [
      {
        entryId: 1,
        term: "hombro",
        language: "es",
        normalized: "hombro",
        searchKey: "hombro",
        partOfSpeech: "noun",
        definition: "Parte del cuerpo.",
        commonScore: 100,
        variantMatch: 0,
        translatedTerm: "ombro",
        translatedLanguage: "pt",
        contextLabel: "",
        locale: "pt-BR",
        sourcePriority: 100,
        sources: "test",
      },
      {
        entryId: 2,
        term: "hombre",
        language: "es",
        normalized: "hombre",
        searchKey: "hombre",
        partOfSpeech: "noun",
        definition: "Persona adulta.",
        commonScore: 1,
        variantMatch: 0,
        translatedTerm: "homem",
        translatedLanguage: "pt",
        contextLabel: "",
        locale: "pt-BR",
        sourcePriority: 1,
        sources: "test",
      },
    ] as Parameters<typeof rankAndGroupRows>[0];

    const results = rankAndGroupRows(rows, "hombre", "hombre");
    expect(results[0]?.term).toBe("hombre");
    expect(results[0]?.translations[0]?.term).toBe("homem");
  });

  it("keeps an exact token above a frequent expression that only shares its prefix", () => {
    const rows = [
      {
        entryId: 3,
        term: "cómo estás",
        language: "es",
        normalized: "cómo estás",
        searchKey: "como estas",
        partOfSpeech: "expression",
        definition: null,
        commonScore: 100,
        variantMatch: 0,
        translatedTerm: "como você está",
        translatedLanguage: "pt",
        contextLabel: "",
        locale: "pt-BR",
        sourcePriority: 100,
        sources: "test",
      },
      {
        entryId: 4,
        term: "como",
        language: "es",
        normalized: "como",
        searchKey: "como",
        partOfSpeech: "adverb",
        definition: null,
        commonScore: 1,
        variantMatch: 0,
        translatedTerm: "como",
        translatedLanguage: "pt",
        contextLabel: "",
        locale: "",
        sourcePriority: 1,
        sources: "test",
      },
    ] as Parameters<typeof rankAndGroupRows>[0];

    expect(rankAndGroupRows(rows, "como", "como")[0]?.term).toBe("como");
  });
});
