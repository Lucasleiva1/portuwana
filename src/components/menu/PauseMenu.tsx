import { CloseIcon, PauseIcon } from "../icons";

interface PauseMenuProps {
  open: boolean;
  onToggle: () => void;
  onRestart: () => void;
  onExit: () => void;
}

export function PauseMenu({
  open,
  onToggle,
  onRestart,
  onExit,
}: PauseMenuProps) {
  return (
    <div className="pause-menu">
      <button
        className="pause-menu__trigger"
        type="button"
        onClick={onToggle}
        aria-label={open ? "Fechar menu" : "Pausar e abrir menu"}
        aria-expanded={open}
        aria-controls="pause-menu-panel"
      >
        {open ? <CloseIcon /> : <PauseIcon />}
      </button>
      {open && (
        <div className="pause-menu__panel" id="pause-menu-panel" role="dialog">
          <span className="pause-menu__eyebrow">CENA PAUSADA</span>
          <button type="button" className="is-primary" onClick={onToggle}>
            Continuar
          </button>
          <button type="button" onClick={onRestart}>
            Reiniciar cena
          </button>
          <button type="button" onClick={onExit}>
            Sair
          </button>
        </div>
      )}
    </div>
  );
}
