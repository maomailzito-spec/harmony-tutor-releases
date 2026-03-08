/**
 * Debug script: trace what creates the Dm context at Cantata 19 m11 b4.
 * 
 * Usage: npx tsx scripts/_debug_cantata19_m11b4.ts
 */
import { getActiveNotesTimeline, identifyChordCandidates, getRomanAnalysis } from '../src/utils/musicTheory';
import { evaluateCadentialPatterns, noteNameToPc, pcToNoteName, qualityFamily, getScalePcs, type ChordEvent } from '../src/utils/cadentialPatterns';
import * as fs from 'fs';
import * as path from 'path';

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tests', 'Cantata 19 bach.json'), 'utf8'));
const currentTonic = data.keySignatureRoot || 'Bb';
const isMinorMode = !!data.isMinorMode;
const timeSignature = data.timeSignature || { numerator: 4, denominator: 4 };
const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);

console.log(`=== Cantata 19 Bach: ${currentTonic} ${isMinorMode ? 'minor' : 'major'}, ${timeSignature.numerator}/${timeSignature.denominator} ===`);
console.log(`Beats per measure: ${beatsPerMeasure}`);
console.log(`Notes count: ${data.notes.length}`);

// Build timeline (simplified — assumes getActiveNotesTimeline is available)
const notes = data.notes || [];

// Simulate timeline: group notes by absBeat
function buildTimeline(notes: any[]): any[] {
  // Compute absBeat for each note
  for (const n of notes) {
    if (n.absBeat == null) {
      n.absBeat = (n.measureIndex || 0) * beatsPerMeasure + (n.beat || 0);
    }
  }

  // For each note, it's "active" from its absBeat through absBeat + duration
  // We need the timeline at each beat: all notes sounding (onset or held)
  const allBeats = new Set<number>();
  for (const n of notes) {
    allBeats.add(n.absBeat);
  }
  const sortedBeats = [...allBeats].sort((a, b) => a - b);
  
  const timeline: any[] = [];
  for (const beat of sortedBeats) {
    const activeNotes: any[] = [];
    for (const n of notes) {
      if (n.isRest) continue;
      const start = n.absBeat;
      const end = start + (n.duration || 1);
      if (start <= beat + 1e-6 && end > beat - 1e-6) {
        activeNotes.push(n);
      }
    }
    if (activeNotes.length > 0) {
      timeline.push({ absBeat: beat, notes: activeNotes });
    }
  }
  return timeline;
}

const timeline = buildTimeline([...notes]);

// Show m10-m12 timeline events
console.log('\n=== Timeline events m9-m12 ===');
const pcNames = ['C','Db','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const startBeat = 8 * beatsPerMeasure; // m9
const endBeat = 12 * beatsPerMeasure; // end of m12

for (const ev of timeline) {
  if (ev.absBeat < startBeat - 0.01 || ev.absBeat >= endBeat + 0.01) continue;
  const meas = Math.floor(ev.absBeat / beatsPerMeasure) + 1;
  const beat = (ev.absBeat % beatsPerMeasure) + 1;
  const midis = ev.notes.map((n: any) => n.midi ?? n.noteIndex);
  const pcs = ([...new Set(midis.map((m: number) => ((m % 12) + 12) % 12))] as number[]).sort((a, b) => a - b);
  const names = pcs.map((p) => pcNames[p]);
  
  // Identify chord
  try {
    const cands = identifyChordCandidates(ev.notes);
    const top = cands?.[0];
    const rootStr = typeof top?.root === 'string' ? top.root : '?';
    console.log(`  m${meas} b${beat.toFixed(1)} (ab=${ev.absBeat}) pcs=[${pcs}] names=[${names}] → root=${rootStr} type=${top?.type || '?'}`);
  } catch {
    console.log(`  m${meas} b${beat.toFixed(1)} (ab=${ev.absBeat}) pcs=[${pcs}] names=[${names}] → (chord ID failed)`);
  }
}

// Build ChordEvent array exactly as useHarmonyLabels does
console.log('\n=== Building ChordEvent array ===');
const _chEvts: ChordEvent[] = [];
for (const ev of timeline) {
  if (!ev?.notes?.length) continue;
  try {
    const cands = identifyChordCandidates(ev.notes);
    const top = cands?.[0];
    if (!top?.root) continue;
    const rootPc = typeof top.root === 'string'
      ? noteNameToPc(top.root)
      : (((Number((top.root as any)?.noteIndex ?? (top.root as any)?.midi ?? 0)) % 12) + 12) % 12;
    const bassMidi = Math.min(...(ev.notes as any[]).map((n: any) => Number(n.midi)));
    const bassPc = ((bassMidi % 12) + 12) % 12;
    _chEvts.push({
      rootPc, quality: top.type || '', bassPc, absBeat: ev.absBeat,
      notePcs: [...new Set((ev.notes as any[]).map((n: any) => ((Number(n.midi) % 12) + 12) % 12))]
    });
  } catch { /* skip */ }
}

// Show chord events around m10-m12
console.log('\n=== ChordEvents m9-m12 ===');
for (const ce of _chEvts) {
  if (ce.absBeat < startBeat - 0.01 || ce.absBeat >= endBeat + 0.01) continue;
  const meas = Math.floor(ce.absBeat / beatsPerMeasure) + 1;
  const beat = (ce.absBeat % beatsPerMeasure) + 1;
  console.log(`  m${meas} b${beat.toFixed(1)} (ab=${ce.absBeat}) root=${pcNames[ce.rootPc]}(${ce.rootPc}) quality=${ce.quality} bass=${pcNames[ce.bassPc]}(${ce.bassPc}) pcs=[${ce.notePcs?.map(p => pcNames[p]).join(',')}]`);
}

// Run cadential pattern recognition
console.log('\n=== Cadential Pattern Matches ===');
const _cadMatches = evaluateCadentialPatterns(
  _chEvts, noteNameToPc(currentTonic), isMinorMode, { minConfidence: 70 },
);
for (const m of _cadMatches) {
  const sMeas = Math.floor(m.startBeat / beatsPerMeasure) + 1;
  const sBeat = (m.startBeat % beatsPerMeasure) + 1;
  const eMeas = Math.floor(m.endBeat / beatsPerMeasure) + 1;
  const eBeat = (m.endBeat % beatsPerMeasure) + 1;
  console.log(`  ${m.formulaId} → ${pcToNoteName(m.targetTonicPc)} ${m.targetIsMinor ? 'min' : 'Maj'} (conf=${m.confidence}) from m${sMeas}b${sBeat.toFixed(1)} to m${eMeas}b${eBeat.toFixed(1)} ${m.deceptive ? '[DECEPTIVE]' : ''}`);
}

// Simulate _effectiveCtxs construction
interface Ctx {
  absBeat: number;
  newTonic: string;
  newIsMinor: boolean;
  score: number;
  source: string;
}
let _effectiveCtxs: Ctx[] = [];
const _pivotCandidates = new Map<number, {tonic: string, isMinor: boolean}>();
const _manualBeats = new Set<number>();

for (const m of _cadMatches) {
  if (_manualBeats.has(m.startBeat)) continue;
  
  if (m.deceptive) {
    const _decTonic = pcToNoteName(m.targetTonicPc);
    const _decMinor = m.targetIsMinor;
    _effectiveCtxs.push({ absBeat: m.startBeat, newTonic: _decTonic, newIsMinor: _decMinor, score: 100, source: 'inferred' });
    const nextAfterDec = _chEvts.find(ev => ev.absBeat > m.endBeat + 1e-6);
    if (nextAfterDec) {
      const _decScale = new Set(getScalePcs(m.targetTonicPc, _decMinor));
      if (nextAfterDec.notePcs?.every(pc => _decScale.has(pc))) {
        _pivotCandidates.set(nextAfterDec.absBeat, { tonic: _decTonic, isMinor: _decMinor });
      }
      if (!_manualBeats.has(nextAfterDec.absBeat)) {
        _effectiveCtxs.push({ absBeat: nextAfterDec.absBeat, newTonic: currentTonic, newIsMinor: isMinorMode, score: 0, source: 'inferred' });
      }
    }
    continue;
  }
  
  // Non-deceptive
  _effectiveCtxs.push({ absBeat: m.startBeat, newTonic: pcToNoteName(m.targetTonicPc), newIsMinor: m.targetIsMinor, score: m.confidence, source: 'inferred' });
  
  const nextEvAfterRes = _chEvts.find(ev => ev.absBeat > m.endBeat + 1e-6);
  if (nextEvAfterRes) {
    const _tgtScale = new Set(getScalePcs(m.targetTonicPc, m.targetIsMinor));
    const nextIsDiatonic = nextEvAfterRes.notePcs?.every(pc => _tgtScale.has(pc));
    if (nextIsDiatonic) {
      _pivotCandidates.set(nextEvAfterRes.absBeat, { tonic: pcToNoteName(m.targetTonicPc), isMinor: m.targetIsMinor });
    }
    const returnBeat = nextEvAfterRes.absBeat;
    const coveredByNext = _cadMatches.some(
      other => other !== m && other.startBeat <= returnBeat + 1e-6 && other.endBeat >= returnBeat - 1e-6,
    );
    if (!coveredByNext && !_manualBeats.has(returnBeat)) {
      _effectiveCtxs.push({ absBeat: returnBeat, newTonic: currentTonic, newIsMinor: isMinorMode, score: 0, source: 'inferred' });
    }
  }
}

// Dominant Resolution Extension
const _homeScalePcs = new Set(getScalePcs(noteNameToPc(currentTonic), isMinorMode));
for (let ci = 0; ci < _chEvts.length - 1; ci++) {
  const dom = _chEvts[ci], res = _chEvts[ci + 1];
  if (((dom.rootPc - res.rootPc + 12) % 12) !== 7) continue;
  if (qualityFamily(dom.quality) !== 'major') continue;
  const _homePc = noteNameToPc(currentTonic);
  const isBVII_to_III = isMinorMode
    && dom.rootPc === (_homePc + 10) % 12
    && res.rootPc === (_homePc + 3) % 12
    && qualityFamily(res.quality) === 'major';
  if (!isBVII_to_III && !dom.notePcs?.some(pc => !_homeScalePcs.has(pc))) continue;
  const targetPc = res.rootPc;
  const targetIsMinor = qualityFamily(res.quality) !== 'major';
  const alreadyCovered = _effectiveCtxs.some(c =>
    Math.abs(c.absBeat - dom.absBeat) < 0.1
    && noteNameToPc(c.newTonic) === targetPc);
  if (alreadyCovered) continue;
  
  const dMeas = Math.floor(dom.absBeat / beatsPerMeasure) + 1;
  const dBeat = (dom.absBeat % beatsPerMeasure) + 1;
  const rMeas = Math.floor(res.absBeat / beatsPerMeasure) + 1;
  const rBeat = (res.absBeat % beatsPerMeasure) + 1;
  console.log(`\n  DOM-RES EXTENSION: m${dMeas}b${dBeat.toFixed(1)} ${pcNames[dom.rootPc]}(${dom.quality}) → m${rMeas}b${rBeat.toFixed(1)} ${pcNames[res.rootPc]}(${res.quality}) → target ${pcToNoteName(targetPc)} ${targetIsMinor ? 'min' : 'Maj'}`);
  
  _effectiveCtxs.push({ absBeat: dom.absBeat, newTonic: pcToNoteName(targetPc), newIsMinor: targetIsMinor, score: 65, source: 'inferred' });
  
  const _nextAfterRes = _chEvts.find(ev => ev.absBeat > res.absBeat + 1e-6);
  if (_nextAfterRes) {
    const _tgtScaleD = new Set(getScalePcs(targetPc, targetIsMinor));
    const nextIsDiatonicD = _nextAfterRes.notePcs?.every(pc => _tgtScaleD.has(pc));
    if (nextIsDiatonicD) {
      _pivotCandidates.set(_nextAfterRes.absBeat, { tonic: pcToNoteName(targetPc), isMinor: targetIsMinor });
    }
    if (!_manualBeats.has(_nextAfterRes.absBeat)) {
      _effectiveCtxs.push({ absBeat: _nextAfterRes.absBeat, newTonic: currentTonic, newIsMinor: isMinorMode, score: 0, source: 'inferred' });
    }
  }
}

// Sort effective contexts
_effectiveCtxs.sort((a, b) => a.absBeat - b.absBeat);

console.log('\n=== All effective contexts (m9-m13) ===');
for (const c of _effectiveCtxs) {
  if (c.absBeat < startBeat - 0.01 || c.absBeat >= endBeat + beatsPerMeasure + 0.01) continue;
  const meas = Math.floor(c.absBeat / beatsPerMeasure) + 1;
  const beat = (c.absBeat % beatsPerMeasure) + 1;
  console.log(`  m${meas} b${beat.toFixed(1)} (ab=${c.absBeat}): ${c.newTonic} ${c.newIsMinor ? 'min' : 'Maj'} score=${c.score} [${c.source}]`);
}

console.log('\n=== Pivot candidates (m9-m13) ===');
for (const [beat, info] of _pivotCandidates) {
  if (beat < startBeat - 0.01 || beat >= endBeat + beatsPerMeasure + 0.01) continue;
  const meas = Math.floor(beat / beatsPerMeasure) + 1;
  const b = (beat % beatsPerMeasure) + 1;
  console.log(`  m${meas} b${b.toFixed(1)} (ab=${beat}): pivot from ${info.tonic} ${info.isMinor ? 'min' : 'Maj'}`);
}

// ctxAtAbsBeat simulator
function ctxAtAbsBeat(absBeat: number): Ctx | undefined {
  return _effectiveCtxs
    .filter(c => c.absBeat <= absBeat + 1e-6)
    .sort((a, b) => {
      const d = b.absBeat - a.absBeat;
      if (Math.abs(d) > 1e-6) return d;
      return (b.score ?? 0) - (a.score ?? 0);
    })[0];
}

// Show what context is active at m11 b4
const m11b4_ab = 10 * beatsPerMeasure + 3; // measure 11 beat 4 = absBeat 43
console.log(`\n=== Context at m11 b4 (ab=${m11b4_ab}) ===`);
const ctx = ctxAtAbsBeat(m11b4_ab);
console.log('  Active context:', ctx);

// Also show m11 b1-b4
for (let b = 0; b < 4; b++) {
  const ab = 10 * beatsPerMeasure + b;
  const c = ctxAtAbsBeat(ab);
  console.log(`  m11 b${b+1} (ab=${ab}): ctx = ${c ? c.newTonic + ' ' + (c.newIsMinor ? 'min':'Maj') + ' score=' + c.score : 'HOME'}`);
}

// Show roman analysis at m11 b4
console.log('\n=== Roman at m11 b4 under each possible context ===');
const m11b4_ev = timeline.find((ev: any) => Math.abs(ev.absBeat - m11b4_ab) < 0.5);
if (m11b4_ev) {
  const contexts = [
    { tonic: 'Bb', isMinor: false, label: 'Bb Maj (home)' },
    { tonic: 'F', isMinor: false, label: 'F Maj' },
    { tonic: 'D', isMinor: true, label: 'D min' },
    { tonic: 'D', isMinor: false, label: 'D Maj' },
  ];
  for (const c of contexts) {
    const r = getRomanAnalysis(m11b4_ev.notes, c.tonic, c.isMinor);
    console.log(`  In ${c.label}: roman = ${r?.roman || '?'}`);
  }
}

// Show ALL effective contexts to find any Dm
console.log('\n=== ALL Dm/D contexts in entire piece ===');
for (const c of _effectiveCtxs) {
  if (c.newTonic === 'D') {
    const meas = Math.floor(c.absBeat / beatsPerMeasure) + 1;
    const beat = (c.absBeat % beatsPerMeasure) + 1;
    console.log(`  m${meas} b${beat.toFixed(1)} (ab=${c.absBeat}): ${c.newTonic} ${c.newIsMinor ? 'min' : 'Maj'} score=${c.score}`);
  }
}

// Check: is there any context at m11 b4 that's NOT Bb?
console.log('\n=== Contexts AT m11 b4 beat ===');
for (const c of _effectiveCtxs) {
  if (Math.abs(c.absBeat - m11b4_ab) < 0.5) {
    const meas = Math.floor(c.absBeat / beatsPerMeasure) + 1;
    const beat = (c.absBeat % beatsPerMeasure) + 1;
    console.log(`  m${meas} b${beat.toFixed(1)} (ab=${c.absBeat}): ${c.newTonic} ${c.newIsMinor ? 'min' : 'Maj'} score=${c.score}`);
  }
}
