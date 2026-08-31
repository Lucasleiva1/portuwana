interface InputLevelProps {
  level: number;
}

export function InputLevel({ level }: InputLevelProps) {
  const activeBars = Math.round(Math.max(0, Math.min(1, level)) * 7);
  return (
    <span className="input-level" aria-label={`Nível de entrada ${activeBars} de 7`}>
      {[0, 1, 2, 3, 4, 5, 6].map((index) => (
        <span
          key={index}
          className={index < activeBars ? "input-level__bar is-active" : "input-level__bar"}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}
