import { useState } from "react";
import { namedStemRows } from "../separation/chunking.ts";
import { SAMPLE_RATE, STEM_DISPLAY } from "../separation/constants.ts";
import { separator } from "../separation/separator.ts";
import { downloadBytes, encodeWav, encodeZip, type ZipEntry } from "../export/wav.ts";
import { HardwareButton, LCD } from "../hardware/index.ts";

export interface ExportRackProps {
  /** Content key of the separated song in the stem cache. */
  songKey: string;
  /** Song file name, used to derive export names. */
  fileName: string;
  unlocked: boolean;
  onLockedInteraction: () => void;
}

function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").replace(/[^\w\- ]+/g, "").trim() || "song";
}

/** Stem export rack unit: per-stem WAV at 16 or 24 bit, or one zip of all
 *  four stems. Paid feature: when locked the controls stay present with
 *  LEDs unlit and the readout showing LOCKED (spec section 7), and any
 *  press opens the licence panel. */
export function ExportRack({
  songKey,
  fileName,
  unlocked,
  onLockedInteraction,
}: ExportRackProps) {
  const [bitDepth, setBitDepth] = useState<16 | 24>(16);
  const [busy, setBusy] = useState(false);

  const exportStems = async (asZip: boolean) => {
    if (!unlocked) {
      onLockedInteraction();
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const cached = await separator.getCachedRows(songKey);
      if (!cached) return;
      const named = namedStemRows(cached.rows);
      const base = baseName(fileName);
      if (asZip) {
        const entries: ZipEntry[] = STEM_DISPLAY.map(({ name }) => ({
          name: `${base}-${name}.wav`,
          data: encodeWav(named[name][0], named[name][1], SAMPLE_RATE, bitDepth),
        }));
        downloadBytes(encodeZip(entries), `${base}-stems.zip`, "application/zip");
      } else {
        for (const { name } of STEM_DISPLAY) {
          downloadBytes(
            encodeWav(named[name][0], named[name][1], SAMPLE_RATE, bitDepth),
            `${base}-${name}.wav`,
            "audio/wav",
          );
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`rack-panel${unlocked ? "" : " rack-locked"}`}
      data-testid="export-rack"
    >
      <span className="label">Stem export</span>
      <LCD variant="readout" ariaLabel="Export status">
        <span data-testid="export-readout">
          {unlocked ? (busy ? "WRITING..." : `WAV ${bitDepth}-BIT`) : "LOCKED"}
        </span>
      </LCD>
      <HardwareButton
        label="16"
        led="amber"
        on={unlocked && bitDepth === 16}
        ariaLabel="Export at 16 bit"
        onChange={() => (unlocked ? setBitDepth(16) : onLockedInteraction())}
      />
      <HardwareButton
        label="24"
        led="amber"
        on={unlocked && bitDepth === 24}
        ariaLabel="Export at 24 bit"
        onChange={() => (unlocked ? setBitDepth(24) : onLockedInteraction())}
      />
      <HardwareButton
        label="WAVS"
        led="amber"
        on={false}
        momentary
        ariaLabel="Export stems as WAV files"
        onChange={() => void exportStems(false)}
      />
      <HardwareButton
        label="ZIP"
        led="amber"
        on={false}
        momentary
        ariaLabel="Export stems as a zip"
        onChange={() => void exportStems(true)}
      />
    </div>
  );
}
