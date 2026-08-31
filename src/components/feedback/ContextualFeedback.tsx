export type FeedbackState = "understood" | "not-understood" | null;

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

  return (
    <section className="contextual-feedback contextual-feedback--retry" role="alert">
      <strong>Não consegui entender bem.</strong>
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
