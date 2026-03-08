/**
 * Chorale Style Profile — Adaptive Learning Engine
 *
 * Extracts voice-leading and inversion statistics from user-written chorales
 * and provides capped bonuses to modulate scoreVoicing() costs.
 *
 * GUARDRAILS:
 *   1. Safety Caps: all bonuses capped at ±30 — structural penalties always win.
 *   2. Confidence Smoothing: <MIN_SAMPLES → linear blend toward 0 (defaults).
 *   3. Echo Chamber Prevention: extraction only on explicit user action.
 */

import type { TimeSignature } from '../types';

// ─── Constants ─────────────────────────────────────────────────────────────

/** Minimum number of observations before a statistic is trusted. */
const MIN_SAMPLES = 5;

/** Maximum absolute bonus/penalty from the style profile. */
const MAX_BONUS = 30;

// ─── Types ─────────────────────────────────────────────────────────────────

/** Per-degree inversion distribution. */
export interface InversionStats {
  /** counts[inversion] = number of times this inversion was used for this degree */
  counts: Record<number, number>;
  /** Total observations for this degree */
  total: number;
}

/** Per-voice motion distribution (counts, not percentages). */
export interface MotionStats {
  commonTone: number;
  step: number;   // 1-2 semitones
  skip: number;   // 3-4 semitones
  leap: number;   // 5+ semitones
  total: number;
}

/** Doubling distribution (counts). */
export interface DoublingStats {
  root: number;
  third: number;
  fifth: number;
  total: number;
}

/** Contrary motion between outer voices (counts). */
export interface ContraryMotionStats {
  contrary: number;
  parallel: number;
  oblique: number;
  total: number;
}

/** Bass motion statistics. */
export interface BassMotionStats {
  sumSemitones: number;
  count: number;
}

/** Complete style profile extracted from user chorales. */
export interface StyleProfile {
  inversionByDegree: Record<string, InversionStats>;
  motionByVoice: Record<string, MotionStats>;
  contraryMotion: ContraryMotionStats;
  bassMotion: BassMotionStats;
  doubling: DoublingStats;
  /** Bigram counts: romanBigrams[prevRoman][currRoman] = count */
  romanBigrams?: Record<string, Record<string, number>>;
  /** ISO timestamp of last extraction */
  lastUpdated: string;
  /** Number of files/excerpts analyzed */
  filesAnalyzed: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const DIATONIC_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function noteNameToPc(name: string): number {
  const letter = name.charAt(0).toUpperCase();
  const base = DIATONIC_PC[letter];
  if (base == null) return 0;
  const rest = name.slice(1);
  let offset = 0;
  for (const c of rest) {
    if (c === '#' || c === '♯') offset++;
    else if (c === 'b' || c === '♭') offset--;
  }
  return ((base + offset) % 12 + 12) % 12;
}

/** Build the 7 scale degree pitch classes for major or natural minor. */
function buildScalePcs(tonic: string, isMinor: boolean): number[] {
  const root = noteNameToPc(tonic);
  const intervals = isMinor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  return intervals.map(i => (root + i) % 12);
}

/** Classify motion in semitones. */
function classifyMotion(semitones: number): 'commonTone' | 'step' | 'skip' | 'leap' {
  if (semitones === 0) return 'commonTone';
  if (semitones <= 2) return 'step';
  if (semitones <= 4) return 'skip';
  return 'leap';
}

/** Map a pitch class to the nearest scale degree (0-6). */
function pcToScaleDegree(pc: number, scalePcs: number[]): number {
  for (let i = 0; i < scalePcs.length; i++) {
    if (scalePcs[i] === pc) return i;
  }
  // Chromatic — find nearest
  let best = 0;
  let bestDist = 12;
  for (let i = 0; i < scalePcs.length; i++) {
    const d = Math.min(Math.abs(pc - scalePcs[i]), 12 - Math.abs(pc - scalePcs[i]));
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

/** Standard roman numeral names for scale degrees. */
const DEGREE_NAMES_MAJOR = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
const DEGREE_NAMES_MINOR = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];

function degreeName(degree: number, isMinor: boolean): string {
  const names = isMinor ? DEGREE_NAMES_MINOR : DEGREE_NAMES_MAJOR;
  return names[degree % 7] || `${degree}`;
}

// ─── Extraction ────────────────────────────────────────────────────────────

/** A vertical snapshot at a single beat. */
interface BeatSnapshot {
  bass: number;    // MIDI
  tenor: number;
  alto: number;
  soprano: number;
  /** Pitch classes present (size 3 or 4). */
  pcs: Set<number>;
  /** Root pitch class (lowest unique PC). */
  rootPc: number;
  /** Inversion: 0 = root in bass, 1 = third, 2 = fifth. */
  inversion: number;
  /** Scale degree of the root (0-6). */
  degree: number;
}

/**
 * Extract a StyleProfile from a set of notes (from a single .htp file).
 *
 * The notes must be a 4-voice SATB arrangement (voices 1-4).
 * Works best with chorale-style writing; non-4-voice textures are skipped.
 */
export function extractStyleProfile(
  notes: any[],
  tonic: string,
  isMinor: boolean,
  timeSignature: TimeSignature,
): StyleProfile {
  const profile = createEmptyProfile();
  const scalePcs = buildScalePcs(tonic, isMinor);
  const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);

  // Group notes by absolute beat → SATB snapshot
  const byAbsBeat = new Map<number, Map<number, number>>(); // absBeat → voice → midi
  for (const n of (notes || [])) {
    if (!n || n.isRest) continue;
    const mi = Number(n.measureIndex ?? 0);
    const bt = Number(n.beat ?? 1);
    const abs = mi * beatsPerMeasure + bt;
    const q = Math.round(abs * 192) / 192;
    const voice = Number(n.voice ?? 0);
    if (voice < 1 || voice > 4) continue;
    const midi = Number(n.midi);
    if (!Number.isFinite(midi)) continue;
    if (!byAbsBeat.has(q)) byAbsBeat.set(q, new Map());
    byAbsBeat.get(q)!.set(voice, midi);
  }

  // Build sorted snapshots (only complete 4-voice beats)
  const sortedBeats = [...byAbsBeat.keys()].sort((a, b) => a - b);
  const snapshots: BeatSnapshot[] = [];

  for (const ab of sortedBeats) {
    const voices = byAbsBeat.get(ab)!;
    if (voices.size < 4) continue; // Need all 4 voices

    const soprano = voices.get(1)!;
    const alto = voices.get(2)!;
    const tenor = voices.get(3)!;
    const bass = voices.get(4)!;

    const pcs = new Set([soprano, alto, tenor, bass].map(m => ((m % 12) + 12) % 12));
    const bassPc = ((bass % 12) + 12) % 12;

    // Determine root: find which chord tone the bass note represents
    // Try each scale degree as potential root
    let rootPc = bassPc;
    let inversion = 0;
    let degree = pcToScaleDegree(bassPc, scalePcs);

    // Simple root detection: try to build a triad from scale degrees
    // and see which root explains the bass position
    for (let d = 0; d < 7; d++) {
      const root = scalePcs[d];
      const third = scalePcs[(d + 2) % 7];
      const fifth = scalePcs[(d + 4) % 7];
      const triadPcs = new Set([root, third, fifth]);

      // Check if most of our PCs match this triad
      let matchCount = 0;
      for (const pc of pcs) {
        if (triadPcs.has(pc)) matchCount++;
      }
      if (matchCount < 3) continue; // Need at least 3 matching PCs

      rootPc = root;
      degree = d;
      if (bassPc === root) inversion = 0;
      else if (bassPc === third) inversion = 1;
      else if (bassPc === fifth) inversion = 2;
      else inversion = 0;
      break;
    }

    snapshots.push({ bass, tenor, alto, soprano, pcs, rootPc, inversion, degree });
  }

  // ── Analyze snapshots ──

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    const degreeKey = degreeName(snap.degree, isMinor);

    // --- Inversion stats ---
    if (!profile.inversionByDegree[degreeKey]) {
      profile.inversionByDegree[degreeKey] = { counts: {}, total: 0 };
    }
    const invStats = profile.inversionByDegree[degreeKey];
    invStats.counts[snap.inversion] = (invStats.counts[snap.inversion] || 0) + 1;
    invStats.total++;

    // --- Doubling stats ---
    const midiArr = [snap.bass, snap.tenor, snap.alto, snap.soprano];
    const pcArr = midiArr.map(m => ((m % 12) + 12) % 12);
    const rootPc = snap.rootPc;
    const thirdPc = scalePcs[(snap.degree + 2) % 7];
    const fifthPc = scalePcs[(snap.degree + 4) % 7];

    for (const pc of pcArr) {
      if (pc === rootPc) profile.doubling.root++;
      else if (pc === thirdPc) profile.doubling.third++;
      else if (pc === fifthPc) profile.doubling.fifth++;
    }
    profile.doubling.total += 4; // 4 voices

    // --- Motion stats (need previous snapshot) ---
    if (i === 0) continue;
    const prev = snapshots[i - 1];
    const voiceNames = ['soprano', 'alto', 'tenor', 'bass'] as const;
    const currMidi = [snap.soprano, snap.alto, snap.tenor, snap.bass];
    const prevMidi = [prev.soprano, prev.alto, prev.tenor, prev.bass];

    for (let v = 0; v < 4; v++) {
      const dist = Math.abs(currMidi[v] - prevMidi[v]);
      const motionType = classifyMotion(dist);
      const vName = voiceNames[v];
      if (!profile.motionByVoice[vName]) {
        profile.motionByVoice[vName] = { commonTone: 0, step: 0, skip: 0, leap: 0, total: 0 };
      }
      profile.motionByVoice[vName][motionType]++;
      profile.motionByVoice[vName].total++;
    }

    // --- Bass motion ---
    const bassDist = Math.abs(snap.bass - prev.bass);
    profile.bassMotion.sumSemitones += bassDist;
    profile.bassMotion.count++;

    // --- Contrary motion (outer voices) ---
    const sopDir = Math.sign(snap.soprano - prev.soprano);
    const bassDir = Math.sign(snap.bass - prev.bass);
    if (sopDir !== 0 && bassDir !== 0) {
      if (sopDir !== bassDir) profile.contraryMotion.contrary++;
      else profile.contraryMotion.parallel++;
    } else if (sopDir !== 0 || bassDir !== 0) {
      profile.contraryMotion.oblique++;
    }
    profile.contraryMotion.total++;
  }

  // --- Roman bigrams ---
  const DEGREE_NAMES_MAJOR = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
  const DEGREE_NAMES_MINOR = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];
  const degName = (d: number) => (isMinor ? DEGREE_NAMES_MINOR : DEGREE_NAMES_MAJOR)[d % 7] || `${d}`;
  profile.romanBigrams = {};
  for (let i = 1; i < snapshots.length; i++) {
    const prev = degName(snapshots[i - 1].degree);
    const curr = degName(snapshots[i].degree);
    if (!profile.romanBigrams[prev]) profile.romanBigrams[prev] = {};
    profile.romanBigrams[prev][curr] = (profile.romanBigrams[prev][curr] || 0) + 1;
  }

  profile.filesAnalyzed = 1;
  profile.lastUpdated = new Date().toISOString();
  return profile;
}

// ─── Profile Management ────────────────────────────────────────────────────

/** Create a zeroed-out profile. */
export function createEmptyProfile(): StyleProfile {
  return {
    inversionByDegree: {},
    motionByVoice: {
      soprano: { commonTone: 0, step: 0, skip: 0, leap: 0, total: 0 },
      alto:    { commonTone: 0, step: 0, skip: 0, leap: 0, total: 0 },
      tenor:   { commonTone: 0, step: 0, skip: 0, leap: 0, total: 0 },
      bass:    { commonTone: 0, step: 0, skip: 0, leap: 0, total: 0 },
    },
    contraryMotion: { contrary: 0, parallel: 0, oblique: 0, total: 0 },
    bassMotion: { sumSemitones: 0, count: 0 },
    doubling: { root: 0, third: 0, fifth: 0, total: 0 },
    romanBigrams: {},
    lastUpdated: '',
    filesAnalyzed: 0,
  };
}

/**
 * Merge a new profile into an existing cumulative profile.
 * This allows learning from multiple files incrementally.
 */
export function mergeProfiles(existing: StyleProfile | null, incoming: StyleProfile): StyleProfile {
  if (!existing) return { ...incoming };

  const merged = createEmptyProfile();

  // Merge inversion stats
  const allDegrees = new Set([
    ...Object.keys(existing.inversionByDegree),
    ...Object.keys(incoming.inversionByDegree),
  ]);
  for (const deg of allDegrees) {
    const e = existing.inversionByDegree[deg];
    const n = incoming.inversionByDegree[deg];
    merged.inversionByDegree[deg] = { counts: {}, total: 0 };
    const allInv = new Set([
      ...Object.keys(e?.counts || {}),
      ...Object.keys(n?.counts || {}),
    ]);
    for (const inv of allInv) {
      const ni = Number(inv);
      merged.inversionByDegree[deg].counts[ni] =
        ((e?.counts[ni]) || 0) + ((n?.counts[ni]) || 0);
    }
    merged.inversionByDegree[deg].total = (e?.total || 0) + (n?.total || 0);
  }

  // Merge motion stats
  for (const voice of ['soprano', 'alto', 'tenor', 'bass'] as const) {
    const e = existing.motionByVoice[voice] || { commonTone: 0, step: 0, skip: 0, leap: 0, total: 0 };
    const n = incoming.motionByVoice[voice] || { commonTone: 0, step: 0, skip: 0, leap: 0, total: 0 };
    merged.motionByVoice[voice] = {
      commonTone: e.commonTone + n.commonTone,
      step: e.step + n.step,
      skip: e.skip + n.skip,
      leap: e.leap + n.leap,
      total: e.total + n.total,
    };
  }

  // Merge contrary motion
  merged.contraryMotion = {
    contrary: existing.contraryMotion.contrary + incoming.contraryMotion.contrary,
    parallel: existing.contraryMotion.parallel + incoming.contraryMotion.parallel,
    oblique: existing.contraryMotion.oblique + incoming.contraryMotion.oblique,
    total: existing.contraryMotion.total + incoming.contraryMotion.total,
  };

  // Merge bass motion
  merged.bassMotion = {
    sumSemitones: existing.bassMotion.sumSemitones + incoming.bassMotion.sumSemitones,
    count: existing.bassMotion.count + incoming.bassMotion.count,
  };

  // Merge doubling
  merged.doubling = {
    root: existing.doubling.root + incoming.doubling.root,
    third: existing.doubling.third + incoming.doubling.third,
    fifth: existing.doubling.fifth + incoming.doubling.fifth,
    total: existing.doubling.total + incoming.doubling.total,
  };

  // Merge roman bigrams
  merged.romanBigrams = {};
  for (const src of [existing.romanBigrams || {}, incoming.romanBigrams || {}]) {
    for (const prev of Object.keys(src)) {
      if (!merged.romanBigrams[prev]) merged.romanBigrams[prev] = {};
      for (const curr of Object.keys(src[prev])) {
        merged.romanBigrams[prev][curr] = (merged.romanBigrams[prev][curr] || 0) + (src[prev][curr] || 0);
      }
    }
  }

  merged.filesAnalyzed = existing.filesAnalyzed + incoming.filesAnalyzed;
  merged.lastUpdated = new Date().toISOString();
  return merged;
}

// ─── Bonus Calculators (with Guardrails) ───────────────────────────────────

/**
 * Confidence weight: linearly scales from 0 (no data) to 1 (≥MIN_SAMPLES).
 * This prevents overfitting on sparse data.
 */
function confidenceWeight(sampleCount: number): number {
  if (sampleCount <= 0) return 0;
  return Math.min(1, sampleCount / MIN_SAMPLES);
}

/**
 * Cap a bonus to the safe range [-MAX_BONUS, +MAX_BONUS].
 * Structural penalties (crossing, parallel, incomplete) are MUCH larger,
 * so the style bonus can NEVER compensate them.
 */
function capBonus(raw: number): number {
  return Math.max(-MAX_BONUS, Math.min(MAX_BONUS, raw));
}

/**
 * Get a cost bonus for using a specific inversion on a given degree.
 *
 * - Positive deviation from baseline → negative bonus (prefer this inversion)
 * - Negative deviation → positive bonus (avoid this inversion)
 *
 * The baseline assumption is uniform distribution: 33% each for triad (0,1,2).
 */
export function getInversionBonus(
  profile: StyleProfile | null | undefined,
  degree: string,
  inversion: number,
): number {
  if (!profile) return 0;
  const stats = profile.inversionByDegree[degree];
  if (!stats || stats.total <= 0) return 0;

  const weight = confidenceWeight(stats.total);
  if (weight === 0) return 0;

  const observed = (stats.counts[inversion] || 0) / stats.total;
  const baseline = 1 / 3; // uniform prior for 3 positions (root, 1st, 2nd)
  const deviation = observed - baseline; // positive = user prefers this

  // Scale: deviation of +0.33 (max possible) → bonus of -MAX_BONUS
  const rawBonus = -deviation * MAX_BONUS / 0.34;
  return capBonus(rawBonus * weight);
}

/**
 * Get a cost bonus for a specific motion type in a given voice.
 *
 * Baselines (typical chorale):
 *   soprano:  commonTone 15%, step 55%, skip 25%, leap 5%
 *   alto:     commonTone 25%, step 50%, skip 20%, leap 5%
 *   tenor:    commonTone 25%, step 50%, skip 20%, leap 5%
 *   bass:     commonTone 10%, step 30%, skip 35%, leap 25%
 */
const MOTION_BASELINES: Record<string, Record<string, number>> = {
  soprano: { commonTone: 0.15, step: 0.55, skip: 0.25, leap: 0.05 },
  alto:    { commonTone: 0.25, step: 0.50, skip: 0.20, leap: 0.05 },
  tenor:   { commonTone: 0.25, step: 0.50, skip: 0.20, leap: 0.05 },
  bass:    { commonTone: 0.10, step: 0.30, skip: 0.35, leap: 0.25 },
};

export function getMotionBonus(
  profile: StyleProfile | null | undefined,
  voice: string,
  motionType: 'commonTone' | 'step' | 'skip' | 'leap',
): number {
  if (!profile) return 0;
  const stats = profile.motionByVoice[voice];
  if (!stats || stats.total <= 0) return 0;

  const weight = confidenceWeight(stats.total);
  if (weight === 0) return 0;

  const observed = stats[motionType] / stats.total;
  const baseline = MOTION_BASELINES[voice]?.[motionType] ?? 0.25;
  const deviation = observed - baseline;

  // Scale: deviation of +0.5 → bonus of -MAX_BONUS
  const rawBonus = -deviation * MAX_BONUS / 0.5;
  return capBonus(rawBonus * weight);
}

/**
 * Get a cost bonus for contrary motion between outer voices.
 */
export function getContraryMotionBonus(profile: StyleProfile | null | undefined): number {
  if (!profile) return 0;
  const stats = profile.contraryMotion;
  if (!stats || stats.total <= 0) return 0;

  const weight = confidenceWeight(stats.total);
  if (weight === 0) return 0;

  const observed = stats.contrary / stats.total;
  const baseline = 0.45; // typical chorale: ~45% contrary motion
  const deviation = observed - baseline;

  // If user uses MORE contrary motion than baseline → amplify the existing bonus
  // Positive deviation → negative bonus (more cost reduction for contrary motion)
  const rawBonus = -deviation * MAX_BONUS / 0.5;
  return capBonus(rawBonus * weight);
}

/**
 * Get the bigram probability P(currRoman | prevRoman) from the corpus.
 * Returns a value in [0, 1], or 0 if no data for that bigram.
 */
export function getBigramProbability(
  profile: StyleProfile | null | undefined,
  prevRoman: string,
  currRoman: string,
): number {
  if (!profile?.romanBigrams) return 0;
  const row = profile.romanBigrams[prevRoman];
  if (!row) return 0;
  const count = row[currRoman] || 0;
  if (count <= 0) return 0;
  let total = 0;
  for (const v of Object.values(row)) total += (v || 0);
  return total > 0 ? count / total : 0;
}

// ─── Persistence ───────────────────────────────────────────────────────────

const STORAGE_KEY = 'harmony-tutor.choralStyleProfile.v1';

/** Load the stored profile from localStorage. Returns null if none. */
export function loadStyleProfile(): StyleProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StyleProfile;
  } catch {
    return null;
  }
}

/** Save the profile to localStorage. */
export function saveStyleProfile(profile: StyleProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Silently fail if localStorage is full.
  }
}

/** Clear the stored profile. */
export function clearStyleProfile(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
