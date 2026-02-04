import { getStorage } from '../storage/localStorage';
import { PREFERENCES, PreferenceId } from './preferencesRegistry';

export function readPreference<T>(id: PreferenceId): T {
  const def = PREFERENCES[id];
  const ls = getStorage();
  try {
    const raw = ls ? ls.getItem(def.storageKey) : null;
    return def.parse(raw) as T;
  } catch {
    return def.defaultValue as T;
  }
}

export function writePreference<T>(id: PreferenceId, value: T): void {
  const def = PREFERENCES[id];
  const ls = getStorage();
  if (!ls) return;
  try {
    ls.setItem(def.storageKey, def.serialize(value));
  } catch {
    // ignore
  }
}
