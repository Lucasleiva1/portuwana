import { useEffect, useRef, useState } from "react";
import { clampPortuguesePower } from "./portuguesePower.model";

interface PortuguesePowerProps {
  value: number;
}

export function PortuguesePower({ value }: PortuguesePowerProps) {
  const normalized = clampPortuguesePower(value);
  const previousRef = useRef(normalized);
  const [gained, setGained] = useState(false);

  useEffect(() => {
    if (normalized <= previousRef.current) {
      previousRef.current = normalized;
      return;
    }
    previousRef.current = normalized;
    setGained(true);
    const timer = window.setTimeout(() => setGained(false), 850);
    return () => window.clearTimeout(timer);
  }, [normalized]);

  return (
    <section
      className={`portuguese-power${gained ? " portuguese-power--gained" : ""}`}
      aria-label={`Poder do Português: ${normalized}%`}
    >
      <div className="portuguese-power__label">
        <span>Poder do Português</span>
        <strong>{normalized}%</strong>
      </div>
      <div
        className="portuguese-power__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={normalized}
      >
        <span style={{ width: `${normalized}%` }} />
        <i aria-hidden="true" />
        <i aria-hidden="true" />
        <i aria-hidden="true" />
      </div>
    </section>
  );
}

export { addPortuguesePower, clampPortuguesePower } from "./portuguesePower.model";
