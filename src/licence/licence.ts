// Licence gate and Lemon Squeezy key lifecycle (Night 5). The licence API
// endpoints (activate/validate/deactivate) are Lemon Squeezy's public
// client-side API: they take only the licence key itself, so no secret is
// ever present in this codebase. Test-mode keys exercise the same
// endpoints. The activation result is stored in IndexedDB and revalidated
// periodically; once activated, paid features keep working offline (a
// network failure during revalidation never locks the desk).
import {
  deleteSetting,
  getSetting,
  putSetting,
} from "../separation/cache.ts";

export type PaidFeature = "export" | "chords";

/** Free forever: separation, mixing, solo, loop, tempo, pitch. Paid:
 *  stem export and chord detection. */
export const PAID_FEATURES: PaidFeature[] = ["export", "chords"];

/** Lemon Squeezy licence API base. Overridable for tests. */
export const LICENCE_API_BASE = "https://api.lemonsqueezy.com/v1/licenses";

/** LAUNCH TODO: set VITE_LS_STORE_ID and VITE_LS_PRODUCT_ID to the live
 *  Lemon Squeezy store and product so activation rejects keys bought for
 *  other products. 0 accepts any product (test-mode placeholder). */
const EXPECTED_STORE_ID = Number(import.meta.env.VITE_LS_STORE_ID ?? 0);
const EXPECTED_PRODUCT_ID = Number(import.meta.env.VITE_LS_PRODUCT_ID ?? 0);

/** Revalidate a stored licence at most this often. */
const REVALIDATE_MS = 24 * 60 * 60 * 1000;

const SETTING_KEY = "licence";

export interface LicenceRecord {
  licenceKey: string;
  instanceId: string;
  instanceName: string;
  productName: string;
  customerEmail: string;
  activatedAt: number;
  lastValidatedAt: number;
}

export type LicencePhase =
  | "loading"
  | "unlicensed"
  | "activating"
  | "active"
  | "error";

export interface LicenceState {
  phase: LicencePhase;
  record: LicenceRecord | null;
  error: string | null;
}

type Listener = () => void;

interface LsKeyMeta {
  store_id?: number;
  product_id?: number;
  product_name?: string;
  customer_email?: string;
}

async function post(
  path: "activate" | "validate" | "deactivate",
  body: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${LICENCE_API_BASE}/${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return (await response.json()) as Record<string, unknown>;
}

export class LicenceStore {
  private state: LicenceState = { phase: "loading", record: null, error: null };
  private listeners = new Set<Listener>();
  private initPromise: Promise<void> | null = null;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): LicenceState => this.state;

  private set(partial: Partial<LicenceState>) {
    this.state = { ...this.state, ...partial };
    for (const l of this.listeners) l();
  }

  /** Loads the stored licence and, when online and stale, revalidates in
   *  the background. Safe to call repeatedly; runs once. */
  init(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.load();
    return this.initPromise;
  }

  private async load(): Promise<void> {
    try {
      const record = await getSetting<LicenceRecord>(SETTING_KEY);
      if (!record) {
        this.set({ phase: "unlicensed", record: null });
        return;
      }
      this.set({ phase: "active", record });
      if (Date.now() - record.lastValidatedAt > REVALIDATE_MS) {
        void this.revalidate(record);
      }
    } catch {
      this.set({ phase: "unlicensed", record: null });
    }
  }

  /** Background revalidation. A definitive "not valid" from the API locks
   *  the desk (refund, disabled key, deactivated elsewhere); any network
   *  failure keeps the licence active, which is the offline grace the
   *  brief requires. */
  private async revalidate(record: LicenceRecord): Promise<void> {
    let result: Record<string, unknown>;
    try {
      result = await post("validate", {
        license_key: record.licenceKey,
        instance_id: record.instanceId,
      });
    } catch {
      return; // offline or API unreachable: keep working
    }
    if (result.valid === false) {
      await deleteSetting(SETTING_KEY);
      this.set({
        phase: "unlicensed",
        record: null,
        error: "Licence is no longer valid on this device.",
      });
      return;
    }
    const updated = { ...record, lastValidatedAt: Date.now() };
    await putSetting(SETTING_KEY, updated);
    this.set({ record: updated });
  }

  async activate(licenceKey: string): Promise<boolean> {
    const key = licenceKey.trim();
    if (!key) {
      this.set({ error: "Enter a licence key first." });
      return false;
    }
    this.set({ phase: "activating", error: null });
    let result: Record<string, unknown>;
    try {
      result = await post("activate", {
        license_key: key,
        instance_name: "Woodshed desk",
      });
    } catch {
      this.set({
        phase: this.state.record ? "active" : "unlicensed",
        error: "Could not reach the licence server. Check your connection and try again.",
      });
      return false;
    }
    if (result.activated !== true) {
      this.set({
        phase: "unlicensed",
        error:
          typeof result.error === "string" && result.error
            ? result.error
            : "That key could not be activated.",
      });
      return false;
    }
    const meta = (result.meta ?? {}) as LsKeyMeta;
    if (
      (EXPECTED_STORE_ID && meta.store_id !== EXPECTED_STORE_ID) ||
      (EXPECTED_PRODUCT_ID && meta.product_id !== EXPECTED_PRODUCT_ID)
    ) {
      this.set({
        phase: "unlicensed",
        error: "That key belongs to a different product.",
      });
      return false;
    }
    const instance = (result.instance ?? {}) as { id?: string; name?: string };
    const record: LicenceRecord = {
      licenceKey: key,
      instanceId: instance.id ?? "",
      instanceName: instance.name ?? "Woodshed desk",
      productName: meta.product_name ?? "Woodshed",
      customerEmail: meta.customer_email ?? "",
      activatedAt: Date.now(),
      lastValidatedAt: Date.now(),
    };
    await putSetting(SETTING_KEY, record);
    this.set({ phase: "active", record, error: null });
    return true;
  }

  /** Frees the activation slot when online; always clears the local
   *  record, so an offline deactivation locks this desk immediately (the
   *  remote slot frees on the key's next online validation elsewhere). */
  async deactivate(): Promise<void> {
    const record = this.state.record;
    if (record) {
      try {
        await post("deactivate", {
          license_key: record.licenceKey,
          instance_id: record.instanceId,
        });
      } catch {
        // Offline: local lock still proceeds.
      }
    }
    await deleteSetting(SETTING_KEY);
    this.set({ phase: "unlicensed", record: null, error: null });
  }
}

export const licence = new LicenceStore();

/** True when paid features are unlocked.
 *
 *  Precedence: `?unlocked=1` forces open (demo). `?locked=1` disables the
 *  dev permissiveness so the real licence gate applies (e2e uses this to
 *  exercise LOCKED and the activation flow). Otherwise dev builds stay
 *  permissive so nothing blocks the build, and production builds require
 *  an activated licence. */
export function featureUnlocked(feature: PaidFeature): boolean {
  void feature; // per-feature entitlements are a later concern; one licence
  const params = new URLSearchParams(window.location.search);
  if (params.has("unlocked")) return true;
  if (!params.has("locked") && import.meta.env.DEV) return true;
  return licence.getState().phase === "active";
}
