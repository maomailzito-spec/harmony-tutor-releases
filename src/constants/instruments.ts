/**
 * Shared instrument catalogue.
 *
 * Single source of truth for the playable instruments, used by:
 *  - the SATB per-voice instrument selector (string soundfont names + i18n labels)
 *  - the accompaniment tracks (numeric General MIDI program ids)
 *  - the unified mixer (both)
 *
 * Keep this list aligned with the soundfont names actually loadable by the
 * audio service. `i18nKey` resolves to `instrument_<key>` in the toolbar locale.
 */
export interface InstrumentOption {
  /** General MIDI program number (0-127). Used by AccompanimentTrack.instrumentId and MIDI out. */
  gm: number;
  /** Soundfont instrument name used by the audio service (voiceInstruments values). */
  soundfont: string;
  emoji: string;
  /** Suffix for the `instrument_<key>` i18n entries in the toolbar locale files. */
  i18nKey: string;
}

export const INSTRUMENTS: InstrumentOption[] = [
  // tastiere
  { gm: 0,  soundfont: 'acoustic_grand_piano', emoji: '🎹', i18nKey: 'piano' },
  { gm: 19, soundfont: 'church_organ',         emoji: '⛪', i18nKey: 'organ' },
  { gm: 6,  soundfont: 'harpsichord',          emoji: '🎵', i18nKey: 'harpsichord' },
  // archi
  { gm: 48, soundfont: 'string_ensemble_1',    emoji: '🎻', i18nKey: 'strings' },
  { gm: 40, soundfont: 'violin',               emoji: '🎻', i18nKey: 'violin' },
  { gm: 41, soundfont: 'viola',                emoji: '🎻', i18nKey: 'viola' },
  { gm: 42, soundfont: 'cello',                emoji: '🎻', i18nKey: 'cello' },
  { gm: 43, soundfont: 'contrabass',           emoji: '🎻', i18nKey: 'contrabass' },
  // bassi (sezione ritmica) — one-shot, niente loop (vedi ONESHOT_FLAC). FLAC locali
  // renderizzati da SFZ; oltre il range mappato ripiegano sul GM remoto (mp3).
  { gm: 32, soundfont: 'double_bass_pizz',     emoji: '🎻', i18nKey: 'double_bass_pizz' },
  { gm: 33, soundfont: 'electric_bass_finger', emoji: '🎸', i18nKey: 'electric_bass_finger' },
  { gm: 34, soundfont: 'electric_bass_pick',   emoji: '🎸', i18nKey: 'electric_bass_pick' },
  { gm: 45, soundfont: 'pizzicato_strings',    emoji: '🎻', i18nKey: 'pizzicato' },
  { gm: 52, soundfont: 'choir_aahs',           emoji: '🎤', i18nKey: 'choir' },
  // legni
  { gm: 73, soundfont: 'flute',                emoji: '🪈', i18nKey: 'flute' },
  { gm: 68, soundfont: 'oboe',                 emoji: '🎼', i18nKey: 'oboe' },
  { gm: 71, soundfont: 'clarinet',             emoji: '🎼', i18nKey: 'clarinet' },
  { gm: 70, soundfont: 'bassoon',              emoji: '🎼', i18nKey: 'bassoon' },
  // ottoni
  { gm: 56, soundfont: 'trumpet',              emoji: '🎺', i18nKey: 'trumpet' },
  { gm: 60, soundfont: 'french_horn',          emoji: '📯', i18nKey: 'horn' },
  { gm: 57, soundfont: 'trombone',             emoji: '🎺', i18nKey: 'trombone' },
  { gm: 58, soundfont: 'tuba',                 emoji: '🎺', i18nKey: 'tuba' },
  // percussioni intonate
  { gm: 47, soundfont: 'timpani',              emoji: '🥁', i18nKey: 'timpani' },
  { gm: 9,  soundfont: 'glockenspiel',         emoji: '🔔', i18nKey: 'glockenspiel' },
  { gm: 13, soundfont: 'xylophone',            emoji: '🎵', i18nKey: 'xylophone' },
  { gm: 12, soundfont: 'marimba',              emoji: '🎵', i18nKey: 'marimba' },
  { gm: 14, soundfont: 'tubular_bells',        emoji: '🔔', i18nKey: 'tubular_bells' },
];

const DEFAULT_SOUNDFONT = 'acoustic_grand_piano';

/** GM program number → soundfont name (defaults to acoustic grand piano). */
export function gmToSoundfont(gm: number | undefined): string {
  return INSTRUMENTS.find(i => i.gm === gm)?.soundfont ?? DEFAULT_SOUNDFONT;
}

/** Soundfont name → GM program number (defaults to 0). */
export function soundfontToGm(name: string | undefined): number {
  return INSTRUMENTS.find(i => i.soundfont === name)?.gm ?? 0;
}

/** GM program number → emoji glyph (defaults to piano). */
export function instrumentEmoji(gm: number | undefined): string {
  return INSTRUMENTS.find(i => i.gm === gm)?.emoji ?? '🎹';
}
