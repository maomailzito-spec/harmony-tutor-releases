import { getStorage } from '../storage/localStorage';
import { PREFERENCES, PreferenceId } from './preferencesRegistry';

type Listener<T> = (value: T) => void;

const listenersById = new Map<PreferenceId, Set<Listener<any>>>();

function emitPreferenceChange<T>(id: PreferenceId, value: T): void {
  try {
    const listeners = listenersById.get(id);
    if (!listeners || listeners.size === 0) return;
    listeners.forEach((fn) => {
      try {
        fn(value);
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore
  }
}

export function subscribePreference<T>(id: PreferenceId, listener: Listener<T>): () => void {
  const set = listenersById.get(id) ?? new Set<Listener<any>>();
  set.add(listener as any);
  listenersById.set(id, set);
  return () => {
    try {
      const cur = listenersById.get(id);
      if (!cur) return;
      cur.delete(listener as any);
      if (cur.size === 0) listenersById.delete(id);
    } catch {
      // ignore
    }
  };
}

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

  emitPreferenceChange<T>(id, value);
}

export function resetPreference(id: PreferenceId): void {
  const def = PREFERENCES[id];
  writePreference(id, def.defaultValue);
}

export function resetPreferences(ids: PreferenceId[]): void {
  (ids || []).forEach((id) => resetPreference(id));
}
