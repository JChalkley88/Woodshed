import { useMemo, useRef, useState } from "react";
import "./hardware.css";

export interface ScribbleStripProps {
  value: string;
  onChange: (text: string) => void;
  /** Stable identity used to assign the tape rotation once; the same id
   *  always gets the same tilt, never re-randomised on render. */
  id: string;
  maxLength?: number;
}

/** Deterministic rotation in [-1, 1] degrees from the strip id (spec:
 *  assigned once and stored). */
function rotationFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (((h % 200) + 200) % 200) / 100 - 1;
}

/** 4.7 Scribble strip: tape label, click to edit, 24 characters max.
 *  Per-song persistence arrives with IndexedDB on Night 3. */
export function ScribbleStrip({
  value,
  onChange,
  id,
  maxLength = 24,
}: ScribbleStripProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const rotation = useMemo(() => rotationFor(id), [id]);

  const commit = () => {
    setEditing(false);
    const text = draft.slice(0, maxLength).trim();
    if (text && text !== value) onChange(text);
    else setDraft(value);
  };

  return (
    <div
      className="hw-scrib"
      style={{ transform: `rotate(${rotation}deg)` }}
      onClick={() => {
        if (!editing) {
          setDraft(value);
          setEditing(true);
          requestAnimationFrame(() => inputRef.current?.select());
        }
      }}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          maxLength={maxLength}
          aria-label="Scribble strip label"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(value);
              setEditing(false);
            }
            e.stopPropagation();
          }}
        />
      ) : (
        <span>{value}</span>
      )}
    </div>
  );
}
