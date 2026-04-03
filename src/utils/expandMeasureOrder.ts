/**
 * expandMeasureOrder — Given a total measure count and a repeat-barlines map,
 * returns the sequence of measure indices as they should be played back.
 *
 * Rules (standard notation convention):
 *   • `repeat-end` at measure M  → repeat from the most recent `repeat-begin`
 *     (or from measure 0 if none) to M, then continue from M+1.
 *   • `repeat-begin` at measure M → marks the start of a repeated section.
 *   • `repeat-both` at measure M → acts as `repeat-end` for the previous section,
 *     then immediately starts a new `repeat-begin` at M+1.
 *
 * Each section repeats only **once** (standard practice).
 * Volta brackets are NOT handled here (future extension).
 */
export function expandMeasureOrder(
  totalMeasures: number,
  repeatBarlines: Record<number, 'repeat-begin' | 'repeat-end' | 'repeat-both'>,
): number[] {
  if (totalMeasures <= 0) return [];
  if (!repeatBarlines || Object.keys(repeatBarlines).length === 0) {
    return Array.from({ length: totalMeasures }, (_, i) => i);
  }

  const result: number[] = [];
  let cursor = 0;           // current playback measure
  let repeatStart = 0;      // where the current repeat-begin is

  // To avoid infinite loops (e.g. malformed barlines), we cap at 2× total.
  const maxIterations = totalMeasures * 4;
  let iterations = 0;

  // Track which repeat-end measures we've already taken, so we repeat only once.
  const usedRepeatEnds = new Set<number>();

  while (cursor < totalMeasures && iterations < maxIterations) {
    iterations++;
    result.push(cursor);

    const bar = repeatBarlines[cursor];

    if (bar === 'repeat-begin') {
      repeatStart = cursor + 1;
      cursor++;
    } else if (bar === 'repeat-end') {
      if (!usedRepeatEnds.has(cursor)) {
        usedRepeatEnds.add(cursor);
        cursor = repeatStart; // jump back
      } else {
        cursor++;
      }
    } else if (bar === 'repeat-both') {
      // End current section
      if (!usedRepeatEnds.has(cursor)) {
        usedRepeatEnds.add(cursor);
        cursor = repeatStart; // jump back to replay
      } else {
        // Start new section from next measure
        repeatStart = cursor + 1;
        cursor++;
      }
    } else {
      cursor++;
    }
  }

  return result;
}
