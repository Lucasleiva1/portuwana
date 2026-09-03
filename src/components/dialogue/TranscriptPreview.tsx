import type { SuccessfulTranscriptResult } from "../../schemas";

interface TranscriptPreviewProps {
  transcript: SuccessfulTranscriptResult | null;
  visible: boolean;
  showProcessingTime: boolean;
}

export function TranscriptPreview({
  transcript,
  visible,
  showProcessingTime,
}: TranscriptPreviewProps) {
  if (!visible || !transcript) {
    return null;
  }

  return (
    <aside className="transcript-preview" aria-live="polite">
      <span>Você disse:</span>
      <q>{transcript.text}</q>
      {showProcessingTime && (
        <small>
          Áudio {(transcript.durationMs / 1_000).toFixed(1)}s · {transcript.provider}
          {transcript.backend ? ` ${transcript.backend}` : ""}{" "}
          {(transcript.processingMs / 1_000).toFixed(1)}s · RTF{" "}
          {transcript.realTimeFactor.toFixed(2)}
        </small>
      )}
    </aside>
  );
}
