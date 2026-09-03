import type { DictionaryDirection, DictionaryLanguage } from "./dictionary.types";

export function normalizeDictionaryTerm(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("es").trim().replace(/\s+/g, " ");
}

export function dictionarySearchKey(value: string): string {
  return normalizeDictionaryTerm(value)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function languageForDirection(
  direction: Exclude<DictionaryDirection, "auto">,
): DictionaryLanguage {
  return direction === "es-pt" ? "es" : "pt";
}

export function targetLanguageForDirection(
  direction: Exclude<DictionaryDirection, "auto">,
): DictionaryLanguage {
  return direction === "es-pt" ? "pt" : "es";
}

export function oppositeDirection(
  language: DictionaryLanguage,
): Exclude<DictionaryDirection, "auto"> {
  return language === "es" ? "es-pt" : "pt-es";
}

export function guessDictionaryDirection(
  value: string,
): Exclude<DictionaryDirection, "auto"> {
  const normalized = normalizeDictionaryTerm(value);
  if (/[¿¡ñ]/iu.test(value) || /\b(el|la|los|las|una|quiero|dónde|gracias)\b/u.test(normalized)) {
    return "es-pt";
  }
  if (/[ãõç]/iu.test(value) || /\b(o|os|uma|quero|onde|obrigad[oa]|você)\b/u.test(normalized)) {
    return "pt-es";
  }
  return "es-pt";
}

export function levenshteinDistance(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  if (left.length === 0) {
    return right.length;
  }
  if (right.length === 0) {
    return left.length;
  }

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + substitutionCost,
      );
    }
    previous = current;
  }
  return previous[right.length] ?? Math.max(left.length, right.length);
}

export function preserveSourceCapitalization(source: string, target: string): string {
  if (source.length === 0 || target.length === 0) {
    return target;
  }
  if (source === source.toLocaleUpperCase("es")) {
    return target.toLocaleUpperCase("pt-BR");
  }
  const first = source[0];
  if (first && first === first.toLocaleUpperCase("es")) {
    return `${target[0]?.toLocaleUpperCase("pt-BR") ?? ""}${target.slice(1)}`;
  }
  return target;
}
