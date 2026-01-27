import { StaffNote, TimeSignature, TimeSignatureChange, SequenceMatch } from '../types';
import { DURATION_VALUES, TICKS_PER_QUARTER } from '../constants';

export type SequenceLabelPoint = {
    absBeat?: number;
    tick?: number;
    roman?: string;
    symbol?: string;
    figures?: string[];
};

export type SequenceDetectionOptions = {
    minSteps?: number;
    maxSteps?: number;
    snapTicks?: number;
    minConfidence?: number;
    maxMatches?: number;
};

const DEBUG_SEQUENCE = false;

const mod = (n: number, m: number) => ((n % m) + m) % m;
const mod12 = (n: number) => mod(n, 12);

const getDurationTicks = (n: StaffNote): number => {
    if (Number.isFinite(n.durationTicks as number)) return Math.max(0, Number(n.durationTicks));
    const base = (DURATION_VALUES as any)[n.duration] || 1;
    let beats = base;
    if (n.isDotted) beats *= 1.5;
    if (n.isTriplet) beats *= 2 / 3;
    if (n.isDuplet) beats *= 3 / 2;
    return Math.max(0, Math.round(beats * TICKS_PER_QUARTER));
};

const normalizeTimeSignatureChanges = (timeSignature: TimeSignature, timeSignatureChanges?: TimeSignatureChange[]) => {
    const baseBeatsPerMeasure = timeSignature.numerator * (4 / timeSignature.denominator);
    const base = Math.max(1, Number.isFinite(baseBeatsPerMeasure) ? baseBeatsPerMeasure : 4);
    return (timeSignatureChanges || [])
        .map(c => {
            const absBeat = Number(c.absBeat);
            const m = Number.isFinite(c.measureIndex as any)
                ? Number(c.measureIndex)
                : (Number.isFinite(absBeat) ? Math.floor(absBeat / base) : 0);
            const n = Math.max(1, Math.round(Number(c.numerator)));
            const d = Math.max(1, Math.round(Number(c.denominator)));
            return { measureIndex: m, numerator: n, denominator: d };
        })
        .filter(c => Number.isFinite(c.measureIndex))
        .sort((a, b) => a.measureIndex - b.measureIndex);
};

const getBeatsPerMeasureForIndex = (
    m: number,
    timeSignature: TimeSignature,
    changes: { measureIndex: number; numerator: number; denominator: number }[]
): number => {
    let active = timeSignature;
    for (const c of changes) {
        if (c.measureIndex <= m) {
            active = { numerator: c.numerator, denominator: c.denominator };
        } else {
            break;
        }
    }
    const bpm = active.numerator * (4 / active.denominator);
    return Math.max(1, Number.isFinite(bpm) ? bpm : 4);
};

const buildMeasureStartTicks = (
    maxTick: number,
    timeSignature: TimeSignature,
    changes: { measureIndex: number; numerator: number; denominator: number }[]
): number[] => {
    const measureStartTicks: number[] = [0];
    let m = 0;
    let acc = 0;
    while (acc <= maxTick + 1) {
        const beats = getBeatsPerMeasureForIndex(m, timeSignature, changes);
        const ticks = Math.round(beats * TICKS_PER_QUARTER);
        acc += ticks;
        m += 1;
        measureStartTicks[m] = acc;
        if (m > 10000) break;
    }
    return measureStartTicks;
};

const findMeasureIndexForTick = (tick: number, measureStartTicks: number[]): number => {
    for (let i = measureStartTicks.length - 1; i >= 0; i--) {
        if (tick >= (measureStartTicks[i] ?? 0) - 1e-6) return i;
    }
    return 0;
};

type VoiceSnapshot = {
    midi: number | null;
    pc: number | null;
    noteId?: string;
    isTiedToNext?: boolean;
    isTiedFromPrev?: boolean;
    position?: number | null;
};

type SlotSnapshot = {
    tick: number;
    voices: VoiceSnapshot[];
};

type VoicingSignature = {
    slotTick: number;
    vertical: Array<number | null>; // SA, AT, TB, SB
    melodic: Array<number | null>; // S, A, T, B (to next slot)
    verticalChromatic?: Array<number | null>; // semitones reduced within octave
};

const isActiveAtTick = (note: StaffNote, tick: number): boolean => {
    const start = Number(note.startTick) || 0;
    const end = start + getDurationTicks(note);
    return start <= tick && tick < end - 1e-6;
};

const reduceDiatonicSteps = (diff: number): number => {
    if (!Number.isFinite(diff) || diff === 0) return 0;
    const dir = Math.sign(diff);
    const abs = Math.abs(diff);
    let reduced = abs % 7;
    if (reduced === 0) reduced = 7;
    return dir * reduced;
};

const diatonicInterval = (posA: number | null | undefined, posB: number | null | undefined): number | null => {
    if (!Number.isFinite(posA as number) || !Number.isFinite(posB as number)) return null;
    return reduceDiatonicSteps(Number(posB) - Number(posA));
};


const buildSnapshots = (slots: number[], notes: StaffNote[]): SlotSnapshot[] => {
    const voices = [1, 2, 3, 4];
    const byVoice = voices.map(v =>
        notes
            .filter(n => !n.isRest && (n.voice ?? 1) === v)
            .slice()
            .sort((a, b) => (Number(a.startTick) || 0) - (Number(b.startTick) || 0))
    );

    const states = voices.map(() => ({ idx: 0, active: null as StaffNote | null }));
    const snapshots: SlotSnapshot[] = [];

    slots.forEach(tick => {
        const voicesSnap: VoiceSnapshot[] = [];
        byVoice.forEach((list, vIdx) => {
            const state = states[vIdx];
            let active = state.active;
            while (state.idx < list.length && (Number(list[state.idx].startTick) || 0) <= tick + 1e-6) {
                active = list[state.idx];
                state.idx += 1;
            }
            if (active && !isActiveAtTick(active, tick)) {
                active = null;
            }
            state.active = active;
            voicesSnap.push({
                midi: Number.isFinite(active?.midi as number) ? Number(active?.midi) : null,
                pc: Number.isFinite(active?.midi as number) ? mod12(Number(active?.midi)) : null,
                noteId: active?.id,
                isTiedToNext: active?.isTiedToNext,
                isTiedFromPrev: active?.isTiedFromPrev,
                position: Number.isFinite(active?.position as number) ? Number(active?.position) : null,
            });
        });
        snapshots.push({ tick, voices: voicesSnap });
    });

    return snapshots;
};

const buildVoicingSignatures = (snapshots: SlotSnapshot[]): VoicingSignature[] => {
    const sigs: VoicingSignature[] = [];
    for (let i = 0; i < snapshots.length - 1; i += 1) {
        const cur = snapshots[i];
        const next = snapshots[i + 1];
        const s = cur.voices[0]?.position ?? null;
        const a = cur.voices[1]?.position ?? null;
        const t = cur.voices[2]?.position ?? null;
        const b = cur.voices[3]?.position ?? null;
        const vertical: Array<number | null> = [
            diatonicInterval(a, s),
            diatonicInterval(t, a),
            diatonicInterval(b, t),
            diatonicInterval(b, s),
        ];

        const melodic: Array<number | null> = [
            diatonicInterval(s, next.voices[0]?.position ?? null),
            diatonicInterval(a, next.voices[1]?.position ?? null),
            diatonicInterval(t, next.voices[2]?.position ?? null),
            diatonicInterval(b, next.voices[3]?.position ?? null),
        ];

        sigs.push({ slotTick: cur.tick, vertical, melodic });
    }
    return sigs;
};

const signatureEqual = (a: VoicingSignature, b: VoicingSignature): boolean => {
    if (a.vertical.length !== b.vertical.length || a.melodic.length !== b.melodic.length) return false;
    for (let i = 0; i < a.vertical.length; i += 1) {
        if (a.vertical[i] == null || b.vertical[i] == null) return false;
        if (a.vertical[i] !== b.vertical[i]) return false;
    }
    for (let i = 0; i < a.melodic.length; i += 1) {
        if (a.melodic[i] == null || b.melodic[i] == null) return false;
        if (a.melodic[i] !== b.melodic[i]) return false;
    }
    return true;
};

const snapshotVoicingEqual = (a: SlotSnapshot, b: SlotSnapshot): boolean => {
    const aS = a.voices[0]?.position;
    const aA = a.voices[1]?.position;
    const aT = a.voices[2]?.position;
    const aB = a.voices[3]?.position;
    const bS = b.voices[0]?.position;
    const bA = b.voices[1]?.position;
    const bT = b.voices[2]?.position;
    const bB = b.voices[3]?.position;
    if (aS == null || aA == null || aT == null || aB == null) return false;
    if (bS == null || bA == null || bT == null || bB == null) return false;

    const aPattern = [
        reduceDiatonicSteps(aS - aA),
        reduceDiatonicSteps(aA - aT),
        reduceDiatonicSteps(aT - aB),
    ];
    const bPattern = [
        reduceDiatonicSteps(bS - bA),
        reduceDiatonicSteps(bA - bT),
        reduceDiatonicSteps(bT - bB),
    ];

    for (let i = 0; i < aPattern.length; i += 1) {
        if (aPattern[i] !== bPattern[i]) return false;
    }
    return true;
};

const computeTranspositionSemitones = (
    snapshots: SlotSnapshot[],
    startSlotIdx: number,
    lengthSteps: number
): number | null => {
    let deltaAll: number | null = null;
    for (let k = 0; k <= lengthSteps; k += 1) {
        const snapA = snapshots[startSlotIdx + k];
        const snapB = snapshots[startSlotIdx + lengthSteps + k];
        if (!snapA || !snapB) return null;

        let slotDelta: number | null = null;
        for (let v = 0; v < 4; v += 1) {
            const a = snapA.voices[v]?.midi;
            const b = snapB.voices[v]?.midi;
            if (!Number.isFinite(a as number) || !Number.isFinite(b as number)) continue;
            const d = Number(b) - Number(a);
            if (slotDelta == null) slotDelta = d;
            if (slotDelta !== d) return null;
        }
        if (slotDelta == null) return null;
        if (deltaAll == null) deltaAll = slotDelta;
        if (deltaAll !== slotDelta) return null;
    }
    return deltaAll;
};

const summarizeSlotsForDebug = (slots: number[]) => {
    if (!DEBUG_SEQUENCE) return;
    const head = slots.slice(0, 10).map(t => Math.round(t));
    const tail = slots.length > 10 ? slots.slice(-3).map(t => Math.round(t)) : [];
    const summary = slots.length > 13 ? `${head.join(', ')} ... ${tail.join(', ')}` : head.join(', ');
    console.log('[sequence] slots ticks:', summary, `(${slots.length})`);
};

const logExampleSnapshot = (snapshots: SlotSnapshot[]) => {
    if (!DEBUG_SEQUENCE) return;
    if (snapshots.length < 2) return;
    const a = snapshots[0];
    const b = snapshots[1];
    const fmt = (s: SlotSnapshot) => s.voices.map(v => (v.midi == null ? '·' : v.midi)).join(',');
    console.log('[sequence] snapshot example', {
        tickA: Math.round(a.tick),
        voicesA: fmt(a),
        tickB: Math.round(b.tick),
        voicesB: fmt(b),
    });
};

export function detectVoiceLeadingSequences(
    notes: StaffNote[],
    timeSignature: TimeSignature,
    timeSignatureChanges?: TimeSignatureChange[],
    harmonyLabels?: SequenceLabelPoint[],
    options?: SequenceDetectionOptions
): SequenceMatch[] {
    const minSteps = Math.max(1, Math.round(options?.minSteps ?? 1));
    const maxSteps = Math.max(minSteps, Math.round(options?.maxSteps ?? 8));
    const snapTicks = Math.max(0, Math.round(options?.snapTicks ?? 8));
    const maxMatches = Math.max(0, Math.round(options?.maxMatches ?? 200));

    const candidateTicks = new Set<number>();
    const onsetCounts = new Map<number, Set<number>>();
    (notes || []).forEach(n => {
        if (!n || n.isRest) return;
        const t = Number(n.startTick);
        if (Number.isFinite(t)) candidateTicks.add(Math.round(t));
        if (Number.isFinite(t)) {
            const key = Math.round(t);
            if (!onsetCounts.has(key)) onsetCounts.set(key, new Set());
            onsetCounts.get(key)!.add(Number(n.voice ?? 1));
        }
        const endTick = t + getDurationTicks(n);
        if (Number.isFinite(endTick)) candidateTicks.add(Math.round(endTick));
    });

    const sorted = Array.from(candidateTicks).sort((a, b) => a - b);
    if (sorted.length < 3) return [];

    const slots: number[] = [];
    sorted.forEach(t => {
        if (slots.length === 0) {
            slots.push(t);
            return;
        }
        const last = slots[slots.length - 1];
        if (Math.abs(t - last) <= snapTicks) return;
        slots.push(t);
    });

    summarizeSlotsForDebug(slots);

    const snapshots = buildSnapshots(slots, notes);
    logExampleSnapshot(snapshots);

    const signatures = buildVoicingSignatures(snapshots);

    if (signatures.length < minSteps * 2) return [];

    const maxTick = Math.max(...slots);
    const changes = normalizeTimeSignatureChanges(timeSignature, timeSignatureChanges);
    const measureStartTicks = buildMeasureStartTicks(maxTick, timeSignature, changes);

    const matches: SequenceMatch[] = [];
    const MIN_ONSET_VOICES = 2;
    const REQUIRED_ONSET_VOICES = new Set([1, 4]);

    for (let L = minSteps; L <= maxSteps; L += 1) {
        for (let i = 0; i + 2 * L <= signatures.length; ) {
            const startTickCandidate = slots[i];
            const repeatStartTickCandidate = slots[i + L];
            const startOnsetSet = onsetCounts.get(Math.round(startTickCandidate)) ?? new Set();
            const repeatOnsetSet = onsetCounts.get(Math.round(repeatStartTickCandidate)) ?? new Set();
            const startOnsets = startOnsetSet.size;
            const repeatOnsets = repeatOnsetSet.size;
            const hasRequiredStart = Array.from(REQUIRED_ONSET_VOICES).every(v => startOnsetSet.has(v));
            const hasRequiredRepeat = Array.from(REQUIRED_ONSET_VOICES).every(v => repeatOnsetSet.has(v));
            if (startOnsets < MIN_ONSET_VOICES || repeatOnsets < MIN_ONSET_VOICES || !hasRequiredStart || !hasRequiredRepeat) {
                i += 1;
                continue;
            }
            const modelBlock = signatures.slice(i, i + L);
            const blockMatchesModel = (blockStart: number): boolean => {
                if (blockStart + L > signatures.length) return false;
                for (let k = 0; k < L; k += 1) {
                    const snapA = snapshots[i + k];
                    const snapB = snapshots[blockStart + k];
                    if (!snapA || !snapB || !snapshotVoicingEqual(snapA, snapB)) return false;
                    const a = modelBlock[k];
                    const b = signatures[blockStart + k];
                    if (!signatureEqual(a, b)) return false;
                }
                return true;
            };

            const countFullRepeatsAligned = (startIndex: number, len: number): number => {
                const model = signatures.slice(startIndex, startIndex + len);
                if (model.length < len) return 0;
                let repeats = 1;
                let k = 1;
                while (true) {
                    const blockStart = startIndex + k * len;
                    const block = signatures.slice(blockStart, blockStart + len);
                    if (block.length < len) break;
                    let firstMismatch = -1;
                    for (let bi = 0; bi < len; bi += 1) {
                        const snapA = snapshots[startIndex + bi];
                        const snapB = snapshots[blockStart + bi];
                        if (!snapA || !snapB || !snapshotVoicingEqual(snapA, snapB) || !signatureEqual(model[bi], block[bi])) {
                            firstMismatch = bi;
                            break;
                        }
                    }
                    if (firstMismatch >= 0) {
                        if (DEBUG_SEQUENCE) {
                            console.log('[sequence] blockCheck', { startIndex, L: len, blockStart, matched: false, firstMismatch });
                        }
                        break;
                    }
                    if (DEBUG_SEQUENCE) {
                        console.log('[sequence] blockCheck', { startIndex, L: len, blockStart, matched: true, firstMismatch: -1 });
                    }
                    repeats += 1;
                    k += 1;
                }
                return repeats;
            };

            const repeats = countFullRepeatsAligned(i, L);
            if (repeats < 2) {
                i += 1;
                continue;
            }

            const confidence = 1;

            const startSlotIdx = i;
            const fullRepeats = repeats;
            const validLength = fullRepeats * L;
            const endSlotIdx = i + validLength;
            const startTick = slots[startSlotIdx];
            const endTickExclusive = slots[endSlotIdx];
            const endTickInclusive = Math.max(startTick, endTickExclusive - 1);
            const startMeasure = findMeasureIndexForTick(startTick, measureStartTicks);
            const endMeasure = findMeasureIndexForTick(endTickInclusive, measureStartTicks);
            const modelStartTick = slots[startSlotIdx];
            const repeatStartTick = slots[startSlotIdx + L];
            const modelEndTickExclusive = Math.max(modelStartTick, repeatStartTick ?? modelStartTick);
            const modelEndTickInclusive = Math.max(modelStartTick, modelEndTickExclusive - 1);
            const repeatEndTickExclusive = Math.max(repeatStartTick ?? modelStartTick, slots[endSlotIdx] ?? repeatStartTick ?? modelStartTick);
            const repeatEndTickInclusive = Math.max(repeatStartTick ?? modelStartTick, repeatEndTickExclusive - 1);
            const modelStartMeasure = findMeasureIndexForTick(modelStartTick, measureStartTicks);
            const modelEndMeasure = findMeasureIndexForTick(modelEndTickInclusive, measureStartTicks);
            const repeatStartMeasure = findMeasureIndexForTick(repeatStartTick, measureStartTicks);
            const repeatEndMeasure = findMeasureIndexForTick(repeatEndTickInclusive, measureStartTicks);
            const transpositionSemitones = computeTranspositionSemitones(snapshots, startSlotIdx, L);

            if (DEBUG_SEQUENCE) {
                console.log('[sequence end-fix]', {
                    startTick,
                    endTickExclusive,
                    endTickInclusive,
                    startMeasure,
                    endMeasure,
                });
            }

            matches.push({
                startSlotIdx,
                endSlotIdx,
                lengthSteps: L,
                confidence,
                repeatsCount: fullRepeats,
                startTick,
                endTick: endTickExclusive,
                startMeasure,
                endMeasure,
                modelStartMeasure,
                modelEndMeasure,
                repeatStartMeasure,
                repeatEndMeasure,
                slotTicks: slots,
                transpositionSemitones,
            });

            if (DEBUG_SEQUENCE) {
                console.log('[sequence] match', {
                    i,
                    L,
                    confidence,
                    repeats: fullRepeats,
                    validLength,
                    modelStartMeasure,
                    modelEndMeasure,
                    repeatStartMeasure,
                    repeatEndMeasure,
                });
            }

            if (matches.length >= maxMatches) return matches;

            i += validLength;
        }
    }

    if (matches.length <= 1) return matches;

    const byStart = new Map<number, SequenceMatch[]>();
    matches.forEach(m => {
        if (!byStart.has(m.startSlotIdx)) byStart.set(m.startSlotIdx, []);
        byStart.get(m.startSlotIdx)!.push(m);
    });

    const filtered: SequenceMatch[] = [];
    for (const group of byStart.values()) {
        const maxRepeats = Math.max(...group.map(m => m.repeatsCount ?? 0));
        const repeatCandidates = group.filter(m => (m.repeatsCount ?? 0) === maxRepeats);
        const minL = Math.min(...repeatCandidates.map(m => m.lengthSteps));
        const lengthCandidates = repeatCandidates.filter(m => m.lengthSteps === minL);
        const maxEnd = Math.max(...lengthCandidates.map(m => m.endSlotIdx));
        const best = lengthCandidates.filter(m => m.endSlotIdx === maxEnd);
        filtered.push(...best);
    }

    return filtered;
}
