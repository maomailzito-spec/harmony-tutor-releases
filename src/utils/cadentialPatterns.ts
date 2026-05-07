/**
 * cadentialPatterns.ts — Cadential Pattern Recognizer
 *
 * Scans a sequence of chord events (root pitch-class + quality + bass)
 * and detects standard cadential formulas that imply tonicisation toward
 * a specific key.  Works entirely in pitch-class space so it does NOT
 * depend on the current Roman-numeral context (no chicken-and-egg).
 *
 * Designed to be called from `inferModulationContexts` in useHarmonyLabels.
 *
 * EXTENSIBLE: add new formulas to CADENTIAL_FORMULAS; the engine picks
 * them up automatically.
 *
 * @module cadentialPatterns
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One slot in a cadential formula (one chord). */
export interface CadentialSlot {
  /** Interval in semitones from the candidate tonic (0 = I, 2 = ii, …). */
  intervalFromTonic: number;
  /**
   * Expected chord quality family.
   * - `'major'`  → Major, Dominant 7, Major 7
   * - `'minor'`  → Minor, Minor 7, Minor-Major 7
   * - `'dim'`    → Diminished, Minor 7♭5 (half-dim), Diminished 7
   * - `'any'`    → matches any quality
   */
  quality?: 'major' | 'minor' | 'dim' | 'any';
  /**
   * Optional bass constraint: semitone interval from candidate tonic.
   * E.g. for I6/4 the root is 0 (= I) but the bass is 7 (= V).
   * Omit to skip bass checking.
   */
  bassInterval?: number;
}

/** A complete cadential formula (multiple slots). */
export interface CadentialFormula {
  /** Unique short id, e.g. `'PAC-ii-V-I'`. */
  id: string;
  /** Human-readable label. */
  name: string;
  /** Ordered chord slots. */
  slots: CadentialSlot[];
  /** Which target *mode* this formula implies. */
  targetMode: 'major' | 'minor' | 'both';
  /** Confidence bonus (0–100). Higher → more likely to trigger modulation. */
  confidence: number;
  /** If true, this is a deceptive cadence (V→vi / V→VI) — stays in current key. */
  deceptive?: boolean;
}

/** A chord event extracted from the timeline. */
export interface ChordEvent {
  /** Root pitch-class 0-11. */
  rootPc: number;
  /** Quality string as returned by identifyChord (e.g. "Major", "Minor", "Diminished", "Minor 7♭5"). */
  quality: string;
  /** Bass (lowest note) pitch-class 0-11. */
  bassPc: number;
  /** Absolute beat position. */
  absBeat: number;
  /** All distinct note pitch-classes present in the chord (for chromatic-evidence check). */
  notePcs?: number[];
}

/** A successful cadential match. */
export interface CadentialMatch {
  /** Pitch-class of the detected target tonic (0-11). */
  targetTonicPc: number;
  /** Whether the target key is minor. */
  targetIsMinor: boolean;
  /** Confidence score (from formula). */
  confidence: number;
  /** Which formula matched. */
  formulaId: string;
  /** absBeat of the *first* chord in the matched window. */
  startBeat: number;
  /** absBeat of the *last* chord (the resolution / "I"). */
  endBeat: number;
  /** True for deceptive cadences — no tonal-context change. */
  deceptive?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mod12 = (n: number): number => ((n % 12) + 12) % 12;

/**
 * Map a quality string (from identifyChord) to a quality family.
 * Returns one of `'major'`, `'minor'`, `'dim'`, or `'other'`.
 */
export function qualityFamily(q: string): 'major' | 'minor' | 'dim' | 'other' {
  const s = (q || '').toLowerCase();
  // Diminished family (must come before "minor" checks because "minor 7♭5" contains "minor")
  if (/dim|°/.test(s) || /minor\s*7\s*[♭b]5/i.test(s) || s.includes('half')) return 'dim';
  // Minor family
  if (/^min|minor/i.test(s) && !/maj/i.test(s)) return 'minor';
  // Major / dominant family
  if (/^maj|major|dominant|dom/i.test(s) || /^7$/.test(s)) return 'major';
  // Augmented or unrecognised → 'other'
  return 'other';
}

function slotMatchesQuality(slotQ: CadentialSlot['quality'], eventQ: string): boolean {
  if (!slotQ || slotQ === 'any') return true;
  const fam = qualityFamily(eventQ);
  if (slotQ === 'major') return fam === 'major';
  if (slotQ === 'minor') return fam === 'minor';
  if (slotQ === 'dim')   return fam === 'dim';
  return false;
}

// ---------------------------------------------------------------------------
// Hardcoded Formulas
// ---------------------------------------------------------------------------

/**
 * Registry of cadential formulas.
 * **Append to this array to teach the engine new patterns.**
 */
export const CADENTIAL_FORMULAS: readonly CadentialFormula[] = [
  // ---- Major-target cadences ----
  {
    id: 'PAC-ii-V-I',
    name: 'ii → V → I (Perfect Authentic)',
    slots: [
      { intervalFromTonic: 2,  quality: 'minor' },   // ii
      { intervalFromTonic: 7,  quality: 'major' },   // V
      { intervalFromTonic: 0,  quality: 'major' },   // I
    ],
    targetMode: 'major',
    confidence: 85,
  },
  {
    id: 'CAD64-V-I',
    name: 'I6/4 → V → I (Cadential 6/4)',
    slots: [
      { intervalFromTonic: 0,  quality: 'major', bassInterval: 7 },  // I6/4 (bass = V)
      { intervalFromTonic: 7,  quality: 'major' },                   // V
      { intervalFromTonic: 0,  quality: 'major' },                   // I
    ],
    targetMode: 'major',
    confidence: 90,
  },
  {
    id: 'PAC-ii-CAD64-V-I',
    name: 'ii → I6/4 → V → I (Full cadential with 6/4)',
    slots: [
      { intervalFromTonic: 2,  quality: 'minor' },                   // ii
      { intervalFromTonic: 0,  quality: 'major', bassInterval: 7 },  // I6/4
      { intervalFromTonic: 7,  quality: 'major' },                   // V
      { intervalFromTonic: 0,  quality: 'major' },                   // I
    ],
    targetMode: 'major',
    confidence: 95,
  },
  {
    id: 'PAC-IV-V-I',
    name: 'IV → V → I (Plagal approach)',
    slots: [
      { intervalFromTonic: 5,  quality: 'major' },   // IV
      { intervalFromTonic: 7,  quality: 'major' },   // V
      { intervalFromTonic: 0,  quality: 'major' },   // I
    ],
    targetMode: 'major',
    confidence: 80,
  },
  {
    id: 'HC-ii-V',
    name: 'ii → V (Half Cadence in major)',
    slots: [
      { intervalFromTonic: 2,  quality: 'minor' },   // ii
      { intervalFromTonic: 7,  quality: 'major' },   // V
    ],
    targetMode: 'major',
    confidence: 55,   // lower — only half-cadence, no resolution
  },
  // ---- Simple V→I / V→i (2-slot) ----
  {
    id: 'PAC-V-I',
    name: 'V → I (Authentic Cadence in major)',
    slots: [
      { intervalFromTonic: 7,  quality: 'major' },   // V
      { intervalFromTonic: 0,  quality: 'major' },   // I
    ],
    targetMode: 'major',
    confidence: 70,
  },
  {
    id: 'PAC-V-i',
    name: 'V → i (Authentic Cadence in minor)',
    slots: [
      { intervalFromTonic: 7,  quality: 'major' },   // V
      { intervalFromTonic: 0,  quality: 'minor' },   // i
    ],
    targetMode: 'minor',
    confidence: 70,
  },
  // ---- Minor-target cadences ----
  {
    id: 'PAC-iv-V-i',
    name: 'iv → V → i (PAC in minor)',
    slots: [
      { intervalFromTonic: 5,  quality: 'minor' },   // iv
      { intervalFromTonic: 7,  quality: 'major' },   // V
      { intervalFromTonic: 0,  quality: 'minor' },   // i
    ],
    targetMode: 'minor',
    confidence: 85,
  },
  {
    id: 'PAC-iidim-V-i',
    name: 'ii° → V → i (PAC in minor with ii°)',
    slots: [
      { intervalFromTonic: 2,  quality: 'dim' },     // ii°
      { intervalFromTonic: 7,  quality: 'major' },   // V
      { intervalFromTonic: 0,  quality: 'minor' },   // i
    ],
    targetMode: 'minor',
    confidence: 85,
  },
  {
    id: 'PAC-VI-V-i',
    name: 'VI → V → i (Deceptive approach in minor)',
    slots: [
      { intervalFromTonic: 8,  quality: 'major' },   // ♭VI (8 semitones)
      { intervalFromTonic: 7,  quality: 'major' },   // V
      { intervalFromTonic: 0,  quality: 'minor' },   // i
    ],
    targetMode: 'minor',
    confidence: 75,
  },
  // ---- V6 (first inversion, bass = leading tone) cadences ----
  {
    id: 'PAC-ii-V6-I',
    name: 'ii → V6 → I (with V in 1st inversion)',
    slots: [
      { intervalFromTonic: 2,  quality: 'minor' },                  // ii
      { intervalFromTonic: 7,  quality: 'major', bassInterval: 11 }, // V6 (bass = LT)
      { intervalFromTonic: 0,  quality: 'major' },                  // I
    ],
    targetMode: 'major',
    confidence: 82,
  },
  {
    id: 'PAC-IV-V6-I',
    name: 'IV → V6 → I (with V in 1st inversion)',
    slots: [
      { intervalFromTonic: 5,  quality: 'major' },                  // IV
      { intervalFromTonic: 7,  quality: 'major', bassInterval: 11 }, // V6 (bass = LT)
      { intervalFromTonic: 0,  quality: 'major' },                  // I
    ],
    targetMode: 'major',
    confidence: 78,
  },
  {
    id: 'PAC-iv-V6-i',
    name: 'iv → V6 → i (minor, V in 1st inversion)',
    slots: [
      { intervalFromTonic: 5,  quality: 'minor' },                  // iv
      { intervalFromTonic: 7,  quality: 'major', bassInterval: 11 }, // V6 (bass = LT)
      { intervalFromTonic: 0,  quality: 'minor' },                  // i
    ],
    targetMode: 'minor',
    confidence: 82,
  },
  {
    id: 'PAC-iidim-V6-i',
    name: 'ii° → V6 → i (minor, V in 1st inversion)',
    slots: [
      { intervalFromTonic: 2,  quality: 'dim' },                    // ii°
      { intervalFromTonic: 7,  quality: 'major', bassInterval: 11 }, // V6 (bass = LT)
      { intervalFromTonic: 0,  quality: 'minor' },                  // i
    ],
    targetMode: 'minor',
    confidence: 82,
  },
  // ── Deceptive cadences (cadenza d'inganno) ──
  {
    id: 'DC-V-vi',
    name: 'V → vi (deceptive, major)',
    slots: [
      { intervalFromTonic: 7, quality: 'major' },
      { intervalFromTonic: 9, quality: 'minor' },
    ],
    targetMode: 'major',
    confidence: 70,
    deceptive: true,
  },
  {
    id: 'DC-ii-V-vi',
    name: 'ii → V → vi (deceptive, major)',
    slots: [
      { intervalFromTonic: 2, quality: 'minor' },
      { intervalFromTonic: 7, quality: 'major' },
      { intervalFromTonic: 9, quality: 'minor' },
    ],
    targetMode: 'major',
    confidence: 75,
    deceptive: true,
  },
  {
    id: 'DC-IV-V-vi',
    name: 'IV → V → vi (deceptive, major)',
    slots: [
      { intervalFromTonic: 5, quality: 'major' },
      { intervalFromTonic: 7, quality: 'major' },
      { intervalFromTonic: 9, quality: 'minor' },
    ],
    targetMode: 'major',
    confidence: 75,
    deceptive: true,
  },
  {
    id: 'DC-V-VI',
    name: 'V → VI (deceptive, minor)',
    slots: [
      { intervalFromTonic: 7, quality: 'major' },
      { intervalFromTonic: 8, quality: 'major' },
    ],
    targetMode: 'minor',
    confidence: 70,
    deceptive: true,
  },
  {
    id: 'DC-iv-V-VI',
    name: 'iv → V → VI (deceptive, minor)',
    slots: [
      { intervalFromTonic: 5, quality: 'minor' },
      { intervalFromTonic: 7, quality: 'major' },
      { intervalFromTonic: 8, quality: 'major' },
    ],
    targetMode: 'minor',
    confidence: 75,
    deceptive: true,
  },
] as const;

// ---------------------------------------------------------------------------
// Main evaluator
// ---------------------------------------------------------------------------

/**
 * Scan a sequence of chord events for cadential formulas.
 *
 * For each sliding window of length `formula.slots.length`, the function
 * tries ALL 24 candidate tonics (12 major + 12 minor) and checks whether
 * the window matches the formula relative to that tonic.
 *
 * Only matches that point to a **different** tonic than `currentTonicPc`
 * (or a different mode) are returned — we're looking for *tonicisations*,
 * not confirmations of the home key.
 *
 * @param chordEvents  Ordered array of chord events from the timeline.
 * @param currentTonicPc  Current home-key tonic pitch-class (0-11).
 * @param currentIsMinor  Whether the current home key is minor.
 * @param opts.minConfidence  Minimum confidence to report (default 60).
 * @returns  Array of cadential matches, sorted by `startBeat`.
 */
export function evaluateCadentialPatterns(
  chordEvents: readonly ChordEvent[],
  currentTonicPc: number,
  currentIsMinor: boolean,
  opts?: { minConfidence?: number },
): CadentialMatch[] {
  const minConf = opts?.minConfidence ?? 60;
  const matches: CadentialMatch[] = [];
  if (chordEvents.length < 2) return matches;

  for (const formula of CADENTIAL_FORMULAS) {
    const len = formula.slots.length;
    if (chordEvents.length < len) continue;

    // Slide a window of `len` events across the timeline
    for (let wi = 0; wi <= chordEvents.length - len; wi++) {
      const window = chordEvents.slice(wi, wi + len);

      // Try all 12 candidate tonics for the formula's targetMode
      const modes: boolean[] =
        formula.targetMode === 'major' ? [false] :
        formula.targetMode === 'minor' ? [true]  :
        [false, true];

      for (const isMinorTarget of modes) {
        for (let candidateTonic = 0; candidateTonic < 12; candidateTonic++) {
          // Skip if this IS the current home key — unless formula is deceptive
          // (deceptive cadences resolve in the SAME key, e.g. V → vi).
          if (candidateTonic === currentTonicPc && isMinorTarget === currentIsMinor
              && !(formula as any).deceptive) continue;

          // Check all slots
          let allMatch = true;
          for (let si = 0; si < len; si++) {
            const slot = formula.slots[si];
            const ev   = window[si];

            // Root pitch-class check
            const expectedRootPc = mod12(candidateTonic + slot.intervalFromTonic);
            if (ev.rootPc !== expectedRootPc) { allMatch = false; break; }

            // Quality check
            if (!slotMatchesQuality(slot.quality, ev.quality)) { allMatch = false; break; }

            // A chord with a major 7th (e.g. Ebmaj7) on a dominant slot (V)
            // is not a real dominant — dominants have minor 7ths.
            if (slot.intervalFromTonic === 7 && /maj.*7|major\s*7/i.test(ev.quality)) {
              allMatch = false; break;
            }

            // Bass check (optional)
            if (slot.bassInterval !== undefined) {
              const expectedBassPc = mod12(candidateTonic + slot.bassInterval);
              if (ev.bassPc !== expectedBassPc) { allMatch = false; break; }
            }
          }

          if (allMatch && formula.confidence >= minConf) {
            // ── Guard: reject foreign-key matches whose arrival chord is
            // fully diatonic to the home key.  A genuine tonicisation
            // target will contain at least one chromatic note; without it,
            // matches like V → iii being read as V → I / Dm are false
            // positives (e.g. F → Dm in Bb major ≠ V → I in Dm).
            // Exception: the relative major/minor shares the entire
            // diatonic collection, so tonicisations to III (from minor)
            // or vi (from major) are allowed even without chromatic evidence.
            if (candidateTonic !== currentTonicPc) {
              const isRelativeKey = (
                (currentIsMinor && !isMinorTarget && candidateTonic === mod12(currentTonicPc + 3)) ||
                (!currentIsMinor && isMinorTarget && candidateTonic === mod12(currentTonicPc + 9))
              );
              const homeScale = new Set(getScalePcs(currentTonicPc, currentIsMinor));
              // Check only the arrival chord (last in window) — earlier
              // chromatic events (e.g. V/V) must not fool the guard.
              const arrival = window[window.length - 1];
              const arrivalDiatonic = arrival
                ? (arrival.notePcs ? arrival.notePcs.every(pc => homeScale.has(pc))
                                   : homeScale.has(arrival.rootPc))
                : false;
              // Also check if the dominant slot (penultimate) has chromatic
              // evidence — e.g. V/ii contains A♮ in Ab major.  If so, the
              // tonicisation is real even if the arrival chord is diatonic.
              const dominantHasChromaticEvidence = window.length >= 2
                ? (() => {
                    const dom = window[window.length - 2];
                    return dom?.notePcs?.some(pc => !homeScale.has(pc)) ?? false;
                  })()
                : false;
              if (arrivalDiatonic && !isRelativeKey && !dominantHasChromaticEvidence) continue;
            }

            matches.push({
              targetTonicPc: candidateTonic,
              targetIsMinor: isMinorTarget,
              confidence:    formula.confidence,
              formulaId:     formula.id,
              startBeat:     window[0].absBeat,
              endBeat:       window[len - 1].absBeat,
              deceptive:     !!(formula as any).deceptive,
            });
          }
        }
      }
    }
  }

  // De-duplicate: keep highest confidence per (targetTonic, endBeat)
  const best = new Map<string, CadentialMatch>();
  for (const m of matches) {
    const key = `${m.targetTonicPc}:${m.targetIsMinor ? 'm' : 'M'}:${m.endBeat}`;
    const existing = best.get(key);
    if (!existing || m.confidence > existing.confidence) best.set(key, m);
  }

  return [...best.values()].sort((a, b) => a.startBeat - b.startBeat);
}

// ---------------------------------------------------------------------------
// Utility: pitch-class ↔ note name
// ---------------------------------------------------------------------------

const PC_TO_NOTE: readonly string[] = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Convert a pitch-class (0-11) to a note name suitable for the tonic field. */
export function pcToNoteName(pc: number): string {
  return PC_TO_NOTE[mod12(pc)] ?? 'C';
}

/**
 * Returns the set of pitch-classes belonging to a key's scale.
 * For minor keys the union of natural + harmonic + melodic ascending is used,
 * so that only truly chromatic notes (e.g. D# in Am) are flagged.
 */
export function getScalePcs(tonicPc: number, isMinor: boolean): number[] {
  const intervals = isMinor
    ? [0, 2, 3, 5, 7, 8, 9, 10, 11]   // natural ∪ harmonic ∪ melodic asc
    : [0, 2, 4, 5, 7, 9, 11];          // major
  return intervals.map(i => (tonicPc + i) % 12);
}

import { NOTE_TO_PC, noteNameToPc as _noteNameToPcBase } from './spelledPitch';

/** Convert a note name to a pitch-class (0-11).  Returns 0 on failure. */
export function noteNameToPc(name: string): number {
  return _noteNameToPcBase(name);
}
