// IndexedDB stem cache, resume-partial store, and per-song practice state.
// Hand-rolled promise wrapper rather than the `idb` package because that
// library is ISC licensed and the project constraint allows MIT/BSD/Apache
// only. Three stores:
//   stems    — finished separations keyed by content hash + model id
//   partials — per-chunk outputs persisted during separation so a cancelled
//              or crashed run resumes from the last completed chunk
//   songs    — per-song practice state (scribbles, saved loops, last-used
//              mixer settings), keyed like stems, restored on reopen
//   chords   — detected chord segments per song (Night 4)
import type { ChordSegment } from "../analysis/chords.ts";
import { MODEL_ID, N_CHANNELS, N_STEMS, type StemName } from "./constants.ts";

const DB_NAME = "woodshed";
const DB_VERSION = 3;

export interface StemRecord {
  key: string;
  name: string;
  duration: number;
  totalSamples: number;
  /** Per-stem RMS measured at separation time (sanity + tests). */
  stemRms: number[];
  ep: string;
  createdAt: number;
  /** 8 rows (stem-major, stereo pairs) of 16-bit PCM. */
  rows: ArrayBuffer[];
}

export interface PartialRecord {
  id: string; // `${songKey}:${chunkIndex}`
  songKey: string;
  chunkIndex: number;
  /** Quantised model output for the chunk, Int16 of length 4*2*SEGMENT. */
  data: ArrayBuffer;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("stems")) {
        db.createObjectStore("stems", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("partials")) {
        const store = db.createObjectStore("partials", { keyPath: "id" });
        store.createIndex("bySong", "songKey");
      }
      if (!db.objectStoreNames.contains("songs")) {
        db.createObjectStore("songs", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("chords")) {
        db.createObjectStore("chords", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(
  name: "stems" | "partials" | "songs" | "chords",
  mode: IDBTransactionMode,
): Promise<IDBObjectStore> {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

/* ---------------- Content keying ---------------- */

/** Cache key: SHA-256 of the decoded, resampled audio content plus the
 *  model identifier, so a model upgrade never serves stale stems. */
export async function contentKey(
  channels: Float32Array[],
  modelId: string = MODEL_ID,
): Promise<string> {
  const totalBytes = channels.reduce((n, c) => n + c.byteLength, 0);
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const c of channels) {
    merged.set(new Uint8Array(c.buffer, c.byteOffset, c.byteLength), offset);
    offset += c.byteLength;
  }
  const digest = await crypto.subtle.digest("SHA-256", merged);
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${hex}:${modelId}`;
}

/* ---------------- Stems ---------------- */

export async function getStems(key: string): Promise<StemRecord | undefined> {
  return request((await store("stems", "readonly")).get(key));
}

export async function putStems(record: StemRecord): Promise<void> {
  await request((await store("stems", "readwrite")).put(record));
}

export async function deleteStems(key: string): Promise<void> {
  await request((await store("stems", "readwrite")).delete(key));
}

export interface CachedSongSummary {
  key: string;
  name: string;
  duration: number;
  createdAt: number;
  bytes: number;
}

export async function listCachedSongs(): Promise<CachedSongSummary[]> {
  const records: StemRecord[] = await request(
    (await store("stems", "readonly")).getAll(),
  );
  return records
    .map((r) => ({
      key: r.key,
      name: r.name,
      duration: r.duration,
      createdAt: r.createdAt,
      bytes: r.rows.reduce((n, row) => n + row.byteLength, 0),
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function cacheSizeBytes(): Promise<number> {
  const songs = await listCachedSongs();
  return songs.reduce((n, s) => n + s.bytes, 0);
}

/* ---------------- Partials (resume safety) ---------------- */

export async function putPartial(
  songKey: string,
  chunkIndex: number,
  data: ArrayBuffer,
): Promise<void> {
  await request(
    (await store("partials", "readwrite")).put({
      id: `${songKey}:${chunkIndex}`,
      songKey,
      chunkIndex,
      data,
    } satisfies PartialRecord),
  );
}

export async function getPartials(
  songKey: string,
): Promise<Map<number, ArrayBuffer>> {
  const s = await store("partials", "readonly");
  const records: PartialRecord[] = await request(
    s.index("bySong").getAll(songKey),
  );
  return new Map(records.map((r) => [r.chunkIndex, r.data]));
}

export async function clearPartials(songKey: string): Promise<void> {
  const s = await store("partials", "readwrite");
  const keys: IDBValidKey[] = await request(s.index("bySong").getAllKeys(songKey));
  for (const key of keys) await request(s.delete(key));
}

/* ---------------- Per-song practice state ---------------- */

export interface SavedLoop {
  /** User-editable tape label, 24 chars (spec 4.7 conventions). */
  name: string;
  start: number;
  end: number;
}

export interface StemMixerSetting {
  gainDb: number;
  muted: boolean;
  soloed: boolean;
}

export interface SongStateRecord {
  key: string;
  /** Scribble-strip text per stem (spec 4.7: per song, 24 chars). */
  scribbles: Partial<Record<StemName, string>>;
  savedLoops: SavedLoop[];
  /** Loop engaged when the song was last used; re-engaged on reopen. */
  lastLoop: { start: number; end: number } | null;
  mixer: {
    speed: number;
    pitch: number;
    stems: Record<StemName, StemMixerSetting> | null;
  };
  updatedAt: number;
}

export async function getSongState(
  key: string,
): Promise<SongStateRecord | undefined> {
  return request((await store("songs", "readonly")).get(key));
}

export async function putSongState(record: SongStateRecord): Promise<void> {
  await request((await store("songs", "readwrite")).put(record));
}

/* ---------------- Chord analysis cache ---------------- */

export interface ChordRecord {
  key: string;
  segments: ChordSegment[];
  createdAt: number;
}

export async function getChords(key: string): Promise<ChordRecord | undefined> {
  return request((await store("chords", "readonly")).get(key));
}

export async function putChords(record: ChordRecord): Promise<void> {
  await request((await store("chords", "readwrite")).put(record));
}

export async function deleteChords(key: string): Promise<void> {
  await request((await store("chords", "readwrite")).delete(key));
}

/** Expected byte size of a full stem record for a given sample count
 *  (4 stems, stereo, 16-bit). */
export function stemBytesFor(totalSamples: number): number {
  return totalSamples * N_STEMS * N_CHANNELS * 2;
}
