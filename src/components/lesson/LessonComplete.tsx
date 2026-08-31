import type { VocabularyItem } from "../../lesson/lesson.types";

interface LessonCompleteProps {
  title: string;
  power: number;
  achievements: readonly string[];
  vocabulary: readonly VocabularyItem[];
  onRepeat: () => void;
  onClose: () => void;
}

export function LessonComplete({
  title,
  power,
  achievements,
  vocabulary,
  onRepeat,
  onClose,
}: LessonCompleteProps) {
  return (
    <section className="lesson-complete" role="dialog" aria-labelledby="lesson-complete-title">
      <span className="lesson-complete__eyebrow">CONCLUÍDO</span>
      <h1 id="lesson-complete-title">{title}</h1>
      <p>Você completou sua primeira conversa no aeroporto.</p>

      <div className="lesson-complete__power">
        <span>Poder do Português</span>
        <strong>{power}%</strong>
      </div>

      <ul className="lesson-complete__achievements">
        {achievements.map((achievement) => (
          <li key={achievement}>✓ {achievement}</li>
        ))}
      </ul>

      <div className="lesson-complete__vocabulary">
        <span>VOCABULÁRIO DA CENA</span>
        <div>
          {vocabulary.map((item) => (
            <span key={item.term} title={item.meaning}>
              {item.term}
            </span>
          ))}
        </div>
      </div>

      <div className="lesson-complete__actions">
        <button type="button" className="is-primary" onClick={onRepeat}>
          Repetir conversa
        </button>
        <button type="button" onClick={onClose}>
          Fechar
        </button>
      </div>
    </section>
  );
}
