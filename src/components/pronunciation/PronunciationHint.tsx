import type { PronunciationFeedback } from "../../speech/pronunciation/pronunciationFeedback";

interface PronunciationHintProps {
  feedback: PronunciationFeedback | null;
  onClose: () => void;
}

export function PronunciationHint({
  feedback,
  onClose,
}: PronunciationHintProps) {
  if (!feedback) {
    return null;
  }

  return (
    <aside
      className="pronunciation-hint"
      aria-label="Feedback de pronúncia"
      data-level={feedback.level}
    >
      <div className="pronunciation-hint__header">
        <div>
          <span>PRONÚNCIA</span>
          <strong>{feedback.message}</strong>
        </div>
        <button type="button" onClick={onClose}>
          Fechar
        </button>
      </div>
      {feedback.recommendation && (
        <p className="pronunciation-hint__recommendation">
          {feedback.recommendation}
        </p>
      )}
    </aside>
  );
}
