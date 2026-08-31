import { KeyboardIcon } from "../icons";

interface WriteButtonProps {
  disabled: boolean;
  expanded: boolean;
  onClick: () => void;
}

export function WriteButton({
  disabled,
  expanded,
  onClick,
}: WriteButtonProps) {
  return (
    <button
      className="conversation-button conversation-button--write"
      type="button"
      disabled={disabled}
      aria-expanded={expanded}
      aria-controls="write-response"
      onClick={onClick}
    >
      <KeyboardIcon />
      <span>Escrever</span>
    </button>
  );
}
