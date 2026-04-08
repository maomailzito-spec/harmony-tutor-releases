import * as fs from 'fs';
import * as path from 'path';

const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../tests/Dubois n2 p74.htp'), 'utf8'));
console.log('key:', data.keySignatureRoot, 'minor:', data.isMinorMode);

const notes = data.notes || [];
// m8-m13 (measureIndex 7-12)
const relevant = notes.filter((n: any) => n.measureIndex >= 7 && n.measureIndex <= 12);
relevant.sort((a: any, b: any) => a.measureIndex - b.measureIndex || a.beat - b.beat || a.voice - b.voice);
for (const n of relevant) {
  const k = `m${n.measureIndex + 1}b${n.beat}`;
  console.log(`${k} v=${n.voice} midi=${n.midi} pc=${n.midi % 12} pitch=${n.pitch}${n.octave} acc=${n.accidental || ''} dur=${n.duration}`);
}

// Check analysisContexts
console.log('\n=== analysisContexts ===');
for (const ctx of (data.analysisContexts || [])) {
  console.log(JSON.stringify(ctx));
}

// Check sequenceAnnotations
console.log('\n=== sequenceAnnotations ===');
for (const seq of (data.sequenceAnnotations || [])) {
  console.log(JSON.stringify(seq));
}
