import { applyHarmonyRules, getActiveNotesTimeline, getRomanAnalysis, getKeySignature, identifyChordCandidates } from '../src/utils/musicTheory';
import { structuralNotes } from '../src/utils/harmonyLabelPipeline';
import { shouldBlockTonicization } from '../src/utils/modalInterchange';
import * as fs from 'fs';
import * as path from 'path';

const noteNameToChromaticIndex = (name: string): number => {
    const map: Record<string, number> = {'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'F':5,'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11};
    return map[name] ?? -1;
};

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../tests/Delamont C69 4b.htp'), 'utf8'));
const ks = getKeySignature(raw.keySignatureRoot, raw.isMinorMode ? 'Minor' : 'Major');
const currentTonic = raw.keySignatureRoot;
const isMinorMode = raw.isMinorMode || false;
console.log('Key: ' + currentTonic + (isMinorMode ? ' minor' : ' major'));

const result = applyHarmonyRules(
    raw.notes, ks, currentTonic, isMinorMode,
    raw.analysisContexts || [], raw.timeSignature,
    raw.doubleBarlineMeasures || [], raw.ornamentOverrides || [], raw.harmonyOverrides || []
);

const timeline = getActiveNotesTimeline(result.analyzedNotes as any, raw.timeSignature);

// Show beats around m3 b3 (= absBeat 10)
console.log('\n=== Timeline around m3 ===');
for (const ev of timeline) {
    const ab = (ev as any).absBeat;
    if (ab < 8 || ab > 12.5) continue;
    const m = Math.floor(ab / 4) + 1;
    const b = (ab % 4) + 1;
    const sn = structuralNotes(ev.notes as any);
    const ra = getRomanAnalysis(sn as any, currentTonic, isMinorMode);
    const raEm = getRomanAnalysis(sn as any, 'E', true);
    const cands = identifyChordCandidates(sn as any);
    const topCand = cands?.[0];
    
    console.log('  absBeat=' + ab.toFixed(2) + ' (m' + m + ' b' + b.toFixed(1) + ')' +
        ' roman/D=' + (ra?.roman ?? '-') +
        ' roman/Em=' + (raEm?.roman ?? '-') +
        ' cand=' + (topCand?.type ?? '-') + 
        ' root=' + (typeof topCand?.root === 'object' ? (topCand?.root as any)?.pitch + ((topCand?.root as any)?.accidental === 'sharp' ? '#' : (topCand?.root as any)?.accidental === 'flat' ? 'b' : '') : topCand?.root));
    
    console.log('    notes: ' + (sn as any[]).map((n: any) => 
        n.pitch + (n.accidental === 'sharp' ? '#' : n.accidental === 'flat' ? 'b' : '') + n.octave + '(' + n.midi + ')'
    ).join(' '));
}

// Focus on m3 b3 (absBeat = 10)
const ev10 = timeline.find((e: any) => Math.abs(e.absBeat - 10) < 0.05);
if (ev10) {
    console.log('\n=== Detail for m3 b3 (absBeat=10) ===');
    const sn = structuralNotes(ev10.notes as any);
    const cands = identifyChordCandidates(sn as any);
    console.log('All candidates:');
    for (const c of (cands || []).slice(0, 5)) {
        const rootPitch = typeof c.root === 'object' ? (c.root as any)?.pitch + ((c.root as any)?.accidental === 'sharp' ? '#' : (c.root as any)?.accidental === 'flat' ? 'b' : '') : c.root;
        console.log('  type=' + c.type + ' root=' + rootPitch + ' score=' + (c as any).score + ' priority=' + (c as any).priority);
    }
    
    // Check in various keys
    for (const [label, tonic, minor] of [['D maj', 'D', false], ['E min', 'E', true], ['E min (maj)', 'E', false]] as [string, string, boolean][]) {
        const r = getRomanAnalysis(sn as any, tonic, minor);
        console.log('  In ' + label + ': ' + r?.roman + ' figures=' + JSON.stringify(r?.figures));
    }
}

const result = applyHarmonyRules(
    raw.notes, ks, currentTonic, isMinorMode,
    raw.analysisContexts || [], raw.timeSignature,
    raw.doubleBarlineMeasures || [], raw.ornamentOverrides || [], raw.harmonyOverrides || []
);

const timeline = getActiveNotesTimeline(result.analyzedNotes as any, raw.timeSignature);

// Build base array matching hook
const base: any[] = [];
for (const ev of timeline) {
    if (!ev?.notes?.length) continue;
    const sNotes = structuralNotes(ev.notes as any);
    if (sNotes.length < 2) continue;
    const ra = getRomanAnalysis(sNotes as any, currentTonic, isMinorMode);
    base.push({
        ev, absBeat: ev.absBeat, q: ev.absBeat,
        ctxTonic: currentTonic, ctxIsMinor: isMinorMode,
        roman: ra?.roman ?? '',
    });
}

const _globalPc = noteNameToChromaticIndex(currentTonic);
const _scaleIntervals = isMinorMode ? [0,2,3,5,7,8,10] : [0,2,4,5,7,9,11];
const _scale = new Set(_scaleIntervals.map(i => (i + _globalPc) % 12));
const _degreeNames = isMinorMode
    ? ['i','\u266DII','ii\u00B0','\u266DIII','iv','v','\u266DVI','\u266DVII','VI','vi\u00B0','VII','vii\u00B0']
    : ['I','\u266DII','ii','\u266DIII','iii','IV','\u266EIV\u00B0','V','\u266DVI','vi','\u266DVII','vii\u00B0'];
const _keyDeg = (targetKey: string): string | null => {
    const tPc = noteNameToChromaticIndex(targetKey);
    if (tPc < 0 || _globalPc < 0) return null;
    const interval = ((tPc - _globalPc) % 12 + 12) % 12;
    return _degreeNames[interval] || null;
};
const _funcRe = /^(ii|III|IV|vi|I|iii|V|i|iv|v|\u266DVII|\u266DVI|\u266DIII)/;

// Simulate 12-key scan for K=Bb around beat 12
const K = 'Bb';
const j = base.findIndex(b => Math.abs(b.absBeat - 12) < 0.05);
console.log('=== 12-key scan simulation for K=' + K + ' j=' + j + ' (beat=' + base[j]?.absBeat + ') ===\n');

// Step 1: j entry checks
const _globalRoman = String(base[j].roman || '');
console.log('1. globalRoman=' + _globalRoman);
console.log('   includes /: ' + _globalRoman.includes('/'));
const _dreStrong = /^(I|i|II|ii|III|iii|IV|iv|V|v|VI|vi|VII|vii)(°|ø|7|6|64|$)/.test(_globalRoman);
console.log('   _dreStrong: ' + _dreStrong);

// Step 2: rJ in K
const stJ = structuralNotes(base[j].ev.notes as any);
const rJ = getRomanAnalysis(stJ as any, K, false);
console.log('2. rJ in ' + K + ': roman=' + rJ?.roman + ' figures=' + JSON.stringify(rJ?.figures));
console.log('   rJ.roman !== I: ' + (rJ?.roman !== 'I'));
// Quality check
const _arrCands = identifyChordCandidates(stJ as any);
const _arrQ = (_arrCands?.[0]?.type || '').toLowerCase();
console.log('   chord quality: ' + _arrQ);
console.log('   isMinor (not dim): ' + (_arrQ.includes('minor') && !_arrQ.includes('diminish')));

// Step 3: rPrev
const stPrev = structuralNotes(base[j-1].ev.notes as any);
const rPrev = getRomanAnalysis(stPrev as any, K, false);
console.log('3. rPrev in ' + K + ': roman=' + rPrev?.roman + ' (beat ' + base[j-1].absBeat + ')');
console.log('   /^(V|vii[°o])/ match: ' + /^(V|vii[°o])/.test(rPrev?.roman ?? ''));
console.log('   includes /: ' + (rPrev?.roman?.includes('/') ?? false));
const _isLeadingTone = /^vii[°o]/.test(rPrev?.roman ?? '');
console.log('   _isLeadingTone: ' + _isLeadingTone);

// Step 4: _keyDeg
const degLabel = _keyDeg(K);
console.log('4. degLabel: ' + degLabel);

// Step 5: lookback for pre-dominants
let firstIdx = j - 1;
const beatsPerMeasure = 4;
for (let i = j - 2; i >= 0 && (base[j].absBeat - base[i].absBeat) <= beatsPerMeasure * 2; i--) {
    if (!base[i].ev?.notes?.length) break;
    const stI = structuralNotes(base[i].ev.notes as any);
    if (stI.length < 2) break;
    const rI = getRomanAnalysis(stI as any, K, false);
    console.log('   lookback i=' + i + ' beat=' + base[i].absBeat + ' romanInBb=' + rI?.roman + ' funcMatch=' + _funcRe.test(rI?.roman ?? ''));
    if (rI && _funcRe.test(rI.roman)) firstIdx = i;
    else break;
}
console.log('5. firstIdx=' + firstIdx + ' (beat ' + base[firstIdx]?.absBeat + ')');

// Step 6: lookforward
let lastIdx = j;
for (let i = j + 1; i < base.length && (base[i].absBeat - base[j].absBeat) <= beatsPerMeasure * 2; i++) {
    if (!base[i].ev?.notes?.length) break;
    const stI = structuralNotes(base[i].ev.notes as any);
    if (stI.length < 2) break;
    const rI = getRomanAnalysis(stI as any, K, false);
    if (rI && _funcRe.test(rI.roman)) lastIdx = i;
    else break;
}
console.log('6. lastIdx=' + lastIdx + ' span=' + (lastIdx - firstIdx + 1));

// Step 7: chromatic evidence
let _hasChromatic = false;
for (let s = firstIdx; s <= lastIdx && !_hasChromatic; s++) {
    for (const n of (base[s].ev.notes || []) as any[]) {
        const pc = (((n as any).midi % 12) + 12) % 12;
        if (!_scale.has(pc)) { _hasChromatic = true; break; }
    }
}
console.log('7. chromatic evidence: ' + _hasChromatic);

// Step 8: per-chord processing
console.log('8. Per-chord labels:');
for (let s = firstIdx; s <= lastIdx; s++) {
    let chordChrom = false;
    for (const n of (base[s].ev.notes || []) as any[]) {
        const pc = (((n as any).midi % 12) + 12) % 12;
        if (!_scale.has(pc)) { chordChrom = true; break; }
    }

    // shouldBlockTonicization check
    const stS = structuralNotes(base[s].ev.notes as any);
    const candsS = identifyChordCandidates(stS as any);
    const topC = candsS?.[0];
    const topQ = topC?.type || '';
    const topRootPc = (() => {
        if (!topC?.root) return -1;
        if (typeof topC.root === 'string') return noteNameToChromaticIndex(topC.root);
        const ni = Number((topC.root as any)?.noteIndex);
        return Number.isFinite(ni) ? ((ni % 12) + 12) % 12 : -1;
    })();
    let blocked = false;
    if (topRootPc >= 0) {
        blocked = shouldBlockTonicization(topRootPc, topQ, currentTonic, isMinorMode);
    }

    const rS = getRomanAnalysis(stS as any, K, false);
    const localR = String(rS?.roman || '').replace(/\/.*$/, '');
    const displayNonCompact = (s === j) ? localR + '=' + degLabel : localR + '/' + degLabel;
    const displayCompact = (s === firstIdx) ? '[' + degLabel + '] ' + localR : localR;

    console.log('  s=' + s + ' beat=' + base[s].absBeat +
        ' chordChrom=' + chordChrom +
        ' blocked=' + blocked + ' (q=' + topQ + ' rootPc=' + topRootPc + ')' +
        ' romanBb=' + localR +
        ' display=' + displayNonCompact +
        ' compact=' + displayCompact);
}

