import type { MicrophonePermissionState } from "../../audio/audio.types";

interface MicrophonePermissionProps {
  state: MicrophonePermissionState;
  onRetry: () => void;
}

export function MicrophonePermission({
  state,
  onRetry,
}: MicrophonePermissionProps) {
  if (state !== "denied" && state !== "unavailable" && state !== "error") {
    return null;
  }
  return (
    <div className="microphone-notice" role="status">
      <span>
        Não consegui acessar o microfone. Você pode continuar escrevendo ou
        tentar novamente.
      </span>
      <button type="button" onClick={onRetry}>
        Tentar novamente
      </button>
    </div>
  );
}
