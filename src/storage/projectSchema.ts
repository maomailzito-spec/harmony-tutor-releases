import type { AccompanimentTrack, StaffNote, TimeSignature, TimeSignatureChange } from '../types';

export const CURRENT_PROJECT_SCHEMA_VERSION = 1 as const;

export const PROJECT_KNOWN_KEYS_V1 = [
  'schemaVersion',
  'notes',
  'staffSystemMode',
  'keySignatureRoot',
  'isMinorMode',
  'projectTitle',
  'projectComposer',
  'titleFontSize',
  'titleFontFamily',
  'timeSignature',
  'timeSignatureChanges',
  'autoLeadingToneInMinor',
  'keyChangeMode',
  'modalTonicOverride',
  'analysisContexts',
  'harmonyOverrides',
  'accHarmonyOverrides',
  'doubleBarlineMeasures',
  'bpm',
  'isBpmActive',
  'isMetronomeOn',
  'metronomeUnit',
  'isSwing',
  'toolbarGroupOrder',
  'tempoCurves',
  'dynamics',
  'slurs',
  'octaveShifts',
  'keySignatureChanges',
  'analysisLocked',
  'teacherPasswordHash',
  'analysisLockOptions',
  'accompanimentTracks',
  'satbName',
  'satbVisible',
  'partCount',
  'masterVolumes',
  'voicePans',
  'voiceReverbSends',
  'reverb',
  'comp',
  'voiceComps',
  'voiceEqs',
  'masterEq',
  'satbEq',
  'satbComp',
  'accEq',
  'accComp',
  'voiceSoundBanks',
] as const;

const KNOWN_KEY_SET: ReadonlySet<string> = new Set(PROJECT_KNOWN_KEYS_V1 as readonly string[]);

export type ProjectDataV1 = {
  schemaVersion: typeof CURRENT_PROJECT_SCHEMA_VERSION;

  notes: StaffNote[];
  staffSystemMode?: 'grandstaff' | 'treble_only' | 'satb_ancient';

  keySignatureRoot?: string;
  isMinorMode?: boolean;
  projectTitle?: string;
  /** Autore del brano, stampato sotto il titolo e letto dai file importati. */
  projectComposer?: string;
  titleFontSize?: number;
  titleFontFamily?: string;

  timeSignature?: TimeSignature;
  timeSignatureChanges?: TimeSignatureChange[];

  autoLeadingToneInMinor?: boolean;
  keyChangeMode?: 'none' | 'transpose' | 'modal';
  modalTonicOverride?: string;

  analysisContexts?: any[];
  harmonyOverrides?: any[];
  /** Override manuali dell'analisi delle tracce ACC (collasso Opt+Shift+H in modo ACC). */
  accHarmonyOverrides?: any[];
  doubleBarlineMeasures?: number[];

  bpm?: number;
  isBpmActive?: boolean;
  isMetronomeOn?: boolean;
  metronomeUnit?: 'quarter' | 'eighth' | 'dotted-quarter';
  isSwing?: boolean;

  toolbarGroupOrder?: any[];

  tempoCurves?: any[];
  /** Segni di dinamica (pp…ff, sf, fp, forcelle): valgono per tutte le voci. */
  dynamics?: any[];
  slurs?: any[];
  octaveShifts?: any[];
  keySignatureChanges?: any[];

  analysisLocked?: boolean;
  teacherPasswordHash?: string;
  analysisLockOptions?: {
    hideViolations: boolean;
    hideRomanLabels: boolean;
    hideChordSymbols: boolean;
    hideOrnaments: boolean;
    hideAlternatives: boolean;
    disableExport: boolean;
  };

  /** Tracce di accompagnamento (opzionale, retrocompatibile).
   *  Non soggette ad analisi armonica né a voice-leading checker. */
  accompanimentTracks?: AccompanimentTrack[];

  /** Volumi dei fader MASTER del mixer (gain lineare 0..1): gruppo SATB, gruppo ACC
   *  e master globale. Assenti = 1 (0 dB). */
  masterVolumes?: { satb?: number; acc?: number; mixer?: number };

  /** FX mixer: pan (-1..+1) e mandata riverbero (0..1) per voce SATB; riverbero globale. */
  voicePans?: Record<number, number>;
  voiceReverbSends?: Record<number, number>;
  reverb?: { preset?: 'off' | 'room' | 'hall' | 'plate'; wet?: number };
  comp?: { enabled?: boolean; threshold?: number; ratio?: number; attack?: number; release?: number; makeup?: number };
  /** Compressore per-voce SATB (1-4). */
  voiceComps?: Record<number, { enabled?: boolean; threshold?: number; ratio?: number; attack?: number; release?: number; makeup?: number }>;
  /** EQ per-voce SATB (1-4), 3 bande. */
  voiceEqs?: Record<number, any>;
  /** EQ sul master (3 bande). */
  masterEq?: any;
  /** EQ + Comp sui bus di gruppo SATB e ACC. */
  satbEq?: any;
  satbComp?: any;
  accEq?: any;
  accComp?: any;
  /** Banco timbrico per voce SATB (1-4): 'orchestral' (FLAC locali, default) o 'gm'. */
  voiceSoundBanks?: Record<number, 'orchestral' | 'gm'>;
};

export type AnalysisLockOptions = NonNullable<ProjectDataV1['analysisLockOptions']>;

export const DEFAULT_ANALYSIS_LOCK_OPTIONS: AnalysisLockOptions = {
  hideViolations: true,
  hideRomanLabels: false,
  hideChordSymbols: false,
  hideOrnaments: false,
  hideAlternatives: false,
  disableExport: true,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function intOrNull(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function coerceSchemaVersion(raw: unknown): number {
  const v = intOrNull(raw);
  return (v != null && v >= 0) ? v : 0;
}

function coerceTimeSignature(raw: unknown): TimeSignature {
  const fallback: TimeSignature = { numerator: 4, denominator: 4 };
  if (!isPlainObject(raw)) return fallback;
  const n = intOrNull(raw.numerator);
  const d = intOrNull(raw.denominator);
  if (n == null || d == null || n <= 0 || d <= 0) return fallback;
  return { numerator: n, denominator: d };
}

function coerceTimeSignatureChanges(raw: unknown): TimeSignatureChange[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isPlainObject)
    .map((c): TimeSignatureChange | null => {
      const measureIndex = intOrNull(c.measureIndex);
      const numerator = intOrNull(c.numerator);
      const denominator = intOrNull(c.denominator);
      const absBeat = typeof c.absBeat === 'number' && Number.isFinite(c.absBeat) ? c.absBeat : undefined;

      if (measureIndex == null || numerator == null || denominator == null) return null;
      if (measureIndex < 0 || numerator <= 0 || denominator <= 0) return null;

      return { measureIndex, numerator, denominator, absBeat };
    })
    .filter((x): x is TimeSignatureChange => Boolean(x))
    .sort((a, b) => (a.measureIndex ?? 0) - (b.measureIndex ?? 0));
}

export function migrateProjectData(raw: unknown): ProjectDataV1 {
  if (!isPlainObject(raw)) {
    throw new Error('Formato progetto non valido: root non è un oggetto.');
  }

  const hasSchemaVersion = Object.prototype.hasOwnProperty.call(raw, 'schemaVersion');
  // Legacy files: no schemaVersion field. Treat them as pre-versioned (v0/v1-compatible).
  const schemaVersion = hasSchemaVersion ? coerceSchemaVersion(raw.schemaVersion) : 0;
  if (schemaVersion > CURRENT_PROJECT_SCHEMA_VERSION) {
    throw new Error(
      `Progetto creato con una versione più recente (schemaVersion=${schemaVersion}). Aggiorna l’app per aprirlo.`
    );
  }

  const notes = raw.notes;
  if (!Array.isArray(notes)) {
    throw new Error('Formato progetto non valido: campo "notes" mancante o non-array.');
  }

  // We keep the payload mostly untouched; coercions are applied at the usage site.
  // Here we just normalize structure and guarantee the schemaVersion field.
  return {
    ...(raw as any),
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    notes: notes as StaffNote[],
    timeSignature: coerceTimeSignature((raw as any).timeSignature),
    timeSignatureChanges: coerceTimeSignatureChanges((raw as any).timeSignatureChanges),
  };
}

// Forward-compat: preserve unknown fields from project files.
// This allows older app versions to round-trip data written by newer versions
// (as long as schemaVersion is still compatible).
export function extractProjectExtras(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) return {};
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!KNOWN_KEY_SET.has(k)) extras[k] = v;
  }
  return extras;
}
