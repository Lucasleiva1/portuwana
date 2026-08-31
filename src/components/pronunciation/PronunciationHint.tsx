interface PronunciationWord {
  word: string;
  assessment: "ótimo" | "praticar" | "quase";
}

interface PronunciationHintProps {
  open: boolean;
  onClose: () => void;
}

const words: readonly PronunciationWord[] = [
  { word: "Onde", assessment: "ótimo" },
  { word: "fica", assessment: "ótimo" },
  { word: "retirada", assessment: "praticar" },
  { word: "de", assessment: "ótimo" },
  { word: "bagagem", assessment: "quase" },
];

export function PronunciationHint({
  open,
  onClose,
}: PronunciationHintProps) {
  if (!open) {
    return null;
  }

  return (
    <aside className="pronunciation-hint" aria-label="Pronúncia simulada">
      <div className="pronunciation-hint__header">
        <div>
          <span>FEEDBACK MOCK</span>
          <strong>Ver pronúncia</strong>
        </div>
        <button type="button" onClick={onClose}>
          Fechar
        </button>
      </div>
      <div className="pronunciation-hint__words">
        {words.map((item) => (
          <span key={item.word} data-assessment={item.assessment}>
            <strong>{item.word}</strong>
            <small>{item.assessment}</small>
          </span>
        ))}
      </div>
    </aside>
  );
}
