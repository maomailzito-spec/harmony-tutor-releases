import { getActiveNotesTimeline } from './src/utils/musicTheory';
import * as fs from 'fs';

// Find and load cantata 17 file
const testDir = 'tests';
const files = fs.readdirSync(testDir).filter(f => f.includes('cantata') || f.includes('Cantata'));
console.log('Test files with cantata:', files.filter(f => /17/.test(f)));

// Try to find the right file
let targetFile = '';
for (const f of fs.readdirSync(testDir)) {
  if (/cantata.*17|17.*cantata/i.test(f) && f.endsWith('.json')) {
    targetFile = `${testDir}/${f}`;
    break;
  }
}
if (!targetFile) {
  // Try looking in all json files
  for (const f of fs.readdirSync(testDir)) {
    if (f.endsWith('.json')) {
      const raw = JSON.parse(fs.readFileSync(`${testDir}/${f}`, 'utf8'));
      if (raw.title && /cantata.*17|17/i.test(raw.title)) {
        targetFile = `${testDir}/${f}`;
        break;
      }
    }
  }
}

if (!targetFile) {
  // Could also be loaded from user file system, not in tests/
  console.log('No cantata 17 file found in tests/. Listing all json files:');
  console.log(fs.readdirSync(testDir).filter(f => f.endsWith('.json')).join('\n'));
  process.exit(1);
}

console.log('Using file:', targetFile);
const raw = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
const notes = raw.notes || raw.staffNotes || [];
const ts = raw.timeSignature || { numerator: 3, denominator: 4 };

console.log('Total notes:', notes.length);
console.log('Time signature:', ts);

const timeline = getActiveNotesTimeline(notes, ts);

// Find events around beat 115
const nearby = timeline.filter((e: any) => e.absBeat >= 113 && e.absBeat <= 117);
for (const ev of nearby) {
  console.log(`\n=== Event at absBeat=${ev.absBeat} ===`);
  console.log(`  noteCount: ${ev.notes?.length || 0}`);
  for (const n of (ev.notes || [])) {
    const midi = (n as any).midi;
    const voice = (n as any).voice;
    const dur = (n as any).duration;
    const pitch = (n as any).pitch;
    const susp = !!(n as any).isSuspension;
    const pass = !!(n as any).isPassing;
    const app = !!(n as any).isAppoggiatura;
    const acc = (n as any).accidental;
    const userAcc = (n as any).userAccidental;
    const explAcc = (n as any).explicitAccidental;
    const noteIdx = (n as any).noteIndex;
    console.log(`  midi=${midi} voice=${voice} pitch="${pitch}" acc=${JSON.stringify(acc)} userAcc=${JSON.stringify(userAcc)} explAcc=${JSON.stringify(explAcc)} noteIdx=${noteIdx} dur=${dur} S=${susp} P=${pass} Ap=${app}`);
  }
}
