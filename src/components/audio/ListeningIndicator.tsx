import { InputLevel } from "./InputLevel";

interface ListeningIndicatorProps {
  state:
    | "requesting"
    | "listening"
    | "recording"
    | "processing"
    | "transcribing";
  level: number;
  onCancel: () => void;
}

const labels = {
  requesting: "Preparando o microfone…",
  listening: "Escutando…",
  recording: "Falando…",
  processing: "Processando o áudio…",
  transcribing: "Entendendo…",
} as const;

export function ListeningIndicator({
  state,
  level,
  onCancel,
}: ListeningIndicatorProps) {
  return (
    <div className="listening-indicator" role="status">
      <span>{labels[state]}</span>
      {(state === "listening" || state === "recording") && (
        <InputLevel level={level} />
      )}
      {state !== "processing" && (
        <button type="button" onClick={onCancel}>
          Cancelar
        </button>
      )}
    </div>
  );
}
