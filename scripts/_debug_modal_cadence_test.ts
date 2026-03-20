/**
 * Debug: test cadential pattern detection on Modal change test.htp
 */
import { evaluateCadentialPatterns, noteNameToPc, qualityFamily } from '../src/utils/cadentialPatterns';
import { identifyChordCandidates, getActiveNotesTimeline, calculateNoteBeats } from '../src/utils/musicTheory';
import { shouldBlockTonicization } from '../src/utils/modalInterchange';
import * as fs from 'fs';

const data = JSON.parse(fs.readFileSync('./tests/Modal change test.htp', 'utf-8'));
const rawNotes = data.notes || data.rawNotes || [];
const ts = data.timeSignature || { numerator: 4, denominator: 4 };
const notes = calculateNoteBeats(rawNotes, ts, []);
const timeline = getActiveNotesTimeline(notes, ts, []);

const chEvts: any[] = [];
for (const ev of timeline) {
  const n = (ev as any).notes || [];
  if (!n.length) continue;
  const cands = identifyChordCandidates(n);
  const top = cands?.[0];
  if (!top?.root) continue;
  const rootPc = typeof top.root === 'string'
    ? noteNameToPc(top.root)
    : ((Number((top.root as any)?.noteIndex ?? (top.root as any)?.midi ?? 0)) % 12 + 12) % 12;
  const bassMidi = Math.min(...n.map((x: any) => Number(x.midi)));
  const bassPc = ((bassMidi % 12) + 12) % 12;
  chEvts.push({
    rootPc, quality: top.type || '', bassPc, absBeat: (ev as any).absBeat,
    notePcs: [...new Set(n.map((x: any) => ((Number(x.midi) % 12) + 12) % 12))],
  });
}

const pcName = (pc: number) => ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'][pc % 12];

console.log('Chord events:');
for (const e of chEvts) {
  console.log(`  abs=${e.absBeat}  root=${pcName(e.rootPc)}(${e.rootPc})  quality=${e.quality}  bass=${pcName(e.bassPc)}`);
}

// 1. Cadential pattern matches (raw — before filtering)
const matchesRaw = evaluateCadentialPatterns(chEvts, noteNameToPc('C'), false, { minConfidence: 70 });
console.log('\nCadential matches (RAW from evaluateCadentialPatterns):');
for (const m of matchesRaw) {
  console.log(`  ${m.formulaId}  target=${pcName(m.targetTonicPc)}${m.targetIsMinor ? 'm' : 'M'}  start=${m.startBeat}  end=${m.endBeat}  conf=${m.confidence}  dec=${m.deceptive}`);
}

// 2. Post-filter with shouldBlockTonicization
const matchesFiltered = matchesRaw.filter(m => {
  const resEv = chEvts.find(e => Math.abs(e.absBeat - m.endBeat) < 0.05);
  if (resEv && shouldBlockTonicization(resEv.rootPc, resEv.quality, 'C', false)) {
    console.log(`  → BLOCKED: ${m.formulaId} (resolution ${pcName(resEv.rootPc)} ${resEv.quality} is borrowed chord)`);
    return false;
  }
  return true;
});
console.log('\nCadential matches (after modal interchange filter):');
for (const m of matchesFiltered) {
  console.log(`  ${m.formulaId}  target=${pcName(m.targetTonicPc)}${m.targetIsMinor ? 'm' : 'M'}  start=${m.startBeat}  end=${m.endBeat}`);
}

// 3. Dominant Resolution Extension simulation
console.log('\nDominant Resolution Extension check:');
const homeScalePcs = new Set([0, 2, 4, 5, 7, 9, 11]); // C major scale pcs
for (let ci = 0; ci < chEvts.length - 1; ci++) {
  const dom = chEvts[ci], res = chEvts[ci + 1];
  if (((dom.rootPc - res.rootPc + 12) % 12) !== 7) continue;
  if (qualityFamily(dom.quality) !== 'major') continue;
  if (/maj.*7|major\s*7/i.test(dom.quality)) continue;
  const hasChromaticEvidence = dom.notePcs?.some((pc: number) => !homeScalePcs.has(pc));
  const blocked = shouldBlockTonicization(res.rootPc, res.quality, 'C', false);
  console.log(`  dom=${pcName(dom.rootPc)}(abs=${dom.absBeat}) → res=${pcName(res.rootPc)}(abs=${res.absBeat})  chromatic=${hasChromaticEvidence}  blocked=${blocked}`);
}
