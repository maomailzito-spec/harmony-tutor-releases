import * as fs from 'fs';
import { applyHarmonyRules, getKeySignature, getActiveNotesTimeline } from '../src/utils/musicTheory';

const d = JSON.parse(fs.readFileSync('tests/Delamont C67 2a.htp', 'utf8'));
// User says G major but file has no keySignature — the file likely has a keySignatureRoot
const root = d.keySignatureRoot || 'G';
const isMinor = !!d.isMinorMode;
const ks = getKeySignature(root, isMinor ? 'minor' : 'Major');
const ts = d.timeSignature || { numerator: 4, denominator: 4 };

console.log('Key:', root, isMinor ? 'minor' : 'Major', 'ks:', JSON.stringify(ks));
console.log('Time:', JSON.stringify(ts));

const res = applyHarmonyRules(
    d.notes, ks, root, isMinor,
    d.analysisContexts || [], ts, d.doubleBarlineMeasures || [],
    d.ornamentOverrides || [], d.harmonyOverrides || []
) as any;

const notes = res.analyzedNotes || [];
const timeline = getActiveNotesTimeline(notes, ts);

for (const ev of timeline) {
    const abs = Number(ev.absBeat);
    // Focus on measure 1 (abs 0-4) — especially beat 4 (abs 3)
    if (abs > 5) continue;
    const m = Math.floor(abs / 4) + 1;
    const b = (abs % 4) + 1;
    const evNotes = (ev.notes || []).filter((n: any) => n && !n.isRest);
    
    console.log(`\nm${m} b${b.toFixed(2)} abs=${abs}:`);
    for (const n of evNotes) {
        const an = n as any;
        const s = an.isSuspension;
        const susp = s ? `SUSP(type=${s.type} from=${s.fromAbsBeat} resolvedById=${s.resolvedById} resolvedMidi=${s.resolvedMidi})` : '';
        const isPassing = an.isPassing ? ' PASSING' : '';
        const isNeighbor = an.isNeighbor ? ' NEIGHBOR' : '';
        const isEsc = an.isEscape ? ' ESCAPE' : '';
        const isCamb = an.isCambiata ? ' CAMBIATA' : '';
        const isApp = an.isAppoggiatura ? ' APPOG' : '';
        const ornMark = an.ornamentMark ? ` mark=${an.ornamentMark}` : '';
        const ornOv = an.ornamentOverride ? ` ornOv=${an.ornamentOverride}` : '';
        console.log(`  v${n.voice} ${n.pitch}${an.accidental||''}${n.octave} midi=${n.midi}${isPassing}${isNeighbor}${isEsc}${isCamb}${isApp}${ornMark}${ornOv} ${susp}`);
    }
}

// Also show the labels produced
const viols = res.violations || [];
console.log('\n--- Analysis labels (violations/ornaments) for m1 ---');
for (const v of viols) {
    // Check if any noteId maps to m0
    const noteIds = v.noteIds || [];
    const relNotes = notes.filter((n: any) => noteIds.includes(n.id) && (n.measureIndex === 0 || n.measureIndex === 1));
    if (relNotes.length > 0) {
        console.log(`  ${v.ruleId} [${v.severity}] ${v.description}`);
    }
}

// Show inferred labels from connections
const conns = res.connections || [];
console.log('\n--- Connections for m1 ---');
for (const c of conns as any[]) {
    if (c.measureIndex === 0 || c.measureIndex === 1) {
        console.log(`  m${(c.measureIndex||0)+1} b${c.beat}: ${JSON.stringify(c)}`);
    }
}
