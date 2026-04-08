import * as fs from 'fs';
import * as path from 'path';
import { calculateNoteBeats } from '../src/utils/musicTheory';

// Patch DEBUG_SEQUENCE to true temporarily
// Instead, we'll manually run the transposition computation on the detected sequence

const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../tests/Dubois n2 p74.htp'), 'utf8'));
const ts = data.timeSignature || { upper: 3, lower: 4 };
const tsc = data.timeSignatureChanges || [];
const notes = (calculateNoteBeats(data.notes || [], ts, tsc) as any[]).filter((n: any) => !n.isRest);

// The detector found: m8-m10, lengthSteps=2, startSlotIdx=?
// Let's rebuild the slots manually to understand what's happening

// Group notes by onset tick
const onsetMap = new Map<number, any[]>();
for (const n of notes) {
  const t = n.startTick;
  if (t == null) continue;
  // snap to 8 ticks
  const snapped = Math.round(t / 8) * 8;
  if (!onsetMap.has(snapped)) onsetMap.set(snapped, []);
  onsetMap.get(snapped)!.push(n);
}

const slotTicks = [...onsetMap.keys()].sort((a, b) => a - b);
console.log('Total slots:', slotTicks.length);

// Find slots in m8-m12 range
const tpq = 960;
const beatsPerMeasure = ts.upper; // 3
const ticksPerMeasure = tpq * beatsPerMeasure;

for (let si = 0; si < slotTicks.length; si++) {
  const tick = slotTicks[si];
  const measure = Math.floor(tick / ticksPerMeasure);
  if (measure < 7 || measure > 11) continue; // m8-m12 (0-indexed 7-11)
  
  const beat = (tick % ticksPerMeasure) / tpq + 1;
  const group = onsetMap.get(tick) || [];
  group.sort((a: any, b: any) => a.midi - b.midi);
  
  // Assign voices
  const voices: { midi: number; pc: number; pitch: string }[] = [];
  for (const n of group) {
    voices.push({ midi: n.midi, pc: n.midi % 12, pitch: `${n.pitch}${n.accidental === 'sharp' ? '#' : n.accidental === 'flat' ? 'b' : ''}${n.octave}` });
  }
  
  console.log(`slot[${si}] tick=${tick} m${measure + 1}b${beat.toFixed(0)} voices=${voices.map(v => v.pitch + '(' + v.midi + ')').join(', ')}`);
}

// Now check: for the m8-m10 sequence with lengthSteps=2
// Find the slot index for m8b1
const m8b1Tick = 7 * ticksPerMeasure; // measure 7 (0-indexed), beat 1
const m8SlotIdx = slotTicks.findIndex(t => t >= m8b1Tick);
console.log('\nm8b1 slot index:', m8SlotIdx, 'tick:', slotTicks[m8SlotIdx]);

// L=2: model = slots[m8SlotIdx, m8SlotIdx+1], rep1 = slots[m8SlotIdx+2, m8SlotIdx+3]
for (let block = 0; block < 3; block++) {
  console.log(`\n--- Block ${block} (${block === 0 ? 'model' : 'rep' + block}) ---`);
  for (let k = 0; k < 2; k++) {
    const idx = m8SlotIdx + block * 2 + k;
    const tick = slotTicks[idx];
    const measure = Math.floor(tick / ticksPerMeasure);
    const beat = (tick % ticksPerMeasure) / tpq + 1;
    const group = onsetMap.get(tick) || [];
    group.sort((a: any, b: any) => a.midi - b.midi);
    console.log(`  slot[${idx}] m${measure + 1}b${beat.toFixed(0)} = ${group.map((n: any) => n.pitch + (n.accidental === 'sharp' ? '#' : n.accidental === 'flat' ? 'b' : '') + n.octave + '(' + n.midi + ')').join(', ')}`);
  }
  
  // Compare with model for transposition
  if (block > 0) {
    console.log('  Transposition check:');
    for (let k = 0; k < 2; k++) {
      const modelIdx = m8SlotIdx + k;
      const repIdx = m8SlotIdx + block * 2 + k;
      const modelGroup = (onsetMap.get(slotTicks[modelIdx]) || []).sort((a: any, b: any) => a.midi - b.midi);
      const repGroup = (onsetMap.get(slotTicks[repIdx]) || []).sort((a: any, b: any) => a.midi - b.midi);
      const deltas = [];
      for (let v = 0; v < Math.min(modelGroup.length, repGroup.length); v++) {
        deltas.push(repGroup[v].midi - modelGroup[v].midi);
      }
      console.log(`    slot k=${k}: deltas=[${deltas}]`);
    }
  }
}
