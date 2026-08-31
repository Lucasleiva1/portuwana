import type { VocabularyItem } from "../../lesson.types";

export const airportArrivalVocabulary = [
  { term: "ajuda", meaning: "ayuda" },
  { term: "bagagem", meaning: "equipaje" },
  { term: "direita", meaning: "derecha" },
  { term: "frente", meaning: "frente / hacia adelante" },
  { term: "viagem", meaning: "viaje" },
] as const satisfies readonly VocabularyItem[];
