import { applyHarmonyRules, getActiveNotesTimeline, getRomanAnalysis, getKeySignature, identifyChordCandidates } from '../src/utils/musicTheory';
import { structuralNotes } from '../src/utils/harmonyLabelPipeline';
import * as fs from 'fs';
import * as path from 'path';

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

// Show beats around m3 (absBeat 8-12)
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
    
    const rootPitch = topCand?.root && typeof topCand.root === 'object'
        ? (topCand.root as any)?.pitch + ((topCand.root as any)?.accidental === 'sharp' ? '#' : (topCand.root as any)?.accidental === 'flat' ? 'b' : '')
        : String(topCand?.root ?? '-');

    console.log('  absBeat=' + ab.toFixed(2) + ' (m' + m + ' b' + b.toFixed(1) + ')' +
        ' roman/D=' + (ra?.roman ?? '-') +
        ' roman/Em=' + (raEm?.roman ?? '-') +
        ' cand=' + (topCand?.type ?? '-') + 
        ' root=' + rootPitch);
    
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
        const rootPitch = typeof c.root === 'object'
            ? (c.root as any)?.pitch + ((c.root as any)?.accidental === 'sharp' ? '#' : (c.root as any)?.accidental === 'flat' ? 'b' : '')
            : String(c.root);
        console.log('  type=' + c.type + ' root=' + rootPitch + ' score=' + (c as any).score + ' priority=' + (c as any).priority);
    }
    
    // Check in various keys
    const keys: [string, string, boolean][] = [
        ['D maj', 'D', false],
        ['E min (natural)', 'E', true],
        ['E maj (for ref)', 'E', false],
    ];
    for (const [label, tonic, minor] of keys) {
        const r = getRomanAnalysis(sn as any, tonic, minor);
        console.log('  In ' + label + ': roman=' + r?.roman + ' figures=' + JSON.stringify(r?.figures));
    }
    
    // Print all notes including non-structural for reference
    console.log('\n  ALL notes at m3b3:');
    for (const n of ev10.notes as any[]) {
        console.log('    v=' + n.voice + ' ' + n.pitch + 
            (n.accidental === 'sharp' ? '#' : n.accidental === 'flat' ? 'b' : '') + 
            n.octave + ' midi=' + n.midi +
            ' acc=' + (n.accidental || 'none'));
    }
}
