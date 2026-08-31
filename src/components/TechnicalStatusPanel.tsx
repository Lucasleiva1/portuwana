export type TechnicalStatus = "ready" | "pending" | "checking" | "error";

export interface TechnicalStatusItem {
  label: string;
  status: TechnicalStatus;
}

interface TechnicalStatusPanelProps {
  items: readonly TechnicalStatusItem[];
  machineState: string;
  phase?: string;
}

export function TechnicalStatusPanel({
  items,
  machineState,
  phase = "FASE 1",
}: TechnicalStatusPanelProps) {
  return (
    <aside className="technical-panel" aria-label="Technical readiness">
      <div className="technical-panel__heading">
        <span>FOUNDATION STATUS</span>
        <span className="technical-panel__phase">{phase}</span>
      </div>

      <div className="technical-panel__items">
        {items.map((item) => (
          <div className="technical-panel__item" key={item.label}>
            <span
              className={`technical-panel__dot technical-panel__dot--${item.status}`}
              aria-hidden="true"
            />
            <span>{item.label}:</span>
            <strong>{item.status}</strong>
          </div>
        ))}
      </div>

      <div className="technical-panel__machine">
        <span>conversation.machine</span>
        <code>{machineState}</code>
      </div>
    </aside>
  );
}
