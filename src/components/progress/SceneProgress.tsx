interface SceneProgressProps {
  title: string;
  current: number;
  total: number;
}

export function SceneProgress({
  title,
  current,
  total,
}: SceneProgressProps) {
  const safeTotal = Math.max(1, total);
  const safeCurrent = Math.min(safeTotal, Math.max(0, current));
  const percentage = (safeCurrent / safeTotal) * 100;

  return (
    <section className="scene-progress" aria-label={`Progresso: ${safeCurrent} de ${safeTotal}`}>
      <div className="scene-progress__eyebrow">CAPÍTULO 01</div>
      <div className="scene-progress__row">
        <strong>{title}</strong>
        <span>
          {safeCurrent} / {safeTotal}
        </span>
      </div>
      <div className="scene-progress__track" aria-hidden="true">
        <span style={{ width: `${percentage}%` }} />
      </div>
    </section>
  );
}
