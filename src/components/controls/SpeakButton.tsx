import { MicrophoneIcon } from "../icons";

export type SpeakVisualState = "idle" | "listening" | "recording" | "processing";

export interface SpeakButtonPresentation {
  state: SpeakVisualState;
  label: string;
  disabled: boolean;
}

export function deriveSpeakButtonPresentation(
  machineState: string,
): SpeakButtonPresentation {
  if (machineState === "requestingMicrophone" || machineState === "listening") {
    return { state: "listening", label: "Escutando…", disabled: true };
  }
  if (machineState === "recording") {
    return { state: "recording", label: "Falando…", disabled: true };
  }
  if (
    machineState === "processingAudio" ||
    machineState === "audioReady" ||
    machineState === "processingResponse" ||
    machineState === "analyzingIntent" ||
    machineState === "showingFeedback" ||
    machineState === "transitioningNode"
  ) {
    return { state: "processing", label: "Processando…", disabled: true };
  }
  if (machineState === "transcribing") {
    return { state: "processing", label: "Entendendo…", disabled: true };
  }
  return {
    state: "idle",
    label: "Falar",
    disabled: machineState !== "waitingForUser",
  };
}

interface SpeakButtonProps {
  presentation: SpeakButtonPresentation;
  onClick: () => void;
}

export function SpeakButton({ presentation, onClick }: SpeakButtonProps) {
  return (
    <button
      className={`conversation-button conversation-button--speak conversation-button--${presentation.state}`}
      type="button"
      disabled={presentation.disabled}
      onClick={onClick}
      aria-label={presentation.label}
    >
      <MicrophoneIcon />
      <span>{presentation.label}</span>
      {presentation.state !== "idle" && (
        <span className="conversation-button__activity" aria-hidden="true" />
      )}
    </button>
  );
}
