import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { PreferenceId } from './preferencesRegistry';
import { readPreference, subscribePreference, writePreference } from './preferencesStore';

export function usePreference<T>(id: PreferenceId): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValueState] = useState<T>(() => readPreference<T>(id));

  // If the preference id changes (rare), reload from storage.
  useEffect(() => {
    setValueState(readPreference<T>(id));
  }, [id]);

  // Keep multiple hook instances in sync.
  useEffect(() => {
    return subscribePreference<T>(id, (next) => {
      setValueState((prev) => (Object.is(prev, next) ? prev : next));
    });
  }, [id]);

  const setValue: Dispatch<SetStateAction<T>> = (next) => {
    setValueState((prev) => {
      try {
        if (typeof next === 'function') return (next as any)(prev);
        return next as T;
      } catch {
        return prev;
      }
    });
  };

  useEffect(() => {
    writePreference<T>(id, value);
  }, [id, value]);

  return [value, setValue];
}
