import { intentInputSchema, intentResultSchema } from "./intent.schemas";
import type { IntentInput, IntentProvider, IntentResult } from "./IntentProvider";

const intentPatterns: Readonly<Record<string, readonly RegExp[]>> = {
  need_help: [
    /\bpreciso de ajuda\b/,
    /\bpode (voce )?me ajudar\b/,
    /\bme ajuda\b/,
    /\bquero ajuda\b/,
  ],
  no_help: [
    /\bnao preciso( de ajuda)?\b/,
    /\bestou bem\b/,
    /\bnao,? obrigado\b/,
  ],
  ask_repeat: [
    /\bpode repetir\b/,
    /\brepita\b/,
    /\bde novo\b/,
    /\bouvir novamente\b/,
  ],
  already_have_baggage: [
    /\bja (peguei|retirei|tenho)( a|minha)? bagagem\b/,
    /\bpeguei (a|minha) bagagem\b/,
    /\bestou com (a|minha) bagagem\b/,
  ],
  not_yet: [
    /\bainda nao\b/,
    /\bnao,? ainda\b/,
    /\bnao (peguei|retirei).*ainda\b/,
    /\bnao (peguei|retirei)( a|minha)? bagagem\b/,
  ],
  confirm_baggage_area: [
    /\bestou procurando (a )?(retirada de )?bagagem\b/,
    /\bprocuro (a )?(retirada de )?bagagem\b/,
    /\bsim\b/,
    /\bisso\b/,
  ],
  deny: [/^nao$/, /\bnao e\b/, /\bnao estou\b/],
  ask_location: [
    /\bonde fica\b/,
    /\bnao sei onde\b/,
    /\bqual (e )?o caminho\b/,
    /\bpode (me )?mostrar\b/,
  ],
  know_location: [/\b(eu )?sei onde\b/, /\bja sei\b/],
  understood_direction: [
    /\bentendi\b/,
    /\bcompreendi\b/,
    /\ba direita\b/,
    /\bcerto\b/,
  ],
  thanks: [
    /\bmuito obrigad[oa]\b/,
    /\bobrigad[oa]( pela ajuda)?\b/,
    /\bagradeco\b/,
  ],
  acknowledge: [/\bta bom\b/, /\btudo bem\b/, /\bbeleza\b/, /\bentendi\b/, /\bcerto\b/],
  dont_understand: [
    /\bnao (entendi|compreendi)\b/,
    /\bnao estou entendendo\b/,
    /\bnao sei\b/,
    /\bcomo assim\b/,
  ],
};

export function normalizeIntentText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class LocalIntentProvider implements IntentProvider {
  async analyze(input: IntentInput): Promise<IntentResult> {
    const parsed = intentInputSchema.parse({
      ...input,
      allowedIntents: [...input.allowedIntents],
    });
    const normalized = normalizeIntentText(parsed.text);

    for (const intent of parsed.allowedIntents) {
      const patterns = intentPatterns[intent] ?? [];
      const matchIndex = patterns.findIndex((pattern) => pattern.test(normalized));
      if (matchIndex >= 0) {
        return intentResultSchema.parse({
          intent,
          understood: true,
          confidence: Math.max(0.72, 0.92 - matchIndex * 0.04),
        });
      }
    }

    return intentResultSchema.parse({
      intent: "unknown",
      understood: false,
      confidence: 0,
    });
  }
}
