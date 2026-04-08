/**
 * Debug script: investigate held notes at beat 115 (Cantata 17, m39 b2).
 * Run: npx tsx scripts/_debug_cantata17_b115.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  getActiveNotesTimeline,
  getRomanAnalysis,
  applyHarmonyRules,
} from '../src/utils/musicTheory';
import {
  filterTimelineForHarmonyLabels,
  structuralNotes,
} from '../src/utils/harmonyLabelPipeline';

const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../tests/Cantata 17 Bach.json'), 'utf8'));
const notes: any[] = raw.notes || [];
const ts = raw.timeSignature || { numerator: 3, denominator: 4 };
const keyTonic = raw.keyTonic || 'A';
const isMinor = raw.isMinor ?? true;

// Run applyHarmonyRules to get ornament flags
const result = applyHarmonyRules(notes, { type: 'sharp' as any, count: 0 }, keyTonic, isMinor, [], ts);
const analyzedNotes = (result as any).analyzedNotes || notes;

// Build timeline 
const timeline = getActiveNotesTimeline(analyzedNotes, ts);
const filtered = filterTimelineForHarmonyLabels(timeline, ts);

// Find beat 115 (±0.5)
const TARGET_BEAT = 115;
const EPS = 0.5;

console.log('=== Timeline events near beat 115 ===');
for (const ev of timeline) {
  if (Math.abs(ev.absBeat - TARGET_BEAT) <= 2) {
    const noteInfo = (ev.notes || []).map((n: any) => ({
      midi: n.midi,
      voice: n.voice ?? 1,
      isPassing: !!n.isPassing,
      isNeighbor: !!n.isNeighbor,
      isAppoggiatura: !!n.isAppoggiatura,
      isAnticipation: !!n.isAnticipation,
      isEscape: !!n.isEscape,
      isSuspension: !!n.isSuspension,
      isRest: !!n.isRest,
      ornamentOverride: n.ornamentOverride || null,
      id: n.id,
      beat: n.beat,
      measureIndex: n.measureIndex,
    }));
    console.log(`\nab=${ev.absBeat} m=${ev.measureIndex} beat=${ev.beat} notes=${noteInfo.length}`);
    for (const ni of noteInfo) {
      console.log(`  midi=${ni.midi} v=${ni.voice} id=${ni.id?.substring(0,10)} rest=${ni.isRest} P=${ni.isPassing} N=${ni.isNeighbor} Ap=${ni.isAppoggiatura} An=${ni.isAnticipation} E=${ni.isEscape} S=${ni.isSuspension}`);
    }
  }
}

console.log('\n=== Filtered timeline events near beat 115 ===');
for (const ev of filtered as any[]) {
  if (Math.abs(ev.absBeat - TARGET_BEAT) <= 2) {
    const noteInfo = (ev.notes || []).map((n: any) => ({
      midi: n.midi,
      voice: n.voice ?? 1,
    }));
    console.log(`ab=${ev.absBeat} m=${ev.measureIndex} beat=${ev.beat} notes=${noteInfo.length} [${noteInfo.map((x: any) => `${x.midi}/v${x.voice}`).join(', ')}]`);
  }
}

// Now simulate lastStructural logic
console.log('\n=== Simulating lastStructural logic ===');
const lastStructural = new Map<number, any>();
const isNonChordToneSimple = (n: any): boolean => {
  if (n.isPassing || n.isEscape) return true;
  if (n.isAppoggiatura) return true;
  if (n.isAnticipation) return true;
  if (n.isNeighbor) return true;
  if (n.isSuspension) return true;
  return false;
};

for (const ev of filtered as any[]) {
  if (ev.absBeat < TARGET_BEAT - 3) continue;
  if (ev.absBeat > TARGET_BEAT + 1) break;

  const fullNotes = ev.notes || [];
  const voiceSet = new Set<number>();
  for (const n of fullNotes) {
    if (!n || n.isRest) continue;
    voiceSet.add((n.voice ?? 1) as number);
  }

  // Clear old
  for (const v of Array.from(lastStructural.keys())) {
    if (!voiceSet.has(v)) lastStructural.delete(v);
  }

  // Process notes
  for (const n of fullNotes) {
    if (!n || n.isRest) continue;
    const v = (n.voice ?? 1) as number;
    if (isNonChordToneSimple(n)) {
      // keep previous
      continue;
    }
    lastStructural.set(v, n);
  }

  const harmonicNotes = Array.from(lastStructural.values()).filter(Boolean);
  const pcs = [...new Set(harmonicNotes.map((n: any) => ((n.midi % 12) + 12) % 12))].sort();
  
  console.log(`ab=${ev.absBeat} voiceSet=[${[...voiceSet]}] lastStructural.size=${lastStructural.size} harmonicNotes=${harmonicNotes.length} pcs=[${pcs}]`);
  for (const [v, n] of lastStructural.entries()) {
    console.log(`  v${v}: midi=${n.midi} id=${String(n.id).substring(0,10)} P=${!!n.isPassing} N=${!!n.isNeighbor} Ap=${!!n.isAppoggiatura}`);
  }

  // Try getRomanAnalysis
  const r = getRomanAnalysis(harmonicNotes, keyTonic, isMinor);
  console.log(`  -> roman=${r?.roman || '(null)'}`);
}
