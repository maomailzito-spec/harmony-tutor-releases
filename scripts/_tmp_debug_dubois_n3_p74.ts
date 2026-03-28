import * as fs from 'fs';
import * as path from 'path';
import { calculateNoteBeats } from '../src/utils/musicTheory';
import { noteNameToPc, getScalePcs } from '../src/utils/cadentialPatterns';

const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../tests/Dubois n3 p74.htp'), 'utf8'));
const ts = data.timeSignature || { upper: 4, lower: 4 };
const tsc = data.timeSignatureChanges || [];
const notes = (calculateNoteBeats(data.notes || [], ts, tsc) as any[]).filter((n: any) => !n.isRest);

const relativeMinors: Record<string, string> = {
  'C': 'A', 'G': 'E', 'D': 'B', 'A': 'F#', 'E': 'C#', 'B': 'G#',
  'F': 'D', 'Bb': 'G', 'Eb': 'C', 'Ab': 'F', 'Db': 'Bb', 'Gb': 'Eb',
};
const currentTonic = data.isMinorMode ? (relativeMinors[data.keySignatureRoot] || 'A') : data.keySignatureRoot;
const isMinor = !!data.isMinorMode;
console.log('key:', data.keySignatureRoot, 'minor:', isMinor, 'tonic:', currentTonic);
console.log('timeSignature:', JSON.stringify(ts));

// Get home scale PCs
const homePcs = new Set(getScalePcs(noteNameToPc(currentTonic), isMinor));
console.log('home scale pcs:', [...homePcs].sort((a, b) => a - b));

// Db major scale pcs
const dbPcs = new Set(getScalePcs(noteNameToPc('Db'), false));
console.log('Db major scale pcs:', [...dbPcs].sort((a, b) => a - b));

// Group notes by measure
const byMeasure = new Map<number, any[]>();
for (const n of notes) {
  const m = n.measureIndex;
  if (!byMeasure.has(m)) byMeasure.set(m, []);
  byMeasure.get(m)!.push(n);
}

const measures = [...byMeasure.keys()].sort((a, b) => a - b);
for (const m of measures) {
  const group = byMeasure.get(m)!;
  const pcs = new Set(group.map((n: any) => n.midi % 12));
  const outOfKey = [...pcs].filter(pc => !homePcs.has(pc));
  const names = group.sort((a: any, b: any) => a.beat - b.beat || a.voice - b.voice)
    .map((n: any) => `${n.pitch}${n.accidental === 'sharp' ? '#' : n.accidental === 'flat' ? 'b' : ''}${n.octave}(v${n.voice}b${n.beat})`);
  const dbFit = [...pcs].filter(pc => dbPcs.has(pc)).length;
  const bbFit = [...pcs].filter(pc => homePcs.has(pc)).length;
  console.log(`m${m + 1}: pcs=[${[...pcs].sort((a,b)=>a-b)}] outOfBb=[${outOfKey}] dbFit=${dbFit}/${pcs.size} bbFit=${bbFit}/${pcs.size} | ${names.join(', ')}`);
}
