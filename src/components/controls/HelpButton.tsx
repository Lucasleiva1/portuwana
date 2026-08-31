import { HelpIcon } from "../icons";

interface HelpButtonProps {
  expanded: boolean;
  onClick: () => void;
}

export function HelpButton({ expanded, onClick }: HelpButtonProps) {
  return (
    <button
      className="conversation-button conversation-button--help"
      type="button"
      aria-expanded={expanded}
      aria-controls="help-popover"
      onClick={onClick}
    >
      <HelpIcon />
      <span>Preciso de ajuda</span>
    </button>
  );
}
