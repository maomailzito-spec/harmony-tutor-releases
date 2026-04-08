export type EngravingMode = 'legacy' | 'enhanced';

export type MenuState = Partial<{
  selectOnlyCurrentVoiceEnabled: boolean;
  showMeasureNumbersEnabled: boolean;
  showHarmonyDebugEnabled: boolean;
  showVoiceColorsEnabled: boolean;
  showQuickInsertBarEnabled: boolean;
  engravingMode: EngravingMode;
}>;

export function normalizeMenuState(state: unknown): MenuState | null;
