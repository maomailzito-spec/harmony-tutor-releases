import { useEffect, useRef } from 'react';

import type { MenuState } from '../../shared/menuStateRegistry';
import { electronBridge } from '../services/electronBridge';

type Key = keyof MenuState;

const keys: Key[] = [
  'selectOnlyCurrentVoiceEnabled',
  'showMeasureNumbersEnabled',
  'showHarmonyDebugEnabled',
  'showVoiceColorsEnabled',
  'showQuickInsertBarEnabled',
  'engravingMode',
];

function shallowEqualByKeys(a: MenuState | null, b: MenuState | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  for (const k of keys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

export function useMenuStateSync(state: MenuState): void {
  const prevRef = useRef<MenuState | null>(null);

  useEffect(() => {
    // Avoid spamming the main process with identical states.
    if (shallowEqualByKeys(prevRef.current, state)) return;
    prevRef.current = state;

    try {
      electronBridge.setMenuState(state);
    } catch {
      // ignore
    }
  }, [state]);
}
