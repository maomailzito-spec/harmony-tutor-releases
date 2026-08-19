/**
 * LE ARMATURE, CON TUTT'E DUE LE TONALITÀ CHE LE USANO.
 *
 * Un'armatura non individua una tonalità: tre bemolli sono Mi♭ maggiore E Do minore.
 * Ogni comando che fa scegliere un'armatura deve quindi mostrare LA COPPIA — è
 * quello che fa la barra dei comandi con «E♭ Mag / C min» — altrimenti chi vuole
 * Do minore deve sapere per conto suo che gli tocca scegliere «E♭» e poi «min»,
 * che è esattamente l'ambiguità segnalata sulla tavolozza.
 *
 * Il `value` è la FONDAMENTALE MAGGIORE, che è ciò che l'applicazione chiama
 * `keySignatureRoot` anche quando il brano è in minore (Dm → 'F'): qui non si
 * cambia niente, si cambia solo quello che si legge.
 *
 * L'elenco stava scritto due volte, uguale, in GrandStaffEditor e nel menù di
 * modulazione; la tavolozza ne aveva un terzo, coi soli nomi delle note.
 */
export type KeySignatureOption = {
  /** Fondamentale maggiore dell'armatura (il `keySignatureRoot` dell'app). */
  value: string;
  /** Il relativo minore, per quando si sceglie il modo minore. */
  minor: string;
  /** Etichetta piena, col conto delle alterazioni: per i menù larghi. */
  label: string;
  /** Solo la coppia: per i pannelli stretti, dove il conto verrebbe troncato. */
  labelShort: string;
};

export const KEY_SIGNATURE_OPTIONS: KeySignatureOption[] = [
  { value: 'C',  minor: 'A',  label: 'C Mag / A min (0 ♯/♭)',   labelShort: 'C Mag / A min' },
  { value: 'G',  minor: 'E',  label: 'G Mag / E min (1 ♯)',      labelShort: 'G Mag / E min' },
  { value: 'D',  minor: 'B',  label: 'D Mag / B min (2 ♯)',      labelShort: 'D Mag / B min' },
  { value: 'A',  minor: 'F#', label: 'A Mag / F♯ min (3 ♯)',     labelShort: 'A Mag / F♯ min' },
  { value: 'E',  minor: 'C#', label: 'E Mag / C♯ min (4 ♯)',     labelShort: 'E Mag / C♯ min' },
  { value: 'B',  minor: 'G#', label: 'B Mag / G♯ min (5 ♯)',     labelShort: 'B Mag / G♯ min' },
  { value: 'F#', minor: 'D#', label: 'F♯ Mag / D♯ min (6 ♯)',    labelShort: 'F♯ Mag / D♯ min' },
  { value: 'C#', minor: 'A#', label: 'C♯ Mag / A♯ min (7 ♯)',    labelShort: 'C♯ Mag / A♯ min' },
  { value: 'F',  minor: 'D',  label: 'F Mag / D min (1 ♭)',      labelShort: 'F Mag / D min' },
  { value: 'Bb', minor: 'G',  label: 'B♭ Mag / G min (2 ♭)',     labelShort: 'B♭ Mag / G min' },
  { value: 'Eb', minor: 'C',  label: 'E♭ Mag / C min (3 ♭)',     labelShort: 'E♭ Mag / C min' },
  { value: 'Ab', minor: 'F',  label: 'A♭ Mag / F min (4 ♭)',     labelShort: 'A♭ Mag / F min' },
  { value: 'Db', minor: 'Bb', label: 'D♭ Mag / B♭ min (5 ♭)',    labelShort: 'D♭ Mag / B♭ min' },
  { value: 'Gb', minor: 'Eb', label: 'G♭ Mag / E♭ min (6 ♭)',    labelShort: 'G♭ Mag / E♭ min' },
  { value: 'Cb', minor: 'Ab', label: 'C♭ Mag / A♭ min (7 ♭)',    labelShort: 'C♭ Mag / A♭ min' },
];

const SHARP_VALUES = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const FLAT_VALUES  = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];

export const SHARP_KEY_OPTIONS = KEY_SIGNATURE_OPTIONS.filter(k => SHARP_VALUES.includes(k.value));
export const FLAT_KEY_OPTIONS  = KEY_SIGNATURE_OPTIONS.filter(k => FLAT_VALUES.includes(k.value));

/** Il nome della tonalità scelta davvero: la fondamentale se maggiore, il relativo
 *  minore se minore. Serve a non scrivere «E♭m» dove si intende «Cm». */
export function tonicName(majorRoot: string, isMinor: boolean): string {
  if (!isMinor) return majorRoot;
  return KEY_SIGNATURE_OPTIONS.find(k => k.value === majorRoot)?.minor ?? majorRoot;
}
