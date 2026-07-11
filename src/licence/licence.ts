// Free/paid feature gate. Night 4 is flag plus LOCKED visuals only; the
// real licence purchase and key validation (Lemon Squeezy) is Night 5
// scope. No payment provider code belongs here tonight.

export type PaidFeature = "export" | "chords";

/** Free forever: separation, mixing, solo, loop, tempo, pitch. Paid:
 *  stem export and chord detection. */
export const PAID_FEATURES: PaidFeature[] = ["export", "chords"];

/** True when paid features are unlocked.
 *
 *  Dev builds are permissive (nothing blocks the overnight build); a
 *  `?locked=1` URL parameter forces the locked state so the LOCKED
 *  treatment can be exercised and e2e-tested, and `?unlocked=1` forces
 *  the unlocked state in a production build. Night 5 replaces this with
 *  a stored, validated licence. */
export function isUnlocked(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.has("locked")) return false;
  if (params.has("unlocked")) return true;
  return import.meta.env.DEV;
}

export function featureUnlocked(feature: PaidFeature): boolean {
  void feature; // one flag covers all paid features until Night 5
  return isUnlocked();
}
