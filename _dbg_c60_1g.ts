import fs from 'node:fs';
import {
  identifyChordCandidates,
  calculateRomanFromChordInfo,
  getRomanAnalysis,
  getActiveNotesTimeline,
  getKeySignature,
  applyHarmonyRules,
} from './src/utils/musicTheory';

const out: string[] = [];
const log = (...a: any[]) => out.push(a.join(' '));

const data = JSON.parse(fs.readFileSync('tests/Delamont C60 1g.htp', 'utf8'));
const notes = data.notes as any[];

log('keySignatureRoot=' + data.keySignatureRoot + ' isMinorMode=' + data.isMinorMode);
log('');
log('=== Raw notes m0-m1 ===');
for (const n of notes) {
  if (n.measureIndex > 1 || n.isRest) continue;
  const acc = n.accidental === 'sharp' ? '#' : n.accidental === 'flat' ? 'b' : '';
  log('m' + n.measureIndex + ' b' + n.beat + ' ' + n.pitch + acc + n.octave +
    ' midi=' + n.midi + ' v=' + n.voice + ' dur=' + n.duration + ' ni=' + n.noteIndex);
}

const keySig = getKeySignature(data.keySignatureRoot, data.isMinorMode ? 'Minor' : 'Major');
const keyTonic = 'B';

const result: any = applyHarmonyRules(
  notes, keySig as any, keyTonic, true,
  data.analysisContexts || [], data.timeSignature,
  data.doubleBarlineMeasures || [],
  data.ornamentOverrides || [],
  data.harmonyOverrides || [],
);

const timeline = getActiveNotesTimeline(
  result.analyzedNotes as any,
  data.timeSignature as any,
  data.timeSignatureChanges || [],
);

log('');
log('=== Timeline ab 0-12 ===');
for (const ev of timeline) {
  if (ev.absBeat >= 12) continue;
  const evN = (ev.notes || []).filter((n: any) => n && !n.isRest);
  const ns = evN.map((n: any) => {
    const a = n.accidental === 'sharp' ? '#' : n.accidental === 'flat' ? 'b' : '';
    return n.pitch + a + n.octave;
  }).join(', ');

  const ra = getRomanAnalysis(evN as any, keyTonic, true);
  log('ab=' + ev.absBeat + ' [' + ns + '] roman=' + (ra ? ra.roman : '?') + ' fig=[' + (ra ? ra.figures : []) + ']');

  if (evN.length >= 2) {
    const cands = identifyChordCandidates(evN as any);
    for (const c of cands.slice(0, 4)) {
      const rAcc = (c.root as any).accidental === 'sharp' ? '#' : (c.root as any).accidental === 'flat' ? 'b' : '';
      const rm = calculateRomanFromChordInfo(
        { root: c.root, type: c.type, intervals: c.intervals },
        keyTonic, true,
      );
      log('  root=' + (c.root as any).pitch + rAcc + ' type=' + c.type +
        ' score=' + c.score + ' match=' + c.matchType + ' -> ' + rm);
    }
  }
}

fs.writeFileSync('/tmp/c60_1g_out.txt', out.join('\n'));
console.log('DONE ' + out.length + ' lines');
