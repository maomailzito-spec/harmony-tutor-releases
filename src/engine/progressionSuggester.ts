/**
 * Chord Progression Suggester
 *
 * Uses bigram/trigram statistics extracted from analysed compositions
 * to suggest the most likely next chord given the current context.
 *
 * Two layers of data:
 *  - **Static corpus**: bundled JSON (`src/data/progressionStats.json`)
 *  - **User corpus**: accumulated via localStorage as the user adds
 *    compositions to the learning set (future feature).
 */

import statsJson from '../data/progressionStats.json';

// ── Types ────────────────────────────────────────────────────────────────

export interface ChordSuggestion {
  /** Roman numeral label (e.g. "V", "IV", "vi") */
  chord: string;
  /** Raw count from the corpus */
  count: number;
  /** Probability (0-1) relative to other suggestions for this context */
  probability: number;
}

interface BigramMap { [from: string]: { [to: string]: number } }

interface ProgressionStats {
  bigramsBase: BigramMap;
  trigramsBase: BigramMap;
  unigramsBase: { [chord: string]: number };
}

// ── Static corpus ────────────────────────────────────────────────────────

const staticStats: ProgressionStats = statsJson as unknown as ProgressionStats;

// ── User corpus (localStorage) ───────────────────────────────────────────

const LS_KEY = 'ht_user_progression_stats';

function loadUserStats(): ProgressionStats | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ProgressionStats;
  } catch {
    return null;
  }
}

// ── Merge helper ─────────────────────────────────────────────────────────

function mergeBigrams(a: BigramMap, b: BigramMap): BigramMap {
  const result: BigramMap = {};
  for (const map of [a, b]) {
    for (const [from, targets] of Object.entries(map)) {
      if (!result[from]) result[from] = {};
      for (const [to, count] of Object.entries(targets)) {
        result[from][to] = (result[from][to] || 0) + count;
      }
    }
  }
  return result;
}

function mergeUnigrams(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    result[k] = (result[k] || 0) + v;
  }
  return result;
}

function getMergedStats(): ProgressionStats {
  const user = loadUserStats();
  if (!user) return staticStats;
  return {
    bigramsBase: mergeBigrams(staticStats.bigramsBase, user.bigramsBase || {}),
    trigramsBase: mergeBigrams(staticStats.trigramsBase, user.trigramsBase || {}),
    unigramsBase: mergeUnigrams(staticStats.unigramsBase, user.unigramsBase || {}),
  };
}

// ── Normalize roman label ────────────────────────────────────────────────

/** Strip figured-bass suffixes to get base chord.
 *  e.g. "V7" → "V", "V65" → "V", "viio6" → "viio" */
function stripFigures(label: string): string {
  return label.replace(/[0-9♭♯]+$/g, '');
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Given a list of recent chords (roman numeral labels), return
 * the most likely next chords sorted by probability.
 *
 * @param recentChords  Array of 1-2 recent chord labels (newest last)
 * @param maxResults    Maximum number of suggestions (default 6)
 * @returns Sorted array of suggestions with probabilities
 */
export function suggestNextChord(
  recentChords: string[],
  maxResults = 6,
): ChordSuggestion[] {
  if (recentChords.length === 0) return [];

  const stats = getMergedStats();
  let candidates: Record<string, number> = {};

  // Normalize input
  const normalized = recentChords.map(stripFigures);
  const last = normalized[normalized.length - 1];
  const secondLast = normalized.length >= 2 ? normalized[normalized.length - 2] : null;

  // Try trigram first (2-chord context → next)
  if (secondLast) {
    const triKey = `${secondLast}|${last}`;
    const triTargets = stats.trigramsBase[triKey];
    if (triTargets) {
      for (const [chord, count] of Object.entries(triTargets)) {
        // Weight trigrams higher (2x)
        candidates[chord] = (candidates[chord] || 0) + count * 2;
      }
    }
  }

  // Add bigram data
  const biTargets = stats.bigramsBase[last];
  if (biTargets) {
    for (const [chord, count] of Object.entries(biTargets)) {
      candidates[chord] = (candidates[chord] || 0) + count;
    }
  }

  // If no data at all, return empty
  if (Object.keys(candidates).length === 0) return [];

  // Sort by score descending
  const sorted = Object.entries(candidates)
    .sort(([, a], [, b]) => b - a);

  // Compute probabilities
  const totalScore = sorted.reduce((sum, [, s]) => sum + s, 0);

  return sorted.slice(0, maxResults).map(([chord, score]) => ({
    chord,
    count: score,
    probability: totalScore > 0 ? score / totalScore : 0,
  }));
}

/**
 * Get all unique chord labels known to the corpus.
 */
export function getKnownChords(): string[] {
  const stats = getMergedStats();
  return Object.keys(stats.unigramsBase).sort();
}
