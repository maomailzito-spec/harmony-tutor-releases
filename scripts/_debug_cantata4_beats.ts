/**
 * Debug: find measures with beat/rest problems in Cantata 4 Bach
 */
import { readFileSync } from 'fs';

const p = JSON.parse(readFileSync('./tests/cantata 4 Bach.json', 'utf-8'));
const notes = (p as any).notes || [];
const ts = (p as any).timeSignature || { numerator: 4, denominator: 4 };
const TICKS_PER_QUARTER = 960;
const beatsPerMeasure = ts.numerator * (4 / ts.denominator);
const ticksPerMeasure = beatsPerMeasure * TICKS_PER_QUARTER;

// Duration name → base ticks
const durToTicks: Record<string, number> = {
  'whole': 3840,
  'half': 1920,
  'quarter': 960,
  'eighth': 480,
  'sixteenth': 240,
  'thirty-second': 120,
  'sixty-fourth': 60,
};

console.log(`File: cantata 4 Bach.json`);
console.log(`Notes: ${notes.length}, Measures: ${Math.max(...notes.map((n: any) => n.measureIndex ?? 0)) + 1}`);
console.log(`Time sig: ${ts.numerator}/${ts.denominator}, beatsPerMeasure: ${beatsPerMeasure}`);
console.log(`Rests: ${notes.filter((n: any) => n.isRest).length}\n`);

// Group notes by measure+voice
const byMV = new Map<string, any[]>();
for (const n of notes) {
  const k = `${n.measureIndex ?? 0}:${n.voice ?? 1}`;
  if (!byMV.has(k)) byMV.set(k, []);
  byMV.get(k)!.push(n);
}

// Check each voice in each measure for beat consistency
const problems: any[] = [];
for (const [key, voiceNotes] of byMV) {
  const [mStr, vStr] = key.split(':');
  const m = parseInt(mStr);
  const v = parseInt(vStr);

  const sorted = voiceNotes.sort((a: any, b: any) => (a.beat ?? 1) - (b.beat ?? 1));
  let totalTicks = 0;
  let totalBeats = 0;

  for (const n of sorted) {
    const baseTicks = durToTicks[n.duration] ?? 960;
    let expectedTicks = baseTicks;
    if (n.isDotted) expectedTicks = Math.round(baseTicks * 1.5);
    if (n.isTriplet) expectedTicks = Math.round(baseTicks * 2 / 3);
    if (n.isDuplet) expectedTicks = Math.round(baseTicks * 1.5);

    const actualTicks = n.durationTicks ?? expectedTicks;
    const tickMismatch = Math.abs(actualTicks - expectedTicks) > 1;

    totalTicks += actualTicks;
    const beatDur = actualTicks / TICKS_PER_QUARTER;
    totalBeats += beatDur;

    if (tickMismatch) {
      problems.push({
        type: 'TICK_MISMATCH',
        m, v,
        id: n.id?.slice(0, 8),
        isRest: n.isRest,
        duration: n.duration,
        isDotted: n.isDotted,
        isTriplet: n.isTriplet,
        expectedTicks,
        actualTicks: n.durationTicks,
        beat: n.beat,
      });
    }
  }

  const diff = Math.abs(totalTicks - ticksPerMeasure);
  if (diff > 1) {
    problems.push({
      type: 'MEASURE_MISMATCH',
      m, v,
      totalTicks,
      expectedTicks: ticksPerMeasure,
      diff,
      totalBeats: totalBeats.toFixed(2),
      expectedBeats: beatsPerMeasure,
      noteCount: sorted.length,
      restCount: sorted.filter((n: any) => n.isRest).length,
    });
  }
}

// Sort and show
const tickMismatches = problems.filter(p => p.type === 'TICK_MISMATCH');
const measureMismatches = problems.filter(p => p.type === 'MEASURE_MISMATCH');

console.log(`=== TICK MISMATCHES (duration vs durationTicks): ${tickMismatches.length} ===`);
for (const p of tickMismatches.slice(0, 20)) {
  console.log(`  m${p.m} v${p.v} ${p.isRest ? 'REST' : 'NOTE'} ${p.duration}${p.isDotted ? '.' : ''}${p.isTriplet ? 'T' : ''} beat=${p.beat} expected=${p.expectedTicks} actual=${p.actualTicks}`);
}

console.log(`\n=== MEASURE BEAT MISMATCHES: ${measureMismatches.length} ===`);
for (const p of measureMismatches.slice(0, 30)) {
  console.log(`  m${p.m} v${p.v}: ${p.totalBeats}/${p.expectedBeats} beats (${p.noteCount} notes, ${p.restCount} rests, diff=${p.diff} ticks)`);
}
