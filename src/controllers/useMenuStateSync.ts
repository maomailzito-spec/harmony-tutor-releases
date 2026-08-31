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
  'concertPitchEnabled',
  'showQuickInsertBarEnabled',
  'toolbarHiddenEnabled',
  'exportIncludeTitleEnabled',
  'staffSystemModeValue',
  'orchestralGroupingEnabled',
  'romanBassModeEnabled',
  'sequencesEnabled',
  'showRomanEnabled',
  'showSymbolsEnabled',
  'showFiguredBassEnabled',
  'satbVisibleEnabled',
  'engravingMode',
  'language',
];

function shallowEqualByKeys(a: MenuState | null, b: MenuState | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  for (const k of keys) {
    if (a[k] !== b[k]) return false;
  }
  // Le tracce sono una LISTA: il confronto per riferimento la direbbe sempre diversa
  // (si ricostruisce a ogni render) e il menù si rifarebbe di continuo. Conta ciò che
  // il menù mostra davvero: quante sono, come si chiamano, se sono accese.
  const ta = a.accTracks || [];
  const tb = b.accTracks || [];
  if (ta.length !== tb.length) return false;
  for (let i = 0; i < ta.length; i++) {
    if (ta[i].id !== tb[i].id || ta[i].name !== tb[i].name || ta[i].visible !== tb[i].visible) return false;
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
