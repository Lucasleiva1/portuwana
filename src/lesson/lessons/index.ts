import type { Lesson } from "../lesson.types";
import { airportArrivalLesson } from "./airport-arrival/lesson";

export { airportArrivalLesson } from "./airport-arrival/lesson";

export const lessonCatalog = {
  [airportArrivalLesson.id]: airportArrivalLesson,
} as const satisfies Readonly<Record<string, Lesson>>;
