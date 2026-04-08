import fs from 'node:fs';
import { applyHarmonyRules, getActiveNotesTimeline, getKeySignature, getPitchClassesForDebug, getRomanAnalysis } from '../src/utils/musicTheory';

const file = './tests/Dubois 1 p11.json';
const fx = JSON.parse(fs.readFileSync(file, 'utf8'));

const ks = getKeySignature(fx.keySignatureRoot, fx.isMinorMode ? 'Minor' : 'Major');
const res: any = applyHarmonyRules(
	fx.notes,
	ks as any,
	fx.keySignatureRoot,
	fx.isMinorMode,
	fx.analysisContexts || [],
	fx.timeSignature,
);

const inferred = (res.inferredAnalysisContexts || []) as any[];
const manual = (fx.analysisContexts || []) as any[];
const effective = [...inferred, ...manual];

const ctxAbs = (c: any) => {
	const beatsPerMeasure = fx.timeSignature.numerator * (4 / fx.timeSignature.denominator);
	const legacyAbs = (Number(c.measureIndex ?? 0) || 0) * beatsPerMeasure;
	const a = Number(c.absBeat);
	return Number.isFinite(a) ? a : legacyAbs;
};

const ctxAt = (absBeat: number) => {
	const c = effective
		.filter((x: any) => ctxAbs(x) <= absBeat + 1e-6)
		.sort((a: any, b: any) => ctxAbs(b) - ctxAbs(a))[0];
	return c
		? { tonic: c.newTonic, isMinor: !!c.newIsMinor, absBeat: ctxAbs(c), label: c.label }
		: { tonic: fx.keySignatureRoot, isMinor: !!fx.isMinorMode, absBeat: -1, label: 'GLOBAL' };
};

// Mirror UI: build the active-note timeline from analyzed notes (which include NCT flags).
const analyzedNotes = (res.analyzedNotes || fx.notes) as any[];
const timeline = getActiveNotesTimeline(analyzedNotes as any, fx.timeSignature, fx.timeSignatureChanges);

// Mirror UI: filter to label-worthy scanpoints (onsets + note-off-only on strong beats)
const isCompoundMeter = fx.timeSignature.denominator === 8 && (fx.timeSignature.numerator % 3 === 0) && fx.timeSignature.numerator > 3;
const isStrongPulseInMeasure = (inMeasureBeats0: number) => {
	try {
		if (!Number.isFinite(inMeasureBeats0)) return false;
		const EPS = 1e-3;
		if (isCompoundMeter) {
			const pulse = 1.5;
			const r = ((inMeasureBeats0 % pulse) + pulse) % pulse;
			return Math.abs(r) < EPS || Math.abs(pulse - r) < EPS;
		}
		const nearInt = (x: number) => Math.abs(x - Math.round(x)) < EPS;
		if (!nearInt(inMeasureBeats0)) return false;
		const beat0 = Math.round(inMeasureBeats0);
		return beat0 === 0 || (fx.timeSignature.numerator >= 4 && beat0 === 2);
	} catch {
		return false;
	}
};

const timelineForLabels = (timeline || []).filter((ev: any, idx: number) => {
	if (!ev) return false;
	if (idx === 0) return true;

	const prev = timeline[idx - 1] as any;
	const prevIds = new Set<string>((prev?.notes || []).map((n: any) => String(n?.id ?? '')));
	const curNotes = (ev?.notes || []) as any[];

	const hasOnset = curNotes.some((n: any) => {
		const id = String(n?.id ?? '');
		return id && !prevIds.has(id);
	});
	if (hasOnset) return true;

	try {
		const curIds = new Set<string>(curNotes.map((n: any) => String(n?.id ?? '')).filter(Boolean));
		const removed = Array.from(prevIds).some(id => id && !curIds.has(id));
		if (!removed) return false;

		const absBeat = Number(ev?.absBeat);
		if (!Number.isFinite(absBeat)) return false;
		const beatsPerMeasure = fx.timeSignature.numerator * (4 / fx.timeSignature.denominator);
		const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
		return isStrongPulseInMeasure(inMeasure);
	} catch {
		return false;
	}
});

const targetAbs = 78; // barline around UI m13->m14 for 3/2
const around = timeline.filter(ev => ev.absBeat >= targetAbs - 3 && ev.absBeat <= targetAbs + 3);
const aroundLabels = timelineForLabels.filter(ev => ev.absBeat >= targetAbs - 3 && ev.absBeat <= targetAbs + 3);

console.log('timeSignature', fx.timeSignature);
console.log('inferred contexts (60..90)', inferred.filter((c: any) => ctxAbs(c) >= 60 && ctxAbs(c) <= 90).sort((a: any, b: any) => ctxAbs(a) - ctxAbs(b)));
console.log('--- events around absBeat', targetAbs, '---');
for (const ev of around) {
	const ctx = ctxAt(ev.absBeat);
	const roman = getRomanAnalysis(ev.notes as any, ctx.tonic, ctx.isMinor)?.roman || '';
	const pcs = getPitchClassesForDebug(ev.notes as any);
	console.log({ absBeat: ev.absBeat, measureIndex: ev.measureIndex, beat: ev.beat, ctx, pcs, roman });
	if (Math.abs(ev.absBeat - targetAbs) < 1e-6) {
		const items = (ev.notes || []).filter((n: any) => n && !n.isRest).map((n: any) => ({
			id: n.id,
			voice: n.voice,
			pitch: n.pitch,
			octave: n.octave,
			midi: n.midi,
			noteIndex: n.noteIndex,
			beat: n.beat,
			dur: n.duration,
			isPassing: !!n.isPassing,
			isEscape: !!n.isEscape,
			isNeighbor: !!n.isNeighbor,
			isAnticipation: !!n.isAnticipation,
			isAppoggiatura: !!n.isAppoggiatura,
			isSuspension: !!n.isSuspension,
		}));
		console.log('notes@target', items);
	}
}

console.log('--- label-events (UI filter) around absBeat', targetAbs, '---');
for (const ev of aroundLabels) {
	const ctx = ctxAt(ev.absBeat);
	const roman = getRomanAnalysis(ev.notes as any, ctx.tonic, ctx.isMinor)?.roman || '';
	const pcs = getPitchClassesForDebug(ev.notes as any);
	console.log({ absBeat: ev.absBeat, measureIndex: ev.measureIndex, beat: ev.beat, ctx, pcs, roman });
}
