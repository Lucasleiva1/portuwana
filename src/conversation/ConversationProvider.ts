import type { ConversationMode, LessonLocale } from "../lesson/lesson.types";
import { LocalIntentProvider } from "./LocalIntentProvider";
import type { IntentProvider, IntentResult } from "./IntentProvider";

export interface ConversationInput {
  text: string;
  locale: LessonLocale;
  nodeId: string;
  mode: ConversationMode;
  allowedIntents: readonly string[];
  attempt: number;
}

export interface ConversationProvider {
  readonly id: string;
  readonly kind: "local-guided" | "external" | "ai";
  interpret(input: ConversationInput): Promise<IntentResult>;
}

const controlIntents = ["repeat_request", "slow_request"] as const;

export class LocalGuidedConversationProvider implements ConversationProvider {
  readonly id = "local-guided-v1";
  readonly kind = "local-guided" as const;
  readonly #intentProvider: IntentProvider;

  constructor(intentProvider: IntentProvider = new LocalIntentProvider()) {
    this.#intentProvider = intentProvider;
  }

  interpret(input: ConversationInput): Promise<IntentResult> {
    return this.#intentProvider.analyze({
      text: input.text,
      locale: input.locale,
      allowedIntents: [
        ...new Set([...input.allowedIntents, ...controlIntents]),
      ],
    });
  }
}
