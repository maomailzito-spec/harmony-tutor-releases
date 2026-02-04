import { useEffect, useRef } from 'react';

export type MenuState = Parameters<NonNullable<Window['electronAPI']>['setMenuState']>[0];

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
    const api = window.electronAPI;
    if (!api?.setMenuState) return;

    // Avoid spamming the main process with identical states.
    if (shallowEqualByKeys(prevRef.current, state)) return;
    prevRef.current = state;

    try {
      api.setMenuState(state);
    } catch {
      // ignore
    }
  }, [state]);
}
