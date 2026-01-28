import fs from 'fs';
import { calculateNoteBeats, getActiveNotesTimeline, getRomanAnalysis } from '../src/utils/musicTheory';
import { detectVoiceLeadingSequences } from '../src/utils/sequenceDetector';

const TICKS_PER_QUARTER = 192;

const filePath = 'tests/Dubois 2 p.11.json';
const fx = JSON.parse(fs.readFileSync(filePath, 'utf8')) as any;

const timeSignature = fx.timeSignature || { numerator: 4, denominator: 4 };
const timeSignatureChanges = Array.isArray(fx.timeSignatureChanges) ? fx.timeSignatureChanges : [];
const keySignatureRoot = String(fx.keySignatureRoot || 'C');
const isMinorMode = !!fx.isMinorMode;

const beatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);

const notes = calculateNoteBeats(Array.isArray(fx.notes) ? fx.notes : [], timeSignature, timeSignatureChanges);
const timeline = getActiveNotesTimeline(notes as any, timeSignature, timeSignatureChanges);

const isCompoundMeter = timeSignature.denominator === 8 && (timeSignature.numerator % 3 === 0) && timeSignature.numerator > 3;
const isStrongPulseInMeasure = (inMeasureBeats0: number) => {
    const EPS = 1e-3;
    if (isCompoundMeter) {
        const pulse = 1.5;
        const r = ((inMeasureBeats0 % pulse) + pulse) % pulse;
        return Math.abs(r) < EPS || Math.abs(pulse - r) < EPS;
    }
    const nearInt = (x: number) => Math.abs(x - Math.round(x)) < EPS;
    if (!nearInt(inMeasureBeats0)) return false;
    const beat0 = Math.round(inMeasureBeats0);
    return beat0 === 0 || (timeSignature.numerator >= 4 && beat0 === 2);
};

const timelineForLabels = (timeline || []).filter((ev: any, idx: number) => {
    if (!ev) return false;
    if (idx === 0) return true;
    const prev = timeline[idx - 1] as any;
    const prevIds = new Set<string>((prev?.notes || []).map((n: any) => String(n?.id ?? '')));
    const curNotes = (ev?.notes || []) as any[];
    const hasOnset = curNotes.some(n => {
        const id = String(n?.id ?? '');
        return id && !prevIds.has(id);
    });
    if (hasOnset) return true;

    const curIds = new Set<string>(curNotes.map(n => String(n?.id ?? '')).filter(Boolean));
    const removed = Array.from(prevIds).some(id => id && !curIds.has(id));
    if (!removed) return false;

    const absBeat = Number(ev?.absBeat);
    if (!Number.isFinite(absBeat)) return false;
    const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
    return isStrongPulseInMeasure(inMeasure);
});

const labelPoints = (timelineForLabels || [])
    .map((ev: any) => {
        const absBeat = Number(ev?.absBeat);
        if (!Number.isFinite(absBeat)) return null;
        const r = getRomanAnalysis((ev?.notes || []) as any, keySignatureRoot, isMinorMode);
        return {
            absBeat,
            tick: Math.round(absBeat * TICKS_PER_QUARTER),
            roman: String(r?.roman || ''),
            figures: Array.isArray(r?.figures) ? r!.figures.map(String) : [],
        };
    })
    .filter(Boolean) as Array<{ absBeat: number; tick: number; roman: string; figures: string[] }>;

const matches = detectVoiceLeadingSequences(notes as any, timeSignature, timeSignatureChanges, labelPoints as any, {
    minSteps: 2,
    maxSteps: 12,
    snapTicks: 8,
    maxMatches: 200,
});

const absAt = (measure1: number, beat1: number) => ((measure1 - 1) * beatsPerMeasure) + (beat1 - 1);
const targets = [
    { name: 'm5 b3', absBeat: absAt(5, 3) },
    { name: 'm8 b3', absBeat: absAt(8, 3) },
].map(t => ({ ...t, tick: Math.round(t.absBeat * TICKS_PER_QUARTER) }));

console.log({ filePath, keySignatureRoot, isMinorMode, timeSignature, labelPoints: labelPoints.length, matches: matches.length });
console.log('targets', targets);

// Also inspect the missing slot in the reported sequence: tick 4800 => absBeat 25 in 4/4.
try {
    const ab = 25;
    let best: any = null;
    for (const ev of (timeline || [])) {
        if (!ev || typeof ev.absBeat !== 'number') continue;
        if (ev.absBeat <= ab + 1e-6) best = ev;
        else break;
    }
    const r = getRomanAnalysis((best?.notes || []) as any, keySignatureRoot, isMinorMode);
    console.log('slot@absBeat25', { roman: r?.roman, figures: r?.figures });
} catch {
    // ignore
}

for (const t of targets) {
    const hits = matches.filter((m: any) => t.tick >= m.startTick && t.tick <= m.endTick);
    console.log(`\n== ${t.name} abs=${t.absBeat} tick=${t.tick} ==`);
    if (!hits.length) {
        console.log('no sequence match covers this point');
        continue;
    }
    for (const m of hits) {
        console.log({ startMeasure: m.startMeasure + 1, endMeasure: m.endMeasure + 1, lengthSteps: m.lengthSteps, repeatsCount: m.repeatsCount, transpositionSemitones: m.transpositionSemitones, label: m.label });
        const slots: number[] = Array.isArray(m.slotTicks) ? m.slotTicks : [];
        const L = m.lengthSteps;
        const start = m.startSlotIdx;
        const repeats = Math.max(2, Number(m.repeatsCount ?? 2));

        const findNearestByTick = (tick: number) => {
            let best: any = null;
            let bestDist = Infinity;
            for (const p of labelPoints) {
                const d = Math.abs(p.tick - tick);
                if (d < bestDist) {
                    bestDist = d;
                    best = p;
                }
            }
            return bestDist <= 12 ? best : null;
        };

        const template: Array<{ k: number; tick: number; roman: string; absBeat: number }> = [];
        for (let k = 0; k <= L; k++) {
            const tick = slots[start + k];
            const p = Number.isFinite(tick) ? findNearestByTick(tick) : null;
            template.push({ k, tick, roman: p?.roman || '', absBeat: p?.absBeat ?? NaN });
        }

        const repeatsDump: any[] = [];
        for (let r = 1; r < repeats; r++) {
            for (let k = 0; k <= L; k++) {
                const tick = slots[start + r * L + k];
                const p = Number.isFinite(tick) ? findNearestByTick(tick) : null;
                repeatsDump.push({ r, k, tick, roman: p?.roman || '', absBeat: p?.absBeat ?? NaN });
            }
        }

        console.log('templateRomans', template.map(x => x.roman));
        console.log('template', template);
        console.log('repeats', repeatsDump.slice(0, (L + 1) * Math.min(2, repeats - 1)));
    }
}
