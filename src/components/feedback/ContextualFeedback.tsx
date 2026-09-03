export type FeedbackState =
  | "understood"
  | "partial_match"
  | "ambiguous"
  | "off_topic"
  | "unclear"
  | null;

interface ContextualFeedbackProps {
  state: FeedbackState;
  onRetry: () => void;
  onWrite: () => void;
  onHelp: () => void;
}

export function ContextualFeedback({
  state,
  onRetry,
  onWrite,
  onHelp,
}: ContextualFeedbackProps) {
  if (!state) {
    return null;
  }

  if (state === "understood") {
    return (
      <div className="contextual-feedback contextual-feedback--understood" role="status">
        <span aria-hidden="true">✓</span>
        <strong>Entendi você</strong>
      </div>
    );
  }

  const messages: Readonly<Record<Exclude<FeedbackState, "understood" | null>, string>> = {
    partial_match: "Entendi uma parte da resposta.",
    ambiguous: "Sua resposta pode ter dois sentidos.",
    off_topic: "Vamos voltar ao objetivo desta conversa.",
    unclear: "Não consegui entender bem.",
  };

  return (
    <section className="contextual-feedback contextual-feedback--retry" role="alert">
      <strong>{messages[state]}</strong>
      <div>
        <button type="button" onClick={onRetry}>
          Tentar novamente
        </button>
        <button type="button" onClick={onWrite}>
          Escrever
        </button>
        <button type="button" onClick={onHelp}>
          Preciso de ajuda
        </button>
      </div>
    </section>
  );
}
