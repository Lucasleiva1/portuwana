import type {
  DictionaryDirection,
  DictionaryLanguage,
  DictionaryResult,
} from "./dictionary.types";
import {
  dictionarySearchKey,
  languageForDirection,
  levenshteinDistance,
  normalizeDictionaryTerm,
} from "./normalize";

export interface StarterLexicalPair {
  es: string;
  pt: string;
  partOfSpeech: string;
  definitionEs?: string;
  definitionPt?: string;
  context?: string;
  locale?: string;
  commonScore?: number;
}

export const starterLexicon: readonly StarterLexicalPair[] = [
  { es: "equipaje", pt: "bagagem", partOfSpeech: "noun", definitionEs: "Conjunto de cosas que se llevan en un viaje.", definitionPt: "Conjunto de malas e objetos levados em uma viagem.", commonScore: 100 },
  { es: "maleta", pt: "mala", partOfSpeech: "noun", definitionEs: "Recipiente usado para transportar ropa u objetos de viaje.", definitionPt: "Recipiente usado para transportar roupas ou objetos de viagem.", commonScore: 98 },
  { es: "valija", pt: "mala", partOfSpeech: "noun", context: "Uso frecuente en el español rioplatense.", commonScore: 96 },
  { es: "hola", pt: "olá", partOfSpeech: "interjection", commonScore: 100 },
  { es: "buen día", pt: "bom dia", partOfSpeech: "expression", commonScore: 100 },
  { es: "buenas tardes", pt: "boa tarde", partOfSpeech: "expression", commonScore: 98 },
  { es: "buenas noches", pt: "boa noite", partOfSpeech: "expression", commonScore: 98 },
  { es: "gracias", pt: "obrigado", partOfSpeech: "interjection", context: "Forma tradicional usada por un hablante masculino.", locale: "pt-BR", commonScore: 100 },
  { es: "gracias", pt: "obrigada", partOfSpeech: "interjection", context: "Forma tradicional usada por una hablante femenina.", locale: "pt-BR", commonScore: 99 },
  { es: "por favor", pt: "por favor", partOfSpeech: "expression", commonScore: 100 },
  { es: "ayuda", pt: "ajuda", partOfSpeech: "noun", commonScore: 98 },
  { es: "hombre", pt: "homem", partOfSpeech: "noun", definitionEs: "Persona adulta de sexo masculino.", definitionPt: "Pessoa adulta do sexo masculino.", commonScore: 100 },
  { es: "mujer", pt: "mulher", partOfSpeech: "noun", definitionEs: "Persona adulta de sexo femenino.", definitionPt: "Pessoa adulta do sexo feminino.", commonScore: 100 },
  { es: "derecha", pt: "direita", partOfSpeech: "noun", commonScore: 96 },
  { es: "izquierda", pt: "esquerda", partOfSpeech: "noun", commonScore: 96 },
  { es: "frente", pt: "frente", partOfSpeech: "noun", commonScore: 94 },
  { es: "viaje", pt: "viagem", partOfSpeech: "noun", commonScore: 98 },
  { es: "aeropuerto", pt: "aeroporto", partOfSpeech: "noun", commonScore: 98 },
  { es: "pasaporte", pt: "passaporte", partOfSpeech: "noun", commonScore: 98 },
  { es: "baño", pt: "banheiro", partOfSpeech: "noun", locale: "pt-BR", commonScore: 98 },
  { es: "boleto", pt: "bilhete", partOfSpeech: "noun", context: "Pasaje o entrada; el uso depende del contexto.", commonScore: 92 },
  { es: "billete", pt: "passagem", partOfSpeech: "noun", context: "Billete de viaje.", commonScore: 92 },
  { es: "cinta de equipaje", pt: "esteira de bagagem", partOfSpeech: "expression", locale: "pt-BR", commonScore: 98 },
  { es: "dónde", pt: "onde", partOfSpeech: "adverb", commonScore: 100 },
  { es: "quiero", pt: "quero", partOfSpeech: "verb", commonScore: 100 },
  { es: "necesito", pt: "preciso", partOfSpeech: "verb", commonScore: 98 },
  { es: "me gustaría", pt: "gostaria", partOfSpeech: "expression", commonScore: 98 },
  { es: "retirar", pt: "retirar", partOfSpeech: "verb", commonScore: 94 },
  { es: "buscar", pt: "procurar", partOfSpeech: "verb", commonScore: 94 },
  { es: "mi", pt: "minha", partOfSpeech: "determiner", context: "Con sustantivo femenino.", commonScore: 95 },
  { es: "mi", pt: "meu", partOfSpeech: "determiner", context: "Con sustantivo masculino.", commonScore: 94 },
  { es: "tu", pt: "sua", partOfSpeech: "determiner", context: "Con sustantivo femenino.", commonScore: 92 },
  { es: "yo", pt: "eu", partOfSpeech: "pronoun", commonScore: 100 },
  { es: "vos", pt: "você", partOfSpeech: "pronoun", locale: "pt-BR", commonScore: 96 },
  { es: "usted", pt: "você", partOfSpeech: "pronoun", locale: "pt-BR", commonScore: 96 },
  { es: "sí", pt: "sim", partOfSpeech: "adverb", commonScore: 100 },
  { es: "no", pt: "não", partOfSpeech: "adverb", commonScore: 100 },
  { es: "con", pt: "com", partOfSpeech: "preposition", commonScore: 100 },
  { es: "sin", pt: "sem", partOfSpeech: "preposition", commonScore: 100 },
  { es: "una", pt: "uma", partOfSpeech: "article", commonScore: 100 },
  { es: "un", pt: "um", partOfSpeech: "article", commonScore: 100 },
  { es: "y", pt: "e", partOfSpeech: "conjunction", commonScore: 100 },
  { es: "pero", pt: "mas", partOfSpeech: "conjunction", commonScore: 98 },
  { es: "¿cómo estás?", pt: "como você está?", partOfSpeech: "expression", locale: "pt-BR", commonScore: 100 },
  { es: "hola, buen día", pt: "olá, bom dia", partOfSpeech: "expression", locale: "pt-BR", commonScore: 100 },
  { es: "quiero retirar mi equipaje", pt: "quero retirar minha bagagem", partOfSpeech: "expression", locale: "pt-BR", commonScore: 100 },
  { es: "¿dónde está mi equipaje?", pt: "onde está minha bagagem?", partOfSpeech: "expression", locale: "pt-BR", commonScore: 100 },
  { es: "¿dónde está la cinta de equipaje?", pt: "onde fica a esteira de bagagem?", partOfSpeech: "expression", locale: "pt-BR", commonScore: 100 },
  { es: "muchas gracias", pt: "muito obrigado", partOfSpeech: "expression", locale: "pt-BR", commonScore: 100 },
  { es: "gracias por la ayuda", pt: "obrigado pela ajuda", partOfSpeech: "expression", locale: "pt-BR", commonScore: 100 },
] as const;

export function searchStarterLexicon(
  query: string,
  direction: Exclude<DictionaryDirection, "auto">,
  limit = 8,
): readonly DictionaryResult[] {
  const language = languageForDirection(direction);
  const sourceKey = direction === "es-pt" ? "es" : "pt";
  const targetKey = direction === "es-pt" ? "pt" : "es";
  const normalized = normalizeDictionaryTerm(query);
  const key = dictionarySearchKey(query);

  const matches = starterLexicon
    .map((pair, index) => {
      const term = pair[sourceKey];
      const termNormalized = normalizeDictionaryTerm(term);
      const termKey = dictionarySearchKey(term);
      const distance = levenshteinDistance(key, termKey);
      let matchScore = 0;
      if (termNormalized === normalized) {
        matchScore = 500;
      } else if (termKey === key) {
        matchScore = 460;
      } else if (termNormalized.startsWith(normalized) || termKey.startsWith(key)) {
        matchScore = 320;
      } else if (distance <= Math.max(1, Math.floor(key.length / 5))) {
        matchScore = 220 - distance * 20;
      }
      return { pair, index, matchScore };
    })
    .filter(({ matchScore }) => matchScore > 0)
    .sort(
      (left, right) =>
        right.matchScore + (right.pair.commonScore ?? 50) -
        (left.matchScore + (left.pair.commonScore ?? 50)),
    )
    .slice(0, limit);

  const grouped = new Map<string, DictionaryResult>();
  for (const { pair, index, matchScore } of matches) {
    const term = pair[sourceKey];
    const target = pair[targetKey];
    const id = `starter-${language}-${normalizeDictionaryTerm(term)}`;
    const current = grouped.get(id);
    const translation = {
      term: target,
      language: (language === "es" ? "pt" : "es") as DictionaryLanguage,
      context: pair.context ?? "",
      locale: pair.locale ?? "",
      sources: ["PORTUWANA esencial"],
      score: pair.commonScore ?? 50,
    };
    if (current) {
      if (!current.translations.some((item) => item.term === target)) {
        grouped.set(id, {
          ...current,
          translations: [...current.translations, translation],
        });
      }
      continue;
    }
    grouped.set(id, {
      id: `${id}-${index}`,
      term,
      language,
      normalized: normalizeDictionaryTerm(term),
      partOfSpeech: pair.partOfSpeech,
      definition:
        language === "es" ? (pair.definitionEs ?? null) : (pair.definitionPt ?? null),
      translations: [translation],
      score: matchScore + (pair.commonScore ?? 50),
    });
  }
  return [...grouped.values()].sort((left, right) => right.score - left.score);
}
