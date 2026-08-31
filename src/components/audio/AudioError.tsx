interface AudioErrorProps {
  message: string | null;
  onDismiss: () => void;
}

export function AudioError({ message, onDismiss }: AudioErrorProps) {
  if (!message) {
    return null;
  }
  return (
    <div className="audio-error" role="alert">
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Fechar aviso de áudio">
        ×
      </button>
    </div>
  );
}
