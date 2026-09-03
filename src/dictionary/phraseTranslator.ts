import type { DictionaryDirection } from "./dictionary.types";
import { preserveSourceCapitalization } from "./normalize";

export interface PhraseSegment {
  text: string;
  translated: boolean;
}

export interface PhraseTranslationResult {
  translatedText: string;
  unresolvedTerms: readonly string[];
}

export async function translatePhraseWithExactLookup(
  value: string,
  direction: Exclude<DictionaryDirection, "auto">,
  lookup: (word: string) => Promise<string | null>,
): Promise<PhraseTranslationResult> {
  const segments = rewriteContextualPhrases(value, direction);
  const tokensBySegment = segments.map((segment) =>
    segment.translated
      ? [segment.text]
      : (segment.text.match(/[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*|[^\p{L}\p{M}]+/gu) ??
        [segment.text]),
  );
  const words = [
    ...new Set(
      segments.flatMap((segment, index) =>
        segment.translated
          ? []
          : (tokensBySegment[index] ?? []).filter((token) =>
              /[\p{L}\p{M}]/u.test(token),
            ),
      ),
    ),
  ];
  const translations = new Map<string, string>();
  const unresolvedTerms: string[] = [];
  await Promise.all(
    words.map(async (word) => {
      const translated = await lookup(word);
      if (translated) {
        translations.set(word, translated);
      } else {
        unresolvedTerms.push(word);
      }
    }),
  );
  const translatedText = segments
    .map((segment, index) => {
      if (segment.translated) {
        return segment.text;
      }
      return (tokensBySegment[index] ?? [segment.text])
        .map((token) => {
          const translated = translations.get(token);
          return translated
            ? preserveSourceCapitalization(token, translated)
            : token;
        })
        .join("");
    })
    .join("");
  return { translatedText, unresolvedTerms };
}

const spanishTaxi = /\b(?:(cómo|como|dónde|donde|quiero)\s+)?(puedo\s+)?(tomar|tomo|tomas|toma|tomamos|toman)\s+(un|el)\s+taxi\b/giu;
const portugueseTaxi = /\b(?:(como|onde|quero)\s+)?(posso\s+)?(pegar|pego|pega|pegamos|pegam)\s+(um|o)\s+táxi\b/giu;

const spanishVerbToPortuguese: Readonly<Record<string, string>> = {
  tomar: "pegar",
  tomo: "pego",
  tomas: "pega",
  toma: "pega",
  tomamos: "pegamos",
  toman: "pegam",
};

const portugueseVerbToSpanish: Readonly<Record<string, string>> = {
  pegar: "tomar",
  pego: "tomo",
  pega: "toma",
  pegamos: "tomamos",
  pegam: "toman",
};

export function rewriteContextualPhrases(
  value: string,
  direction: Exclude<DictionaryDirection, "auto">,
): readonly PhraseSegment[] {
  return direction === "es-pt"
    ? segmentMatches(value, spanishTaxi, translateSpanishTaxi)
    : segmentMatches(value, portugueseTaxi, translatePortugueseTaxi);
}

function segmentMatches(
  value: string,
  pattern: RegExp,
  translate: (match: RegExpExecArray) => string,
): readonly PhraseSegment[] {
  pattern.lastIndex = 0;
  const segments: PhraseSegment[] = [];
  let cursor = 0;
  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    if (match.index > cursor) {
      segments.push({ text: value.slice(cursor, match.index), translated: false });
    }
    segments.push({ text: translate(match), translated: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) {
    segments.push({ text: value.slice(cursor), translated: false });
  }
  return segments.length > 0 ? segments : [{ text: value, translated: false }];
}

function translateSpanishTaxi(match: RegExpExecArray): string {
  const source = match[0];
  const prefix = match[1]?.toLocaleLowerCase("es") ?? "";
  const can = Boolean(match[2]);
  const verb = match[3]?.toLocaleLowerCase("es") ?? "tomar";
  const article = match[4]?.toLocaleLowerCase("es") === "el" ? "o" : "um";
  let translated: string;
  if (prefix === "quiero") {
    translated = `quero pegar ${article} táxi`;
  } else if (can) {
    const translatedPrefix = prefix.startsWith("d") ? "onde " : prefix ? "como " : "";
    translated = `${translatedPrefix}posso pegar ${article} táxi`;
  } else {
    const translatedPrefix = prefix.startsWith("d")
      ? "onde "
      : prefix
        ? "como "
        : "";
    translated = `${translatedPrefix}${spanishVerbToPortuguese[verb] ?? "pegar"} ${article} táxi`;
  }
  return preserveSourceCapitalization(source, translated);
}

function translatePortugueseTaxi(match: RegExpExecArray): string {
  const source = match[0];
  const prefix = match[1]?.toLocaleLowerCase("pt-BR") ?? "";
  const can = Boolean(match[2]);
  const verb = match[3]?.toLocaleLowerCase("pt-BR") ?? "pegar";
  const article = match[4]?.toLocaleLowerCase("pt-BR") === "o" ? "el" : "un";
  let translated: string;
  if (prefix === "quero") {
    translated = `quiero tomar ${article} taxi`;
  } else if (can) {
    const translatedPrefix = prefix === "onde" ? "dónde " : prefix ? "cómo " : "";
    translated = `${translatedPrefix}puedo tomar ${article} taxi`;
  } else {
    const translatedPrefix = prefix === "onde"
      ? "dónde "
      : prefix
        ? "cómo "
        : "";
    translated = `${translatedPrefix}${portugueseVerbToSpanish[verb] ?? "tomar"} ${article} taxi`;
  }
  return preserveSourceCapitalization(source, translated);
}
