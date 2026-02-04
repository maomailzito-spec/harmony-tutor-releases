import {
  ENABLE_INFERRED_CONTEXTS_PREF_KEY,
  ENGRAVING_MODE_KEY,
  HARMONY_LABEL_MIN_SPAN_BEATS_KEY,
  HARMONY_SEQUENCES_ENABLED_KEY,
  STAFF_SYSTEM_MODE_KEY,
} from '../storage/storageKeys';

export type PreferenceSectionId = 'Editor' | 'Analysis' | 'Render' | 'MIDI' | 'Export' | 'Debug';

export type PreferenceId =
  | 'editor.staffSystemMode'
  | 'render.engravingMode'
  | 'analysis.sequencesEnabled'
  | 'analysis.enableInferredContexts'
  | 'analysis.harmonyLabelMinSpanBeats';

export type PreferenceDef<T> = {
  id: PreferenceId;
  section: PreferenceSectionId;
  label: string;
  storageKey: string;
  defaultValue: T;
  parse: (raw: string | null) => T;
  serialize: (value: T) => string;
};

const parseBool = (raw: string | null, fallback: boolean): boolean => {
  try {
    const v = String(raw ?? '').trim().toLowerCase();
    if (!v) return fallback;
    if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
    if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
    return fallback;
  } catch {
    return fallback;
  }
};

const parseNumber = (raw: string | null, fallback: number): number => {
  try {
    if (raw == null) return fallback;
    const n = Number(String(raw).trim());
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
};

export type StaffSystemModePref = 'grandstaff' | 'treble_only' | 'satb_ancient';
export type EngravingModePref = 'legacy' | 'enhanced';

export const PREFERENCES: Record<PreferenceId, PreferenceDef<any>> = {
  'editor.staffSystemMode': {
    id: 'editor.staffSystemMode',
    section: 'Editor',
    label: 'Layout righi (grandstaff / SATB / treble-only)',
    storageKey: STAFF_SYSTEM_MODE_KEY,
    defaultValue: 'grandstaff' as StaffSystemModePref,
    parse: (raw) => {
      const v = String(raw ?? '').trim();
      return (v === 'grandstaff' || v === 'treble_only' || v === 'satb_ancient') ? v : 'grandstaff';
    },
    serialize: (value: StaffSystemModePref) => String(value),
  },

  'render.engravingMode': {
    id: 'render.engravingMode',
    section: 'Render',
    label: 'Engraving mode (legacy/enhanced)',
    storageKey: ENGRAVING_MODE_KEY,
    defaultValue: 'enhanced' as EngravingModePref,
    parse: (raw) => {
      const v = String(raw ?? '').trim();
      return (v === 'legacy' || v === 'enhanced') ? v : 'enhanced';
    },
    serialize: (value: EngravingModePref) => String(value),
  },

  'analysis.sequencesEnabled': {
    id: 'analysis.sequencesEnabled',
    section: 'Analysis',
    label: 'Sequenze (ON/OFF)',
    storageKey: HARMONY_SEQUENCES_ENABLED_KEY,
    defaultValue: true,
    parse: (raw) => parseBool(raw, true),
    serialize: (value: boolean) => (value ? '1' : '0'),
  },

  'analysis.enableInferredContexts': {
    id: 'analysis.enableInferredContexts',
    section: 'Analysis',
    label: 'Inferisci contesti (modulazioni) automaticamente',
    storageKey: ENABLE_INFERRED_CONTEXTS_PREF_KEY,
    defaultValue: false,
    parse: (raw) => parseBool(raw, false),
    serialize: (value: boolean) => (value ? '1' : '0'),
  },

  'analysis.harmonyLabelMinSpanBeats': {
    id: 'analysis.harmonyLabelMinSpanBeats',
    section: 'Analysis',
    label: 'Filtro anti-rumore: durata minima label (beats)',
    storageKey: HARMONY_LABEL_MIN_SPAN_BEATS_KEY,
    defaultValue: 0,
    parse: (raw) => {
      const v = parseNumber(raw, 0);
      return v >= 0 ? v : 0;
    },
    serialize: (value: number) => String(Number.isFinite(value) ? value : 0),
  },
};
