import { intentInputSchema, intentResultSchema } from "./intent.schemas";
import type {
  IntentInput,
  IntentProvider,
  IntentResult,
} from "./IntentProvider";

interface IntentSignals {
  patterns: readonly RegExp[];
  keywords: readonly string[];
}

const intentSignals: Readonly<Record<string, IntentSignals>> = {
  greeting: {
    patterns: [/^(oi|ola|bom dia|boa tarde|boa noite)\b/, /\btudo bem\b/],
    keywords: ["oi", "ola", "dia", "tarde", "noite"],
  },
  need_help: {
    patterns: [
      /\b(?<!nao )preciso de ajuda\b/,
      /\bpode (voce )?me ajudar\b/,
      /\b(voce )?consegue me orientar\b/,
      /\bpoderia me dar uma ajuda\b/,
      /\bme ajuda\b/,
      /\bquero ajuda\b/,
    ],
    keywords: ["ajuda", "ajudar", "preciso"],
  },
  no_help: {
    patterns: [
      /\bnao preciso( de ajuda)?\b/,
      /\bestou bem\b/,
      /\bnao,? obrigad[oa]\b/,
    ],
    keywords: ["nao"],
  },
  baggage_problem: {
    patterns: [
      /\b(minha )?bagagem (sumiu|desapareceu|nao chegou|esta perdida)\b/,
      /\bperdi (a )?(minha )?bagagem\b/,
      /\bproblema com (a )?(minha )?bagagem\b/,
      /\bnao encontro (a )?(minha )?bagagem\b/,
      /\b(minha )?mala (nao apareceu|nao chegou|esta perdida)\b/,
    ],
    keywords: ["bagagem", "mala", "perdida", "sumiu", "problema"],
  },
  baggage_not_collected: {
    patterns: [
      /\bainda nao\b/,
      /\bnao,? ainda\b/,
      /\bnao (peguei|retirei|recebi)(?: a| minha)? bagagem\b/,
      /\bestou sem(?: a| minha)? bagagem\b/,
      /\bainda estou esperando(?: a| minha)? (bagagem|mala)\b/,
    ],
    keywords: ["bagagem", "mala", "ainda", "peguei", "retirei"],
  },
  already_have_baggage: {
    patterns: [
      /\bja (peguei|retirei|tenho)(?: a| minha)? bagagem\b/,
      /\b(?<!nao )peguei (?:a|minha) bagagem\b/,
      /\bestou com (?:a|minha) bagagem\b/,
    ],
    keywords: ["bagagem", "mala", "peguei", "tenho", "comigo"],
  },
  confirm_baggage_area: {
    patterns: [
      /\bestou procurando (a )?(retirada de )?bagagem\b/,
      /\bprocuro (a )?(retirada de )?bagagem\b/,
      /\b(sim|isso|exato|correto)\b/,
      /\be isso mesmo\b/,
    ],
    keywords: ["sim", "isso", "bagagem", "retirada", "procuro"],
  },
  deny: {
    patterns: [/\bnao e isso\b/, /\bnao estou procurando\b/, /^nao$/],
    keywords: ["nao", "outra", "diferente"],
  },
  ask_location: {
    patterns: [
      /\bonde fica\b/,
      /\bnao sei onde\b/,
      /\bqual (e )?o caminho\b/,
      /\bpode (me )?mostrar\b/,
      /\bcomo (eu )?chego\b/,
      /\bcomo faco para chegar\b/,
    ],
    keywords: ["onde", "fica", "caminho", "mostrar", "chego"],
  },
  know_location: {
    patterns: [
      /\b(?<!nao )(eu )?sei onde\b/,
      /\bja sei\b/,
      /\bconheco o caminho\b/,
    ],
    keywords: ["sei", "conheco", "caminho"],
  },
  understood: {
    patterns: [
      /\bentendi\b/,
      /\bja entendi\b/,
      /\bcompreendi\b/,
      /\ba direita\b/,
      /\bta bom\b/,
      /\btudo bem\b/,
      /\bbeleza\b/,
      /\bcerto\b/,
    ],
    keywords: ["entendi", "compreendi", "direita", "certo", "beleza"],
  },
  thanks: {
    patterns: [
      /\bmuito obrigad[oa]\b/,
      /\bobrigad[oa]( pela ajuda)?\b/,
      /\bagradeco\b/,
      /\bvaleu\b/,
    ],
    keywords: ["obrigado", "obrigada", "agradeco", "valeu"],
  },
  repeat_request: {
    patterns: [
      /\bpode repetir\b/,
      /\brepita\b/,
      /\bde novo\b/,
      /\bouvir novamente\b/,
      /\bnao ouvi\b/,
    ],
    keywords: ["repetir", "repita", "novamente", "novo", "ouvi"],
  },
  slow_request: {
    patterns: [
      /\bmais devagar\b/,
      /\bfale devagar\b/,
      /\bpode falar (mais )?devagar\b/,
      /\bmais lentamente\b/,
    ],
    keywords: ["devagar", "lentamente", "lento"],
  },
};

const unclearPatterns = [
  /\bnao (entendi|compreendi)\b/,
  /\bnao estou entendendo\b/,
  /\bcomo assim\b/,
  /\bnao sei o que dizer\b/,
];

const sceneVocabulary = new Set([
  "aeroporto",
  "ajuda",
  "ajudar",
  "bagagem",
  "mala",
  "retirada",
  "direita",
  "esquerda",
  "painel",
  "caminho",
  "onde",
  "chegada",
  "brasil",
  "sim",
  "nao",
  "obrigado",
  "obrigada",
  "oi",
  "ola",
]);

export function normalizeIntentText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function result(input: Omit<IntentResult, "alternatives"> & {
  alternatives?: readonly string[];
}): IntentResult {
  return intentResultSchema.parse({
    ...input,
    alternatives: [...(input.alternatives ?? [])],
  });
}

export class LocalIntentProvider implements IntentProvider {
  async analyze(input: IntentInput): Promise<IntentResult> {
    const parsed = intentInputSchema.parse({
      ...input,
      allowedIntents: [...input.allowedIntents],
    });
    const normalized = normalizeIntentText(parsed.text);

    if (unclearPatterns.some((pattern) => pattern.test(normalized))) {
      return result({
        intent: "unclear",
        status: "unclear",
        understood: false,
        confidence: 0.9,
      });
    }

    const matches = parsed.allowedIntents
      .flatMap((intent) => {
        const signals = intentSignals[intent];
        if (!signals) {
          return [];
        }
        const matchIndex = signals.patterns.findIndex((pattern) =>
          pattern.test(normalized),
        );
        return matchIndex >= 0
          ? [{ intent, confidence: Math.max(0.72, 0.96 - matchIndex * 0.05) }]
          : [];
      })
      .sort((left, right) => right.confidence - left.confidence);

    const best = matches[0];
    const second = matches[1];
    if (best && second && second.confidence >= best.confidence - 0.04) {
      return result({
        intent: "ambiguous",
        status: "ambiguous",
        understood: false,
        confidence: best.confidence,
        alternatives: matches.map((match) => match.intent),
      });
    }
    if (best) {
      return result({
        intent: best.intent,
        status: "understood",
        understood: true,
        confidence: best.confidence,
      });
    }

    const words = new Set(normalized.split(" ").filter(Boolean));
    const partialMatches = parsed.allowedIntents
      .map((intent) => ({
        intent,
        score:
          intentSignals[intent]?.keywords.filter((keyword) => words.has(keyword))
            .length ?? 0,
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score);

    const partial = partialMatches[0];
    const competing = partialMatches[1];
    if (partial && competing && competing.score === partial.score) {
      return result({
        intent: "ambiguous",
        status: "ambiguous",
        understood: false,
        confidence: 0.45,
        alternatives: partialMatches
          .filter((candidate) => candidate.score === partial.score)
          .map((candidate) => candidate.intent),
      });
    }
    if (partial) {
      return result({
        intent: partial.intent,
        status: "partial_match",
        understood: false,
        confidence: Math.min(0.65, 0.38 + partial.score * 0.1),
        alternatives: [partial.intent],
      });
    }

    const belongsToScene = [...words].some((word) => sceneVocabulary.has(word));
    if (!belongsToScene && words.size >= 3) {
      return result({
        intent: "off_topic",
        status: "off_topic",
        understood: false,
        confidence: 0.86,
      });
    }

    return result({
      intent: "unclear",
      status: "unclear",
      understood: false,
      confidence: 0.25,
    });
  }
}
