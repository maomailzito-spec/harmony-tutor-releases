import { applyHarmonyRules, getActiveNotesTimeline, getRomanAnalysis, getKeySignature, identifyChordCandidates } from '../src/utils/musicTheory';
import { structuralNotes } from '../src/utils/harmonyLabelPipeline';
import * as fs from 'fs';
import * as path from 'path';

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../tests/Delamont C69 4b.htp'), 'utf8'));
const ks = getKeySignature(raw.keySignatureRoot, raw.isMinorMode ? 'Minor' : 'Major');
const currentTonic = raw.keySignatureRoot;
const isMinorMode = raw.isMinorMode || false;

const result = applyHarmonyRules(
    raw.notes, ks, currentTonic, isMinorMode,
    raw.analysisContexts || [], raw.timeSignature,
    raw.doubleBarlineMeasures || [], raw.ornamentOverrides || [], raw.harmonyOverrides || []
);

const timeline = getActiveNotesTimeline(result.analyzedNotes as any, raw.timeSignature);

// Build base array exactly like the hook
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

// Print base around m3
console.log('=== Base array m3 ===');
for (let i = 0; i < base.length; i++) {
    const ab = base[i].absBeat;
    if (ab < 7 || ab > 13) continue;
    const m = Math.floor(ab / 4) + 1;
    const b = (ab % 4) + 1;
    console.log('  idx=' + i + ' absBeat=' + ab.toFixed(2) + ' (m' + m + ' b' + b.toFixed(1) + ') roman=' + base[i].roman);
}

// Find ALL V/ii entries
const viiEntries: number[] = [];
for (let i = 0; i < base.length; i++) {
    if (/^([Vv])\/(.+)$/.test(base[i].roman)) viiEntries.push(i);
}
console.log('\nAll V/x entries:');
for (const idx of viiEntries) {
    console.log('  idx=' + idx + ' absBeat=' + base[idx].absBeat + ' roman=' + base[idx].roman);
}

// Process each V/x like the hook does
for (const jVii of viiEntries) {
    const bj = base[jVii];
    const rj = String(bj.roman || '');
    const m = rj.match(/^([Vv])\/(.+)$/);
    if (!m) continue;
    const targetRoman = String(m[2] || '').trim();
    if (!targetRoman) continue;
    
    console.log('\n--- Processing j=' + jVii + ' (' + rj + ') at beat ' + bj.absBeat + ' ---');
    
    // Find resolution
    let k = -1;
    for (let t = jVii + 1; t < base.length; t++) {
        if ((base[t].absBeat - bj.absBeat) > 8 + 1e-6) break;
        if (String(base[t].roman || '') === targetRoman) {
            k = t;
            break;
        }
    }
    console.log('Resolution ' + targetRoman + ' at idx=' + k + (k >= 0 ? ' absBeat=' + base[k].absBeat : ''));
    if (k < 0) continue;
    
    const tonicizedIsMinor = targetRoman === targetRoman.toLowerCase();
    console.log('tonicizedIsMinor=' + tonicizedIsMinor);
    
    // Lookback
    for (let i = jVii - 1; i >= 0; i--) {
        const bi = base[i];
        if ((bj.absBeat - bi.absBeat) > 8 + 1e-6) break;
        
        const biRoman = String(bi.roman || '');
        console.log('  lookback idx=' + i + ' beat=' + bi.absBeat.toFixed(2) + ' globalRoman=' + biRoman);
        
        if (biRoman.includes('/')) {
            console.log('    -> SKIP (has /)');
            continue;
        }
        
        const stI = structuralNotes(bi.ev?.notes || []);
        const rr = getRomanAnalysis(stI as any, 'E', tonicizedIsMinor);
        const localRoman = String(rr?.roman || '').replace(/\/.*$/, '');
        console.log('    localRoman(Em)=' + localRoman);
        
        // ii° check
        if (/^ii/i.test(localRoman) && (localRoman.includes('°') || localRoman.includes('ø'))) {
            console.log('    -> MATCH ii° -> ' + localRoman + '/' + targetRoman);
            break;
        }
        
        // VI check (my new code)
        if (tonicizedIsMinor && localRoman === 'VI') {
            const _lbCands = identifyChordCandidates(stI as any);
            const _lbQ = String(_lbCands?.[0]?.type || '').toLowerCase();
            console.log('    -> VI check: quality=' + _lbQ);
            const isHalfDim = _lbQ.includes('diminish') || (_lbQ.includes('minor 7') && _lbQ.includes('5'));
            console.log('    -> isHalfDim=' + isHalfDim);
            if (isHalfDim) {
                console.log('    -> MATCH vi°/' + targetRoman);
            }
            break;
        }
        
        if (localRoman === 'iv') {
            console.log('    -> MATCH iv/' + targetRoman);
            break;
        }
        
        console.log('    -> no match');
    }
}
