import { CloseIcon } from "../icons";
import type { HelpLevel } from "../../lesson/lesson.types";

export type HelpAction =
  | "replay"
  | "slower"
  | "translation"
  | "hint"
  | "example";

interface HelpPopoverProps {
  open: boolean;
  availableLevel: HelpLevel;
  onClose: () => void;
  onAction: (action: HelpAction) => void;
}

const options: readonly {
  action: HelpAction;
  label: string;
  detail: string;
  level: HelpLevel;
}[] = [
  { action: "replay", label: "Ouvir novamente", detail: "Repetir a frase", level: 1 },
  { action: "slower", label: "Mais devagar", detail: "Texto segmentado", level: 1 },
  { action: "hint", label: "Ver uma pista", detail: "Palavras úteis", level: 2 },
  { action: "translation", label: "Ver tradução", detail: "Mostrar espanhol", level: 3 },
  { action: "example", label: "Ver exemplo", detail: "Resposta possível", level: 4 },
];

export function HelpPopover({
  open,
  availableLevel,
  onClose,
  onAction,
}: HelpPopoverProps) {
  if (!open) {
    return null;
  }

  return (
    <aside
      className="help-popover"
      id="help-popover"
      role="dialog"
      aria-label="Ajuda para a conversa"
    >
      <div className="help-popover__header">
        <div>
          <span className="help-popover__eyebrow">AJUDA CONTEXTUAL</span>
          <h2>Como posso ajudar?</h2>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={onClose}
          aria-label="Fechar ajuda"
        >
          <CloseIcon />
        </button>
      </div>
      <div className="help-popover__options">
        {options.filter((option) => option.level <= availableLevel).map((option) => (
          <button
            type="button"
            key={option.action}
            onClick={() => onAction(option.action)}
          >
            <span>{option.label}</span>
            <small>{option.detail}</small>
          </button>
        ))}
      </div>
      <p className="help-popover__progress">
        Ajuda progressiva · nível {availableLevel} de 4
      </p>
    </aside>
  );
}
