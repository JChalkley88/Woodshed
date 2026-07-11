import { useState, useSyncExternalStore } from "react";
import { licence } from "../licence/licence.ts";
import { HardwareButton, LCD } from "../hardware/index.ts";

export interface LicencePanelProps {
  /** Expands the panel body (a locked-control press lands here). */
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}

/** Licence rack unit (spec section 7: no modal, no web dialog). Always
 *  installed in the rack with a one-line status; expands to key entry,
 *  activation, and deactivation. Talks to Lemon Squeezy's public licence
 *  API through the licence store; no secret exists client-side. */
export function LicencePanel({ open, onOpen, onClose }: LicencePanelProps) {
  const state = useSyncExternalStore(licence.subscribe, licence.getState);
  const [draftKey, setDraftKey] = useState("");

  const statusText =
    state.phase === "loading"
      ? "CHECKING..."
      : state.phase === "activating"
        ? "ACTIVATING..."
        : state.phase === "active"
          ? "ACTIVE"
          : "UNLICENSED";

  return (
    <div className="rack-panel licence-rack" data-testid="licence-rack">
      <span className="label">Licence</span>
      <LCD variant="readout" ariaLabel="Licence status">
        <span data-testid="licence-status">{statusText}</span>
      </LCD>
      {!open && (
        <HardwareButton
          label="OPEN"
          led="amber"
          on={false}
          momentary
          ariaLabel="Open licence panel"
          onChange={onOpen}
        />
      )}
      {open && (
        <div className="licence-body" data-testid="licence-panel">
          {state.phase === "active" && state.record ? (
            <>
              <span className="licence-copy">
                Licensed to {state.record.customerEmail || "this device"}
                {state.record.productName
                  ? ` (${state.record.productName})`
                  : ""}
                . Export and chord detection are unlocked, online or off.
              </span>
              <HardwareButton
                label="RELEASE"
                led="red"
                on={false}
                momentary
                ariaLabel="Deactivate licence on this device"
                onChange={() => void licence.deactivate()}
              />
            </>
          ) : (
            <>
              <span className="licence-copy">
                Stem export and chord detection need a licence key. One
                purchase, this desk, yours for good. Separation, mixing,
                solo, loops, tempo, and pitch stay free.
              </span>
              <div className="licence-entry">
                <input
                  className="licence-input"
                  value={draftKey}
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  aria-label="Licence key"
                  spellCheck={false}
                  onChange={(e) => setDraftKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void licence.activate(draftKey);
                    e.stopPropagation();
                  }}
                />
                <HardwareButton
                  label="ACTIVATE"
                  led="amber"
                  on={false}
                  momentary
                  wide
                  ariaLabel="Activate licence key"
                  onChange={() => void licence.activate(draftKey)}
                />
              </div>
            </>
          )}
          {state.error && (
            <span className="licence-error" role="alert" data-testid="licence-error">
              {state.error}
            </span>
          )}
          <HardwareButton
            label="CLOSE"
            led="amber"
            on={false}
            momentary
            ariaLabel="Close licence panel"
            onChange={onClose}
          />
        </div>
      )}
    </div>
  );
}
