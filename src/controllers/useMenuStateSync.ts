import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
  'language',
];

function shallowEqualByKeys(a: MenuState | null, b: MenuState | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  for (const k of keys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

export function useMenuStateSync(state: Omit<MenuState, 'language'>): void {
  const { i18n } = useTranslation();
  const prevRef = useRef<MenuState | null>(null);

  useEffect(() => {
    const fullState: MenuState = { ...state, language: i18n.language };
    // Avoid spamming the main process with identical states.
    if (shallowEqualByKeys(prevRef.current, fullState)) return;
    prevRef.current = fullState;

    try {
      electronBridge.setMenuState(fullState);
    } catch {
      // ignore
    }
  }, [state, i18n.language]);
}
