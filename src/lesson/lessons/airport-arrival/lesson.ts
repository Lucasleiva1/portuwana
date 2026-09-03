import type { Lesson } from "../../lesson.types";
import { airportArrivalDialogue } from "./dialogue";
import { airportArrivalLines, airportRecoveryLineIds } from "./lines";
import { airportArrivalVocabulary } from "./vocabulary";

export const airportArrivalLesson = {
  version: 2,
  id: "airport-arrival-01",
  title: "Chegada ao Brasil",
  locale: "pt-BR",
  level: "A1",
  scene: "airport-arrival",
  defaultMode: "guided-conversation",
  startNodeId: "welcome",
  achievements: [
    "Pedir ajuda",
    "Falar sobre sua bagagem",
    "Perguntar onde fica um lugar",
    "Entender uma direção simples",
  ],
  vocabulary: airportArrivalVocabulary,
  lines: airportArrivalLines,
  recoveryLineIds: airportRecoveryLineIds,
  nodes: airportArrivalDialogue,
} as const satisfies Lesson;
