const fs = require('fs');
const m = require('./src/utils/musicTheory');

const proj = JSON.parse(fs.readFileSync('tests/Delachi n5 p14:67.htp', 'utf-8'));
console.log('Key:', proj.keySignatureRoot, 'minor:', proj.isMinorMode);

const ks = m.getKeySignature(proj.keySignatureRoot, proj.isMinorMode ? 'Minor' : 'Major');
const res = m.applyHarmonyRules(
  proj.notes, ks, proj.keySignatureRoot, !!proj.isMinorMode,
  proj.analysisContexts || [], proj.timeSignature,
  undefined, proj.ornamentOverrides || []
);

// Find R-07 violations
const r07 = res.violations.filter((v) => v.ruleId === 'R-07');
console.log('\nR-07 violations:', r07.length);
for (const v of r07) {
  console.log(`  ${v.description}`);
  console.log(`  noteIds: ${JSON.stringify(v.noteIds)}`);
}

// Show notes at measure 2 beat 1 (measureIndex=1)
const an = res.analyzedNotes;
const m2b1 = an.filter((n) => n.measureIndex === 1 && Math.abs(n.beat - 1) < 0.1 && !n.isRest);
console.log('\n=== Measure 2 beat 1 ===');
for (const n of m2b1) {
  console.log(`  v=${n.voice} ${n.pitch}${n.accidental||''} oct=${n.octave} midi=${n.midi}`);
}

// Show measure 1 beat 1 for context (the chord before)
const timeline = m.getActiveNotesTimeline(an, proj.timeSignature);
for (const ev of timeline) {
  if (ev.measureIndex <= 2) {
    const notes = ev.notes.filter((n) => n && !n.isRest);
    const struct = notes.filter((n) => !n.isPassing && !n.isNeighbor && !n.isAppoggiatura && !n.isAnticipation && !n.isEscape && !n.isSuspension);
    const roman = struct.length >= 2 ? m.getRomanAnalysis(struct, proj.keySignatureRoot, proj.isMinorMode) : null;
    console.log(`  m=${ev.measureIndex+1} b=${ev.beat} absBeat=${ev.absBeat} roman=${roman?.roman||'?'} notes=${notes.map(n => n.pitch + (n.accidental||'')).join(',')}`);
  }
}
