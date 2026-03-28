import * as fs from 'fs';
import * as path from 'path';
import { calculateNoteBeats } from '../src/utils/musicTheory';

const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../tests/Dubois n2 p74.htp'), 'utf8'));
const ts = data.timeSignature || { upper: 3, lower: 4 };
const tsc = data.timeSignatureChanges || [];
const notes = calculateNoteBeats(data.notes || [], ts, tsc) as any[];

// Group by beat
const byBeat = new Map<string, any[]>();
for (const n of notes) {
  const k = `m${n.measureIndex + 1}b${n.beat}`;
  if (!byBeat.has(k)) byBeat.set(k, []);
  byBeat.get(k)!.push(n);
}

// Show m8-m12 vertical chords
for (let m = 8; m <= 12; m++) {
  for (let b = 1; b <= 3; b++) {
    const k = `m${m}b${b}`;
    const group = byBeat.get(k);
    if (!group) continue;
    group.sort((a: any, b: any) => a.midi - b.midi);
    const pcs = group.map((n: any) => n.midi % 12);
    const midis = group.map((n: any) => n.midi);
    const names = group.map((n: any) => `${n.pitch}${n.accidental === 'flat' ? 'b' : n.accidental === 'sharp' ? '#' : ''}${n.octave}`);
    console.log(`${k}: midis=[${midis}] pcs=[${pcs}] names=[${names}]`);
  }
}
