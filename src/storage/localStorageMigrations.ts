import { getStorage } from './localStorage';
import {
  ANALYSIS_ENABLE_INFERRED_CONTEXTS_KEY,
  GUITAR_CUSTOM_CHORDS_KEY,
  GUITAR_CUSTOM_SCALES_KEY,
  GUITAR_CUSTOM_SCALE_SHAPES_KEY,
  GUITAR_CUSTOM_VOICINGS_KEY,
} from './storageKeys';

const MIGRATIONS_VERSION_KEY = 'harmony-tutor.localStorage.migrationsVersion.v1' as const;

function readInt(ls: Storage, key: string, fallback: number): number {
  try {
    const raw = ls.getItem(key);
    const n = Number.parseInt(String(raw ?? ''), 10);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function writeInt(ls: Storage, key: string, value: number): void {
  try {
    ls.setItem(key, String(Math.max(0, Math.trunc(value))));
  } catch {
    // ignore
  }
}

function migrateIfMissing(ls: Storage, fromKey: string, toKey: string): boolean {
  try {
    const to = ls.getItem(toKey);
    if (to != null) return false;
    const from = ls.getItem(fromKey);
    if (from == null) return false;
    ls.setItem(toKey, from);
    // Best-effort cleanup (keep downgrade-safe if remove fails)
    try { ls.removeItem(fromKey); } catch { /* ignore */ }
    return true;
  } catch {
    return false;
  }
}

export function runLocalStorageMigrations(): void {
  const ls = getStorage();
  if (!ls) return;

  const current = readInt(ls, MIGRATIONS_VERSION_KEY, 0);
  if (current >= 1) return;

  // v1 migrations: rename legacy/unversioned keys to versioned names.
  migrateIfMissing(ls, 'HT_ENABLE_INFERRED_CONTEXTS', ANALYSIS_ENABLE_INFERRED_CONTEXTS_KEY);

  migrateIfMissing(ls, 'guitarAppCustomScales', GUITAR_CUSTOM_SCALES_KEY);
  migrateIfMissing(ls, 'guitarAppCustomChords', GUITAR_CUSTOM_CHORDS_KEY);
  migrateIfMissing(ls, 'guitarAppCustomScaleShapes', GUITAR_CUSTOM_SCALE_SHAPES_KEY);
  migrateIfMissing(ls, 'guitarAppCustomVoicings', GUITAR_CUSTOM_VOICINGS_KEY);

  writeInt(ls, MIGRATIONS_VERSION_KEY, 1);
}
