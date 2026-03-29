import * as fs from 'fs';
import * as path from 'path';
import { calculateNoteBeats } from '../src/utils/musicTheory';
import { noteNameToPc, getScalePcs } from '../src/utils/cadentialPatterns';

const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../tests/Dubois n4 p73.htp'), 'utf8'));
const ts = data.timeSignature || { numerator: 4, denominator: 4 };
const tsc = data.timeSignatureChanges || [];
const notes = (calculateNoteBeats(data.notes || [], ts, tsc) as any[]).filter((n: any) => !n.isRest);

const tonicPc = noteNameToPc('F');  // home is F minor
const homePcs = new Set(getScalePcs(tonicPc, true)); // natural minor
const fMajPcs = new Set(getScalePcs(tonicPc, false)); // F major

const byMeasure = new Map<number, Set<number>>();
for (const n of notes) {
  const m = n.measureIndex as number;
  if (!byMeasure.has(m)) byMeasure.set(m, new Set());
  byMeasure.get(m)!.add(n.midi % 12);
}

const measures = [...byMeasure.keys()].sort((a, b) => a - b);
console.log('F min natural pcs:', [...homePcs].sort((a,b)=>a-b));
console.log('F maj pcs:', [...fMajPcs].sort((a,b)=>a-b));
console.log('');

for (const m of measures) {
  if (m < 13) continue;
  const pcs = byMeasure.get(m)!;
  const pcArr = [...pcs];
  const homeFit = pcArr.filter(pc => homePcs.has(pc)).length / pcArr.length;
  const fMajFit = pcArr.filter(pc => fMajPcs.has(pc)).length / pcArr.length;
  console.log(`m${m+1}: pcs=[${pcArr.sort((a,b)=>a-b)}] homeFit=${(homeFit*100).toFixed(0)}% fMajFit=${(fMajFit*100).toFixed(0)}%`);
}
