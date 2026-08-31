import type { CSSProperties } from "react";
import { ReplayIcon } from "../icons";

interface DialoguePanelProps {
  speaker: string;
  line: string;
  translation?: string | undefined;
  showTranslation: boolean;
  onReplay: () => void;
}

export function DialoguePanel({
  speaker,
  line,
  translation,
  showTranslation,
  onReplay,
}: DialoguePanelProps) {
  return (
    <section className="dialogue-panel" aria-live="polite">
      <div className="dialogue-panel__speaker-row">
        <span className="dialogue-panel__speaker">{speaker}</span>
        <button
          className="dialogue-panel__replay"
          type="button"
          onClick={onReplay}
          aria-label="Ouvir novamente"
        >
          <ReplayIcon />
          <span>Ouvir novamente</span>
        </button>
      </div>
      <p className="dialogue-panel__line">{line}</p>
      <div className="dialogue-panel__waveform" aria-hidden="true">
        {Array.from({ length: 17 }, (_, index) => (
          <span
            key={index}
            style={{ height: `${3 + (index % 5) * 2}px` } as CSSProperties}
          />
        ))}
      </div>
      {showTranslation && translation && (
        <p className="dialogue-panel__translation">
          <span>Tradução</span>
          {translation}
        </p>
      )}
    </section>
  );
}
