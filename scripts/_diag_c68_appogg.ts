import { applyHarmonyRules, getActiveNotesTimeline, getRomanAnalysis, getKeySignature } from '../src/utils/musicTheory';
import * as fs from 'fs';
import * as path from 'path';

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../tests/Delamont C68 3.htp'), 'utf8'));
const ks = getKeySignature(raw.keySignatureRoot, raw.isMinorMode ? 'Minor' : 'Major');
const result = applyHarmonyRules(
    raw.notes, ks, raw.keyTonic ?? raw.keySignatureRoot, raw.isMinorMode,
    raw.analysisContexts || [], raw.timeSignature,
    raw.doubleBarlineMeasures || [], raw.ornamentOverrides || [], raw.harmonyOverrides || []
);

const timeline = getActiveNotesTimeline(result.analyzedNotes as any, raw.timeSignature);

// m=2 (0-based), beat=4: absBeat = 2*4 + 3 = 11
const ev11 = timeline.find((e: any) => Math.abs(e.absBeat - 11) < 0.01);
if (ev11) {
    console.log('\n=== absBeat=11 (m3 b4) ===');
    for (const n of ev11.notes) {
        const a = n as any;
        console.log('  v=' + a.voice + ' ' + a.pitch + a.octave + ' midi=' + a.midi + ' dur=' + a.duration +
            ' isAppogg=' + (!!a.isAppoggiatura) + ' isPassing=' + (!!a.isPassing) + ' isNeighbor=' + (!!a.isNeighbor) +
            ' _appoggRes=' + JSON.stringify(a._appoggResolution || null));
    }
    const raAll = getRomanAnalysis(ev11.notes as any, raw.keyTonic ?? raw.keySignatureRoot, raw.isMinorMode);
    console.log('\nRomanAll: ' + (raAll?.roman ?? '(null)') + ' figures: ' + JSON.stringify(raAll?.figures));

    // Filter like structuralNotes would, including resolution substitution
    const resolutionSubs: any[] = [];
    const structural = ev11.notes.filter((n: any) => {
        if (n.isAppoggiatura || n.isPassing || n.isNeighbor || n.isAnticipation || n.isEscape) {
            if (n.isAppoggiatura && n._appoggResolution) {
                resolutionSubs.push(n._appoggResolution);
            }
            return false;
        }
        return true;
    });
    // Add resolution substitutes
    const existingMidis = new Set(structural.map((nn: any) => nn?.midi));
    for (const sub of resolutionSubs) {
        if (sub.midi != null && !existingMidis.has(sub.midi)) {
            structural.push({ ...sub, isRest: false });
            existingMidis.add(sub.midi);
        }
    }
    console.log('Structural notes with resolution (' + structural.length + '):');
    for (const n of structural) {
        const a = n as any;
        console.log('  v=' + a.voice + ' ' + a.pitch + a.octave + ' midi=' + a.midi);
    }
    const raFiltered = getRomanAnalysis(structural as any, raw.keyTonic ?? raw.keySignatureRoot, raw.isMinorMode);
    console.log('RomanFiltered: ' + (raFiltered?.roman ?? '(null)') + ' figures: ' + JSON.stringify(raFiltered?.figures));
} else {
    console.log('No event at absBeat=11! Listing nearby events:');
    for (const ev of timeline) {
        const ab = (ev as any).absBeat;
        if (ab >= 10 && ab <= 13) {
            console.log('  absBeat=' + ab + ' notes=' + ev.notes.length);
        }
    }
}
