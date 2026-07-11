import { HardwareButton } from "../hardware/index.ts";

export interface LicencePanelProps {
  open: boolean;
  onClose: () => void;
}

/** Licence panel styled as a rack unit (spec section 7: no modal, no web
 *  dialog). Night 4 ships the panel and the gate only; the purchase flow
 *  (Lemon Squeezy) arrives on Night 5. */
export function LicencePanel({ open, onClose }: LicencePanelProps) {
  if (!open) return null;
  return (
    <div className="rack-panel licence-panel" data-testid="licence-panel">
      <div className="licence-plate">
        <span className="licence-title">Woodshed licence</span>
        <span className="licence-copy">
          Stem export and chord detection are part of the paid licence.
          Separation, mixing, solo, loops, tempo, and pitch stay free.
          Licence purchase arrives with the public release; there is
          nothing to buy tonight.
        </span>
      </div>
      <HardwareButton
        label="CLOSE"
        led="amber"
        on={false}
        momentary
        ariaLabel="Close licence panel"
        onChange={onClose}
      />
    </div>
  );
}
