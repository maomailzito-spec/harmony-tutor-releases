/**
 * Modal Interchange detection module.
 *
 * Determines whether a chord is a "borrowed chord" from the parallel minor
 * (or other modes) rather than evidence of a tonicization.
 *
 * Usage: call `isBorrowedChord()` before the tonicization detectors to
 * prevent them from overwriting correct diatonic-minor labels (iv, ♭VI, …).
 */

import { qualityFamily, noteNameToPc } from './cadentialPatterns';

// ── Borrowed-chord table (from parallel minor into major) ──────────────────
//
// Each entry maps a chromatic interval above the major tonic to the expected
// chord quality family and the conventional roman-numeral label.
//
// Source: parallel natural minor (Aeolian).
// Example in C major: borrowed from C minor → D°, E♭, Fm, A♭, B♭.

interface BorrowedEntry {
  /** Semitones above the major tonic (0–11). */
  interval: number;
  /** Expected quality family ('major' | 'minor' | 'dim'). */
  qualityFamily: 'major' | 'minor' | 'dim';
  /** Conventional label in the major context. */
  label: string;
}

const BORROWED_FROM_PARALLEL_MINOR: readonly BorrowedEntry[] = [
  { interval: 1,  qualityFamily: 'major', label: '♭II' },   // Neapolitan / ♭II
  { interval: 3,  qualityFamily: 'major', label: '♭III' },
  { interval: 5,  qualityFamily: 'minor', label: 'iv' },
  { interval: 8,  qualityFamily: 'major', label: '♭VI' },
  { interval: 10, qualityFamily: 'major', label: '♭VII' },
  { interval: 2,  qualityFamily: 'dim',   label: 'ii°' },   // common in minor
];

// ── Public API ─────────────────────────────────────────────────────────────

export interface BorrowedChordInfo {
  isBorrowed: boolean;
  label: string | null;
}

/**
 * Returns whether the chord (given by root pitch-class and quality string)
 * is a borrowed chord from the parallel minor, assuming we are in a MAJOR key.
 *
 * Only applies when `isMinorMode` is false — in minor keys the same chords
 * are already diatonic and no "borrowing" is needed.
 */
export function isBorrowedChord(
  rootPc: number,
  quality: string,
  tonicPc: number,
  isMinorMode: boolean,
): BorrowedChordInfo {
  // Only relevant in major keys
  if (isMinorMode) return { isBorrowed: false, label: null };

  const interval = ((rootPc - tonicPc) % 12 + 12) % 12;
  const fam = qualityFamily(quality);

  for (const entry of BORROWED_FROM_PARALLEL_MINOR) {
    if (entry.interval === interval && entry.qualityFamily === fam) {
      return { isBorrowed: true, label: entry.label };
    }
  }

  return { isBorrowed: false, label: null };
}

/**
 * Check whether a chord resolving as "I" in a candidate key is actually
 * a borrowed chord in the home key. If so, the tonicization should be
 * suppressed because the chord is better explained as modal interchange.
 *
 * @param resRootPc  Root pitch-class of the resolution chord
 * @param resQuality Quality string of the resolution chord
 * @param homeTonic  Home key tonic (note name, e.g. 'G')
 * @param homeIsMinor Whether the home key is minor
 * @returns true if the resolution chord is a borrowed chord and the
 *          tonicization should be blocked.
 */
export function shouldBlockTonicization(
  resRootPc: number,
  resQuality: string,
  homeTonic: string,
  homeIsMinor: boolean,
): boolean {
  const homePc = noteNameToPc(homeTonic);
  if (homePc < 0) return false;

  const info = isBorrowedChord(resRootPc, resQuality, homePc, homeIsMinor);
  return info.isBorrowed;
}
