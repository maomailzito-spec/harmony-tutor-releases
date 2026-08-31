export type EngravingMode = 'legacy' | 'enhanced';

export type MenuState = Partial<{
  selectOnlyCurrentVoiceEnabled: boolean;
  showMeasureNumbersEnabled: boolean;
  showHarmonyDebugEnabled: boolean;
  showVoiceColorsEnabled: boolean;
  concertPitchEnabled: boolean;
  showQuickInsertBarEnabled: boolean;
  /** La toolbar è nascosta: il menù mostra la spunta e deve saperlo. */
  toolbarHiddenEnabled: boolean;
  /** Il titolo finisce nell'esportazione. */
  exportIncludeTitleEnabled: boolean;
  showRomanEnabled: boolean;
  showSymbolsEnabled: boolean;
  showFiguredBassEnabled: boolean;
  satbVisibleEnabled: boolean;
  /** Le tracce di accompagnamento, per il sottomenu dei righi: nome e visibilità. */
  accTracks: Array<{ id: string; name: string; visible: boolean }>;
  engravingMode: EngravingMode;
  language: string;
}>;

export function normalizeMenuState(state: unknown): MenuState | null;
