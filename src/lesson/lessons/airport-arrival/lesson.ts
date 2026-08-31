import type { Lesson } from "../../lesson.types";
import { airportArrivalDialogue } from "./dialogue";
import { airportArrivalVocabulary } from "./vocabulary";

export const airportArrivalLesson = {
  version: 1,
  id: "airport-arrival-01",
  title: "Chegada ao Brasil",
  locale: "pt-BR",
  level: "A1",
  scene: "airport-arrival",
  startNodeId: "welcome",
  achievements: [
    "Pedir ajuda",
    "Falar sobre sua bagagem",
    "Perguntar onde fica um lugar",
    "Entender uma direção simples",
  ],
  vocabulary: airportArrivalVocabulary,
  nodes: airportArrivalDialogue,
} as const satisfies Lesson;
