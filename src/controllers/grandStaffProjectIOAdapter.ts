import { DURATION_VALUES, TICKS_PER_QUARTER } from '../constants';
import type { AccompanimentTrack, TimeSignature, TimeSignatureChange } from '../types';
import { getKeySignature, normalizeNotePitchFieldsWithKey } from '../utils/musicTheory';
import { extractProjectExtras, migrateProjectData, CURRENT_PROJECT_SCHEMA_VERSION } from '../storage/projectSchema';
import { readPreference, writePreference } from '../preferences/preferencesStore';

// Preferenze di analisi che vengono salvate per-file e ripristinate al caricamento.
// Cambiano il significato dell'analisi e quindi devono seguire il file.
const FILE_ANALYSIS_PREFS = [
	'analysis.enableInferredContexts',
	'analysis.cadentialPatterns',
	'analysis.profileBaseId',
	'analysis.chromaticModulation',
	'analysis.sequencesEnabled',
] as const;

export type GrandStaffProjectIOCommand =
	| { type: 'new' }
	| { type: 'open'; parsed: any; filePath: string | null };

export type BuildGrandStaffProjectSnapshotArgs = {
	latestRawNotes: { current: any[] };
	latestHarmonyOverrides: { current: any[] };
	latestOrnamentOverrides?: { current: any[] };
	projectExtrasRef: { current: Record<string, unknown> };

	staffSystemMode: any;

	keySignatureRoot: string;
	projectTitle: string;
	titleFontSize: number;
	titleFontFamily: string;

	timeSignature: TimeSignature;
	timeSignatureChanges: TimeSignatureChange[];

	isMinorMode: boolean;
	autoLeadingToneInMinor: boolean;
	keyChangeMode: any;
	modalTonicOverride: string;

	analysisContexts: any[];
	tonicizationHints?: any[];
	inferredContextSuppressions?: any[];
	doubleBarlineMeasures: any[];
        repeatBarlines: Record<number, string>;
        voltaBrackets: any[];
        toolbarGroupOrder?: any[];
	bpm: number;
	isBpmActive: boolean;
	isMetronomeOn: boolean;
	metronomeUnit: any;
        computedLabelsRef?: { current: any[] | null };

        analysisLocked?: boolean;
        teacherPasswordHash?: string;
        analysisLockOptions?: {
                hideViolations: boolean;
                hideRomanLabels: boolean;
                hideChordSymbols: boolean;
                hideOrnaments: boolean;
                hideAlternatives: boolean;
                disableExport: boolean;
        };

        /** Tracce di accompagnamento (piano, chitarra, ecc.). Non passano per
         *  l'analisi armonica né per il voice-leading checker. */
        accompanimentTracks?: AccompanimentTrack[];

        /** Mixer per-voce SATB: strumento, volume (0-1) e mute per voce 1-4. */
        voiceInstruments?: Record<number, string>;
        voiceVolumes?: Record<number, number>;
        mutedVoices?: Set<number>;
};
export function buildGrandStaffProjectSnapshot(args: BuildGrandStaffProjectSnapshotArgs): any {
	const saveKeySig = getKeySignature(args.keySignatureRoot, args.isMinorMode ? "Minor" : "Major");
	const baseProject: any = {
		schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
		notes: (args.latestRawNotes.current || []).map((n: any) => normalizeNotePitchFieldsWithKey(n as any, saveKeySig)),
		staffSystemMode: args.staffSystemMode,
		// Project-level settings
		keySignatureRoot: args.keySignatureRoot,
		projectTitle: args.projectTitle,
		titleFontSize: args.titleFontSize,
		titleFontFamily: args.titleFontFamily,
		timeSignature: args.timeSignature,
		timeSignatureChanges: args.timeSignatureChanges,
		isMinorMode: args.isMinorMode,
		autoLeadingToneInMinor: args.autoLeadingToneInMinor,
		keyChangeMode: args.keyChangeMode,
		modalTonicOverride: args.modalTonicOverride,
		analysisContexts: args.analysisContexts,				tonicizationHints: args.tonicizationHints || [],
				inferredContextSuppressions: args.inferredContextSuppressions || [],		doubleBarlineMeasures: args.doubleBarlineMeasures,
		repeatBarlines: args.repeatBarlines,
		voltaBrackets: args.voltaBrackets,
		harmonyOverrides: args.latestHarmonyOverrides.current,
		ornamentOverrides: args.latestOrnamentOverrides?.current || [],
		bpm: args.bpm,
		isBpmActive: args.isBpmActive,
		isMetronomeOn: args.isMetronomeOn,
		metronomeUnit: args.metronomeUnit,
		toolbarGroupOrder: args.toolbarGroupOrder,
		analysisLocked: args.analysisLocked,
		teacherPasswordHash: args.teacherPasswordHash,
		analysisLockOptions: args.analysisLockOptions,
		// Preferenze di analisi per-file
		filePreferences: Object.fromEntries(
			FILE_ANALYSIS_PREFS.map(id => [id, readPreference(id as any)])
		),
		// Tracce di accompagnamento — solo se presenti, per mantenere i file leggeri.
		...((args.accompanimentTracks && args.accompanimentTracks.length > 0)
			? { accompanimentTracks: args.accompanimentTracks }
			: {}),
		// Mixer per-voce SATB (strumento/volume/mute). mutedVoices serializzato come array.
		...(args.voiceInstruments ? { voiceInstruments: args.voiceInstruments } : {}),
		...(args.voiceVolumes ? { voiceVolumes: args.voiceVolumes } : {}),
		...((args.mutedVoices && args.mutedVoices.size > 0)
			? { mutedVoices: Array.from(args.mutedVoices) }
			: {}),
	};

	// Persist final computed harmony labels for corpus accuracy
	if (args.computedLabelsRef?.current) {
		const flatLabels = (args.computedLabelsRef.current as any[][]).flat();
		baseProject.computedLabels = flatLabels
			.filter((l: any) => l && l.roman && !l.hiddenMarker)
			.map((l: any) => ({
				absBeat: l.absBeat,
				roman: l.roman,
				romanDisplay: l.romanDisplay || l.roman,
				figures: l.figures || [],
			}));
	}

	return { ...(args.projectExtrasRef.current || {}), ...baseProject };
}

export type ApplyGrandStaffProjectIOCommandArgs = {
	projectExtrasRef: { current: Record<string, unknown> };

	defaultToolbarGroupOrder: any[];

	setRawNotes: (next: any) => void;
	setProjectTitle: (next: any) => void;
	setCurrentProjectFilePath: (next: string | null) => void;
	setKeySignatureRoot: (next: any) => void;
	setIsMinorMode: (next: any) => void;
	setTimeSignature: (next: any) => void;
	setHarmonyOverrides: (next: any) => void;
	setOrnamentOverrides: (next: any) => void;
	setAnalysisContexts: (next: any) => void;
	setTonicizationHints?: (next: any) => void;
	setInferredContextSuppressions?: (next: any) => void;
	setTimeSignatureChanges: (next: any) => void;
	setDoubleBarlineMeasures: (next: any) => void;
	setRepeatBarlines: (next: any) => void;
	setVoltaBrackets: (next: any) => void;
	setKeyChangeMode: (next: any) => void;
	setModalTonicOverride: (next: any) => void;
	setAutoLeadingToneInMinor: (next: any) => void;

	setMeasuresPerLine: (next: any) => void;
	setMeasuresPerLineDraft: (next: any) => void;
	setMinMeasureCount: (next: any) => void;
	setMinMeasureCountDraft: (next: any) => void;

	setBpm: (next: any) => void;
	setIsBpmActive: (next: any) => void;
	setIsMetronomeOn: (next: any) => void;
	setMetronomeUnit: (next: any) => void;

	setClipboard: (next: any) => void;
	setSelectedNoteIds: (next: any) => void;
	setPasteCaretImmediate: (next: any) => void;
	setActiveAccidental: (next: any) => void;
	setSelectedVoice: (next: any) => void;

	setActiveTab: (next: any) => void;
	setSelectedInsertion: (next: any) => void;
	setIsTriplet: (next: any) => void;
	setIsDuplet: (next: any) => void;
	setIsSwing: (next: any) => void;
	setTupletNoteCount: (next: any) => void;
	setTripletBaseDuration: (next: any) => void;
	setHoveredViolationNotes: (next: any) => void;
	setSelectedViolationIndex: (next: any) => void;
	setViewMode: (next: any) => void;
	setContextMenu: (next: any) => void;
	setShowRomanAnalysis: (next: any) => void;
	setShowSymbolAnalysis: (next: any) => void;
	setShowMeasureNumbers: (next: any) => void;
	setIsToolbarCustomizeOpen: (next: any) => void;
	setMidiOutputs: (next: any) => void;
	setSelectedMidiOutput: (next: any) => void;

	setStaffSystemMode: (next: any) => void;
	setToolbarGroupOrder: (next: any) => void;
	setTitleFontSize: (next: any) => void;
	setTitleFontFamily: (next: any) => void;

	setAnalysisLocked: (next: boolean) => void;
	setTeacherPasswordHash: (next: string | undefined) => void;
	setAnalysisLockOptions: (next: any) => void;
	setSessionUnlocked?: (next: boolean) => void;

	setAccompanimentTracks?: (next: AccompanimentTrack[]) => void;
	setVoiceInstruments?: (next: Record<number, string>) => void;
	setVoiceVolumes?: (next: Record<number, number>) => void;
	setMutedVoices?: (next: Set<number>) => void;

	timeSignature: TimeSignature;
};

export function applyGrandStaffProjectIOCommand(cmd: GrandStaffProjectIOCommand, args: ApplyGrandStaffProjectIOCommandArgs): void {
	if (cmd.type === 'new') {
		args.setRawNotes([]);
		args.setProjectTitle('');
		args.setCurrentProjectFilePath(null);
		args.setKeySignatureRoot('C');
		args.setIsMinorMode(false);
		args.setTimeSignature({ numerator: 4, denominator: 4 });
		args.setHarmonyOverrides([]);
		args.setOrnamentOverrides([]);
		args.setAnalysisContexts([]);
		args.setTimeSignatureChanges([]);
		args.setDoubleBarlineMeasures([]);
		args.setRepeatBarlines({});
		args.setVoltaBrackets([]);
		args.setKeyChangeMode('none');
		args.setModalTonicOverride('');
		args.setAutoLeadingToneInMinor(true);
		args.setMeasuresPerLine(4);
		args.setMeasuresPerLineDraft('4');
		args.setMinMeasureCount(4);
		args.setMinMeasureCountDraft('4');
		args.setBpm(120);
		args.setIsBpmActive(false);
		args.setIsMetronomeOn(false);
		args.setMetronomeUnit('quarter');
		args.setClipboard(null);
		args.setSelectedNoteIds(new Set());
		args.setPasteCaretImmediate(null);
		args.setActiveAccidental(null);
		args.setSelectedVoice(1);
		args.setAnalysisLocked(false);
		args.setTeacherPasswordHash(undefined);
		args.setAnalysisLockOptions({ hideViolations: true, hideRomanLabels: false, hideChordSymbols: false, hideOrnaments: false, hideAlternatives: false, disableExport: true });
		args.setSessionUnlocked?.(false);
		args.setAccompanimentTracks?.([]);
		args.setVoiceInstruments?.({ 1: 'acoustic_grand_piano', 2: 'acoustic_grand_piano', 3: 'acoustic_grand_piano', 4: 'acoustic_grand_piano' });
		args.setVoiceVolumes?.({ 1: 1, 2: 1, 3: 1, 4: 1 });
		args.setMutedVoices?.(new Set());
		args.projectExtrasRef.current = {};
		return;
	}

	if (cmd.type !== 'open') return;

	args.setRawNotes([]);
	// Reset to defaults first so older projects (missing fields) don't
	// inherit settings from the previously opened project.
	args.setKeySignatureRoot('C');
	args.setProjectTitle('');
	args.setTimeSignature({ numerator: 4, denominator: 4 });
	args.setTimeSignatureChanges([]);
	args.setIsMinorMode(false);
	args.setAutoLeadingToneInMinor(true);
	args.setKeyChangeMode('none');
	args.setModalTonicOverride('');
	args.setAnalysisContexts([]);
	args.setHarmonyOverrides([]);
	args.setOrnamentOverrides([]);
	args.setAnalysisLocked(false);
	args.setTeacherPasswordHash(undefined);
	args.setAnalysisLockOptions({ hideViolations: true, hideRomanLabels: false, hideChordSymbols: false, hideOrnaments: false, hideAlternatives: false, disableExport: true });
	args.setSessionUnlocked?.(false);
	args.setAccompanimentTracks?.([]);
	args.setVoiceInstruments?.({ 1: 'acoustic_grand_piano', 2: 'acoustic_grand_piano', 3: 'acoustic_grand_piano', 4: 'acoustic_grand_piano' });
	args.setVoiceVolumes?.({ 1: 1, 2: 1, 3: 1, 4: 1 });
	args.setMutedVoices?.(new Set());
	args.setBpm(120);
	args.setIsBpmActive(false);
	args.setIsMetronomeOn(false);
	args.setMetronomeUnit('quarter');

	try {
		const parsed: any = cmd.parsed;
		args.projectExtrasRef.current = extractProjectExtras(parsed);
		const loadedProject = migrateProjectData(parsed);
		if (loadedProject && Array.isArray(loadedProject.notes)) {
			const loadKeyRoot = (typeof loadedProject.keySignatureRoot === 'string' && loadedProject.keySignatureRoot)
				? loadedProject.keySignatureRoot
				: 'C';
			const loadMinor = typeof loadedProject.isMinorMode === 'boolean' ? loadedProject.isMinorMode : false;
			const loadKeySig = getKeySignature(loadKeyRoot, loadMinor ? 'Minor' : 'Major');

			// Self-heal older/saved projects: keep spelling fields as-is, but
			// ensure numeric fields follow the written spelling.
			const normalizedNotes = (loadedProject.notes as any[]).map((n: any) => normalizeNotePitchFieldsWithKey(n, loadKeySig));

			// Convert legacy beat/measure floats to high-resolution ticks for stability.
			try {
				const ts = (loadedProject.timeSignature && typeof loadedProject.timeSignature === 'object')
					? loadedProject.timeSignature
					: { numerator: 4, denominator: 4 };
				const baseBeats = ts.numerator * (4 / ts.denominator);
				const ticksPerBeat = TICKS_PER_QUARTER; // quarter = 1 beat

				const changesRaw = Array.isArray(loadedProject.timeSignatureChanges) ? loadedProject.timeSignatureChanges : [];
				const changes = changesRaw
					.map((c: any) => {
						const absBeat = Number(c?.absBeat);
						const m = Number.isFinite(c?.measureIndex)
							? Number(c.measureIndex)
							: (Number.isFinite(absBeat) ? Math.floor(absBeat / Math.max(1, baseBeats || 4)) : 0);
						return {
							measureIndex: m,
							numerator: Math.max(1, Math.round(Number(c?.numerator) || 4)),
							denominator: Math.max(1, Math.round(Number(c?.denominator) || 4)),
						};
					})
					.filter((c: any) => Number.isFinite(c.measureIndex))
					.sort((a: any, b: any) => a.measureIndex - b.measureIndex);

				const maxIdx = (normalizedNotes as any[]).reduce((mx, n) => Math.max(mx, Number.isFinite(n.measureIndex) ? n.measureIndex : 0), 0);
				const measureStartAbsBeat: number[] = [];
				let acc = 0;
				for (let m = 0; m <= maxIdx + 1; m++) {
					measureStartAbsBeat[m] = acc;
					let active = ts as any;
					for (const c of changes) {
						if (c.measureIndex <= m) active = c;
						else break;
					}
					const bpmLocal = active.numerator * (4 / active.denominator);
					acc += Math.max(1, Number.isFinite(bpmLocal) ? bpmLocal : baseBeats || 4);
				}

				const withTicks = (normalizedNotes as any[]).map(n => {
					try {
						const m = Number.isFinite(n.measureIndex) ? n.measureIndex : 0;
						const b = Number.isFinite(n.beat) ? n.beat : 1;
						const absBeat = (measureStartAbsBeat[m] ?? (m * baseBeats)) + (b - 1);
						const startTick = Math.round(absBeat * ticksPerBeat);

						// duration -> beats
						const base = (DURATION_VALUES as any)[n.duration || 'quarter'] || 1;
						let durBeats = base;
						if (n.isDotted) durBeats *= 1.5;
						if (n.isTriplet) durBeats *= 2 / 3;
						if (n.isDuplet) durBeats *= 3 / 2;
						const durationTicks = Math.round(durBeats * ticksPerBeat);

						return { ...n, startTick, durationTicks };
					} catch {
						return n;
					}
				});
				args.setRawNotes(withTicks as any);
				try {
					const maxIdx2 = (withTicks as any[]).reduce((mx, n) => Math.max(mx, Number.isFinite(n.measureIndex) ? n.measureIndex : 0), -1);
					const measuresCount = Math.max(1, maxIdx2 + 1);
					args.setMinMeasureCount(measuresCount);
					args.setMinMeasureCountDraft(String(measuresCount));
				} catch { /* ignore */ }
			} catch {
				args.setRawNotes(normalizedNotes as any);
			}

			if (loadedProject.staffSystemMode === 'grandstaff' || loadedProject.staffSystemMode === 'treble_only' || loadedProject.staffSystemMode === 'satb_ancient') {
				args.setStaffSystemMode(loadedProject.staffSystemMode);
			}

			// Restore project-level settings when present.
			if (Array.isArray(loadedProject.toolbarGroupOrder)) {
				const all = new Set(args.defaultToolbarGroupOrder);
				const cleanedOrder = loadedProject.toolbarGroupOrder.filter((id: any) => all.has(id));
				const fullOrder: any[] = Array.from(new Set([...cleanedOrder, ...args.defaultToolbarGroupOrder]));
				args.setToolbarGroupOrder(fullOrder);
			}
			if (typeof loadedProject.keySignatureRoot === 'string' && loadedProject.keySignatureRoot) {
				args.setKeySignatureRoot(loadedProject.keySignatureRoot);
			}
			if (typeof loadedProject.projectTitle === 'string') {
				args.setProjectTitle(loadedProject.projectTitle);
			}
			if (typeof loadedProject.titleFontSize === 'number' && Number.isFinite(loadedProject.titleFontSize)) {
				args.setTitleFontSize(Math.max(12, Math.min(72, loadedProject.titleFontSize)));
			}
			if (typeof loadedProject.titleFontFamily === 'string' && loadedProject.titleFontFamily) {
				args.setTitleFontFamily(loadedProject.titleFontFamily);
			}
			if (loadedProject.timeSignature && typeof loadedProject.timeSignature === 'object') {
				const n = Number((loadedProject.timeSignature as any).numerator);
				const d = Number((loadedProject.timeSignature as any).denominator);
				if (Number.isFinite(n) && Number.isFinite(d) && n > 0 && d > 0) {
					args.setTimeSignature({ numerator: n, denominator: d });
				}
			}
			if (Array.isArray(loadedProject.timeSignatureChanges)) {
				const baseBeats = (loadedProject.timeSignature && typeof loadedProject.timeSignature === 'object')
					? ((Number((loadedProject.timeSignature as any).numerator) || 4) * (4 / (Number((loadedProject.timeSignature as any).denominator) || 4)))
					: (args.timeSignature.numerator * (4 / args.timeSignature.denominator));
				const normalized = loadedProject.timeSignatureChanges.map((c: any) => {
					const absBeat = Number(c?.absBeat);
					const m = Number.isFinite(c?.measureIndex)
						? Number(c.measureIndex)
						: (Number.isFinite(absBeat) ? Math.floor(absBeat / Math.max(1, baseBeats || 4)) : 0);
					return {
						absBeat: Number.isFinite(absBeat) ? absBeat : undefined,
						measureIndex: m,
						numerator: Math.max(1, Math.round(Number(c?.numerator) || 4)),
						denominator: Math.max(1, Math.round(Number(c?.denominator) || 4)),
					} as TimeSignatureChange;
				});
				args.setTimeSignatureChanges(normalized);
			}
			if (typeof loadedProject.isMinorMode === 'boolean') {
				args.setIsMinorMode(loadedProject.isMinorMode);
			}
			if (typeof loadedProject.autoLeadingToneInMinor === 'boolean') {
				args.setAutoLeadingToneInMinor(loadedProject.autoLeadingToneInMinor);
			}
			if (loadedProject.keyChangeMode === 'none' || loadedProject.keyChangeMode === 'transpose' || loadedProject.keyChangeMode === 'modal') {
				args.setKeyChangeMode(loadedProject.keyChangeMode);
			}
			if (typeof loadedProject.modalTonicOverride === 'string') {
				args.setModalTonicOverride(loadedProject.modalTonicOverride);
			}
			if (Array.isArray(loadedProject.analysisContexts)) {
				args.setAnalysisContexts(loadedProject.analysisContexts);
			}
			if (Array.isArray(loadedProject.tonicizationHints)) {
				args.setTonicizationHints?.(loadedProject.tonicizationHints);
			}
				if (Array.isArray(loadedProject.inferredContextSuppressions)) {
						args.setInferredContextSuppressions?.(loadedProject.inferredContextSuppressions);
				}
			if (Array.isArray(loadedProject.doubleBarlineMeasures)) {
				const cleaned = loadedProject.doubleBarlineMeasures
					.map((m: any) => Number(m))
					.filter((m: any) => Number.isFinite(m) && m >= 0)
					.sort((a: number, b: number) => a - b);
				args.setDoubleBarlineMeasures(cleaned);
			}
			if (loadedProject.repeatBarlines && typeof loadedProject.repeatBarlines === 'object' && !Array.isArray(loadedProject.repeatBarlines)) {
				args.setRepeatBarlines(loadedProject.repeatBarlines);
			}
			if (Array.isArray(loadedProject.voltaBrackets)) {
				args.setVoltaBrackets(loadedProject.voltaBrackets);
			}
			if (Array.isArray(loadedProject.harmonyOverrides)) {
				args.setHarmonyOverrides(loadedProject.harmonyOverrides);
			}
			if (Array.isArray(loadedProject.ornamentOverrides)) {
				args.setOrnamentOverrides(loadedProject.ornamentOverrides);
			}
			if (typeof loadedProject.analysisLocked === 'boolean') {
				args.setAnalysisLocked(loadedProject.analysisLocked);
			}
			if (typeof loadedProject.teacherPasswordHash === 'string') {
				args.setTeacherPasswordHash(loadedProject.teacherPasswordHash);
			}
			if (loadedProject.analysisLockOptions && typeof loadedProject.analysisLockOptions === 'object') {
				args.setAnalysisLockOptions(loadedProject.analysisLockOptions);
			}
			if (typeof loadedProject.bpm === 'number' && Number.isFinite(loadedProject.bpm) && loadedProject.bpm > 0) {
				args.setBpm(loadedProject.bpm);
			}
			if (typeof loadedProject.isBpmActive === 'boolean') {
				args.setIsBpmActive(loadedProject.isBpmActive);
			}
			if (typeof loadedProject.isMetronomeOn === 'boolean') {
				args.setIsMetronomeOn(loadedProject.isMetronomeOn);
			}
			if (loadedProject.metronomeUnit === 'quarter' || loadedProject.metronomeUnit === 'eighth' || loadedProject.metronomeUnit === 'dotted-quarter') {
				args.setMetronomeUnit(loadedProject.metronomeUnit);
			}

			// Tracce di accompagnamento: retrocompatibilità totale con file vecchi.
			if (Array.isArray(loadedProject.accompanimentTracks)) {
				args.setAccompanimentTracks?.(loadedProject.accompanimentTracks as AccompanimentTrack[]);
			} else {
				args.setAccompanimentTracks?.([]);
			}

			// Mixer per-voce SATB (assente nei file vecchi → restano i default già impostati sopra).
			if (loadedProject.voiceInstruments && typeof loadedProject.voiceInstruments === 'object') {
				args.setVoiceInstruments?.(loadedProject.voiceInstruments as Record<number, string>);
			}
			if (loadedProject.voiceVolumes && typeof loadedProject.voiceVolumes === 'object') {
				args.setVoiceVolumes?.(loadedProject.voiceVolumes as Record<number, number>);
			}
			if (Array.isArray(loadedProject.mutedVoices)) {
				args.setMutedVoices?.(new Set(loadedProject.mutedVoices as number[]));
			}

			args.setCurrentProjectFilePath(cmd.filePath);

			// Ripristina le preferenze di analisi salvate nel file.
			// Se il file non ha filePreferences (formato vecchio), non tocca nulla.
			if (loadedProject.filePreferences && typeof loadedProject.filePreferences === 'object') {
				for (const id of FILE_ANALYSIS_PREFS) {
					if (Object.prototype.hasOwnProperty.call(loadedProject.filePreferences, id)) {
						try { writePreference(id as any, loadedProject.filePreferences[id]); } catch { /* ignore */ }
					}
				}
			}
		} else {
			throw new Error('Formato dati non valido.');
		}
	} catch (err) {
		// Reset extras on failed open, otherwise a previous project's extras could leak into a new save.
		args.projectExtrasRef.current = {};
		try {
			const msg = (err as any)?.message || String(err || 'Errore');
			window.alert(`Impossibile aprire il progetto: ${msg}`);
		} catch {
			// ignore
		}
	}
}

export type HandleGrandStaffProjectIOMenuActionArgs = {
	action: 'save' | 'save-as' | 'open' | 'new' | 'close-project';
	payload: any;

	api: any;
	currentProjectFilePath: string | null;
	setCurrentProjectFilePath: (next: string | null) => void;

	snapshot: BuildGrandStaffProjectSnapshotArgs;
	apply: ApplyGrandStaffProjectIOCommandArgs;
};

export async function handleGrandStaffProjectIOMenuAction(args: HandleGrandStaffProjectIOMenuActionArgs): Promise<boolean> {
	const { action, payload, api, currentProjectFilePath, setCurrentProjectFilePath } = args;

	if (action === 'close-project') {
		const confirmed = window.confirm('Vuoi chiudere il progetto corrente? Le modifiche non salvate andranno perse.');
		if (!confirmed) return true;

		args.apply.setRawNotes([]);
		args.apply.setKeySignatureRoot('C');
		args.apply.setProjectTitle('');
		args.apply.setTimeSignature({ numerator: 4, denominator: 4 });
		args.apply.setTimeSignatureChanges([]);
		args.apply.setClipboard(null);
		args.apply.setSelectedNoteIds(new Set());
		args.apply.setActiveTab('editor');
		args.apply.setDoubleBarlineMeasures([]);
		args.apply.setRepeatBarlines({});
		args.apply.setVoltaBrackets([]);
		args.apply.setMinMeasureCount(4);
		args.apply.setMeasuresPerLine(4);
		args.apply.setIsMinorMode(false);
		args.apply.setKeyChangeMode('none');
		args.apply.setModalTonicOverride('');
		args.apply.setSelectedInsertion({ type: 'note', duration: 'quarter', isDotted: false });
		args.apply.setIsTriplet(false);
		args.apply.setIsDuplet(false);
		args.apply.setIsSwing(false);
		args.apply.setTupletNoteCount(0);
		args.apply.setTripletBaseDuration(null);
		args.apply.setActiveAccidental(null);
		args.apply.setSelectedVoice(1);
		args.apply.setAutoLeadingToneInMinor(true);
		args.apply.setHoveredViolationNotes(null);
		args.apply.setSelectedViolationIndex(null);
		args.apply.setViewMode('page');
		args.apply.setPasteCaretImmediate(null);
		args.apply.setAnalysisContexts([]);
		args.apply.setHarmonyOverrides([]);
		args.apply.setOrnamentOverrides([]);
		args.apply.setContextMenu(null);
		args.apply.setShowRomanAnalysis(true);
		args.apply.setShowSymbolAnalysis(false);
		args.apply.setShowMeasureNumbers(true);
		args.apply.setIsToolbarCustomizeOpen(false);
		args.apply.setMidiOutputs([]);
		args.apply.setSelectedMidiOutput(null);
		setCurrentProjectFilePath(null);
		args.apply.projectExtrasRef.current = {};
		return true;
	}

	if (action === 'save' || action === 'save-as') {
		try {
			const latest = args.snapshot.latestRawNotes.current || [];
			// A project with only accompaniment tracks (no SATB notes) is NOT empty.
			const accHasNotes = (args.snapshot.accompanimentTracks || [])
				.some(t => (t?.notes?.length ?? 0) > 0);
			if (latest.length === 0 && !accHasNotes && !window.confirm('Il progetto è vuoto. Salvare comunque?')) return true;

			const project = buildGrandStaffProjectSnapshot(args.snapshot);
			const projectData = JSON.stringify(project, null, 2);

			if (!api?.saveFile) return true;
			const targetPath = (action === 'save' && currentProjectFilePath) ? currentProjectFilePath : undefined;
			const result = await api.saveFile(projectData, targetPath);
			if (result && result.success && result.filePath) {
				try {
					if (api?.addRecentFile) api.addRecentFile(result.filePath);
				} catch {
					// ignore
				}
				setCurrentProjectFilePath(result.filePath);
				// Clear emergency draft — project is safely on disk.
				try { localStorage.removeItem('harmony-tutor.draftBackup.v1'); } catch { /* ignore */ }
			}
		} catch {
			// ignore
		}
		return true;
	}

	if (action === 'open') {
		try {
			const data = payload?.data;
			if (!data) throw new Error("Nessun dato fornito per l'apertura.");
			const parsed = JSON.parse(data);

                        // ── Sanitize stale MIDI values ──────────────────────
                        // Notes like Cb4 can have midi=71 (wrong) instead of 59
                        // because the original save didn't handle octave-boundary accidentals.
                        if (Array.isArray(parsed.notes)) {
                                const _bp: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
                                for (const n of parsed.notes) {
                                        if (!n.pitch || n.octave == null || n.isRest) continue;
                                        const base = _bp[String(n.pitch)[0]] ?? 0;
                                        let acc = 0;
                                        const a = n.accidental || n.explicitAccidental || '';
                                        if (a === 'sharp' || a === '#') acc = 1;
                                        else if (a === 'flat' || a === 'b') acc = -1;
                                        else if (a === 'double-sharp' || a === '##') acc = 2;
                                        else if (a === 'double-flat' || a === 'bb') acc = -2;
                                        const correct = (n.octave + 1) * 12 + base + acc;
                                        n.midi = correct;
                                        n.noteIndex = ((correct % 12) + 12) % 12;
                                }
                        }

                        applyGrandStaffProjectIOCommand({ type: 'open', parsed, filePath: payload?.filePath ? String(payload.filePath) : null }, args.apply);

			try {
				const fp = payload?.filePath ? String(payload.filePath) : '';
				if (fp && api?.addRecentFile) api.addRecentFile(fp);
			} catch {
				// ignore
			}
		} catch (err) {
			args.apply.projectExtrasRef.current = {};
			try {
				const msg = (err as any)?.message || String(err || 'Errore');
				window.alert(`Impossibile aprire il progetto: ${msg}`);
			} catch {
				// ignore
			}
		}
		return true;
	}

	if (action === 'new') {
		const confirmed = window.confirm('Vuoi davvero creare un nuovo progetto? I dati non salvati andranno persi.');
		if (!confirmed) return true;
		applyGrandStaffProjectIOCommand({ type: 'new' }, args.apply);
		return true;
	}

	return false;
}