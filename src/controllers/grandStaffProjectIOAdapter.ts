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
	latestAccHarmonyOverrides?: { current: any[] };
	latestOrnamentOverrides?: { current: any[] };
	projectExtrasRef: { current: Record<string, unknown> };

	staffSystemMode: any;

	keySignatureRoot: string;
	projectTitle: string;
	projectComposer: string;
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
        dynamics?: any[];
        slurs?: any[];
        octaveShifts?: any[];
        keySignatureChanges?: any[];
        /** Curve di tempo (accelerando/rallentando) e SEGNI DI METRONOMO: due cose
         *  diverse. La curva fa scivolare il tempo fra due note; il segno lo cambia di
         *  netto da una battuta, ed è scritto sulla pagina col suo numero. */
        tempoCurves?: any[];
        tempoMarks?: any[];
        toolbarGroupOrder?: any[];
	bpm: number;
	isBpmActive: boolean;
	isMetronomeOn: boolean;
	metronomeUnit: any;
	isSwing?: boolean;
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
        voiceSoundBanks?: Record<number, 'orchestral' | 'gm'>;
        voiceMidiChannels?: Record<number, number>;
        voiceVolumes?: Record<number, number>;
        mutedVoices?: Set<number>;
        /** Custom SATB group name (like ACC track names). */
        satbName?: string;
        /** Visibilità del rigo SATB nel layout (toggle dal mixer). Salvato solo quando
         *  nascosto; in apertura, assente = visibile. */
        satbVisible?: boolean;
        /** NUMERO DI PARTI del coro: 4 (SATB), 3 (Soprano, Contralto, Basso) o 2
         *  (Soprano, Basso). Le voci attive sono sempre le estreme più le interne
         *  necessarie, e la più grave resta il BASSO — è la voce cui sono agganciate
         *  le regole su rivolti, raddoppi e voci estreme. Assente = 4. */
        partCount?: 2 | 3 | 4;
        /** Volumi dei fader master (gruppo SATB, gruppo ACC, master globale). */
        masterVolumes?: { satb?: number; acc?: number; mixer?: number };
        /** FX per-voce SATB: pan (-1..+1) e mandata riverbero (0..1). Le tracce ACC salvano
         *  pan/reverbSend dentro accompanimentTracks. */
        voicePans?: Record<number, number>;
        voiceReverbSends?: Record<number, number>;
        /** Riverbero globale: preset IR + livello wet (return). */
        reverb?: { preset?: 'off' | 'room' | 'hall' | 'plate'; wet?: number };
        /** Compressore sul master: on/off + threshold (dB) + ratio + attack/release (s) + makeup (dB). */
        comp?: { enabled?: boolean; threshold?: number; ratio?: number; attack?: number; release?: number; makeup?: number };
        /** Compressore per-voce SATB (1-4). */
        voiceComps?: Record<number, { enabled?: boolean; threshold?: number; ratio?: number; attack?: number; release?: number; makeup?: number }>;
        /** EQ per-voce SATB (1-4). */
        voiceEqs?: Record<number, any>;
        /** EQ sul master. */
        masterEq?: any;
        satbEq?: any;
        satbComp?: any;
        accEq?: any;
        accComp?: any;
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
		projectComposer: args.projectComposer,
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
		// Curve di tempo (rallentando/accelerando): salvate sempre, anche vuote, per
		// round-trip pulito (prima non venivano scritte → sparivano alla riapertura).
		tempoCurves: args.tempoCurves || [],
		tempoMarks: args.tempoMarks || [],
		// Dinamiche: salvate sempre, anche vuote, per un round-trip pulito.
		dynamics: args.dynamics || [],
		// Legature di portamento: idem.
		slurs: args.slurs || [],
		// Segni d'ottava: idem.
		octaveShifts: args.octaveShifts || [],
		// Cambi d'armatura a metà brano: idem.
		keySignatureChanges: args.keySignatureChanges || [],
		harmonyOverrides: args.latestHarmonyOverrides.current,
		ornamentOverrides: args.latestOrnamentOverrides?.current || [],
		// Override manuali dell'analisi ACC — solo se presenti, per file leggeri.
		...((args.latestAccHarmonyOverrides?.current && args.latestAccHarmonyOverrides.current.length > 0)
			? { accHarmonyOverrides: args.latestAccHarmonyOverrides.current }
			: {}),
		bpm: args.bpm,
		isBpmActive: args.isBpmActive,
		isMetronomeOn: args.isMetronomeOn,
		metronomeUnit: args.metronomeUnit,
		isSwing: !!args.isSwing,
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
		...(args.satbName ? { satbName: args.satbName } : {}),
		// SATB nascosto: persistito solo quando false (default = visibile) per file leggeri.
		...(args.satbVisible === false ? { satbVisible: false } : {}),
		// Numero di parti: salvato solo se diverso dal SATB a quattro (file leggeri).
		...(args.partCount && args.partCount !== 4 ? { partCount: args.partCount } : {}),
		// Mixer per-voce SATB (strumento/volume/mute). mutedVoices serializzato come array.
		...(args.voiceInstruments ? { voiceInstruments: args.voiceInstruments } : {}),
		...(args.voiceSoundBanks ? { voiceSoundBanks: args.voiceSoundBanks } : {}),
		...((args.voiceMidiChannels && Object.keys(args.voiceMidiChannels).length > 0) ? { voiceMidiChannels: args.voiceMidiChannels } : {}),
		...(args.voiceVolumes ? { voiceVolumes: args.voiceVolumes } : {}),
		...((args.mutedVoices && args.mutedVoices.size > 0)
			? { mutedVoices: Array.from(args.mutedVoices) }
			: {}),
		// Master del mixer: salvati solo se almeno uno è diverso dall'unità (file leggeri).
		...((args.masterVolumes && [args.masterVolumes.satb, args.masterVolumes.acc, args.masterVolumes.mixer]
			.some(v => typeof v === 'number' && v !== 1))
			? { masterVolumes: args.masterVolumes }
			: {}),
		// FX mixer: pan/send riverbero per-voce (solo se valorizzati) + riverbero globale.
		...((args.voicePans && Object.keys(args.voicePans).length > 0) ? { voicePans: args.voicePans } : {}),
		...((args.voiceReverbSends && Object.keys(args.voiceReverbSends).length > 0) ? { voiceReverbSends: args.voiceReverbSends } : {}),
		...(args.reverb ? { reverb: args.reverb } : {}),
		...(args.comp && args.comp.enabled ? { comp: args.comp } : {}),
		...((args.voiceComps && Object.keys(args.voiceComps).length > 0) ? { voiceComps: args.voiceComps } : {}),
		...((args.voiceEqs && Object.keys(args.voiceEqs).length > 0) ? { voiceEqs: args.voiceEqs } : {}),
		...(args.masterEq && args.masterEq.enabled ? { masterEq: args.masterEq } : {}),
		...(args.satbEq && args.satbEq.enabled ? { satbEq: args.satbEq } : {}),
		...(args.satbComp && args.satbComp.enabled ? { satbComp: args.satbComp } : {}),
		...(args.accEq && args.accEq.enabled ? { accEq: args.accEq } : {}),
		...(args.accComp && args.accComp.enabled ? { accComp: args.accComp } : {}),
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
	setProjectComposer: (next: any) => void;
	setCurrentProjectFilePath: (next: string | null) => void;
	setKeySignatureRoot: (next: any) => void;
	setIsMinorMode: (next: any) => void;
	setTimeSignature: (next: any) => void;
	setHarmonyOverrides: (next: any) => void;
	setAccHarmonyOverrides?: (next: any) => void;
	setOrnamentOverrides: (next: any) => void;
	setAnalysisContexts: (next: any) => void;
	setTonicizationHints?: (next: any) => void;
	setInferredContextSuppressions?: (next: any) => void;
	setTimeSignatureChanges: (next: any) => void;
	setDoubleBarlineMeasures: (next: any) => void;
	setRepeatBarlines: (next: any) => void;
	setVoltaBrackets: (next: any) => void;
	setDynamics?: (next: any) => void;
	setSlurs?: (next: any) => void;
	setOctaveShifts?: (next: any) => void;
	setKeySignatureChanges?: (next: any) => void;
	setTempoCurves?: (next: any) => void;
	setTempoMarks?: (next: any) => void;
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
	setSatbName?: (name: string) => void;
	setSatbVisible?: (next: boolean) => void;
	setPartCount?: (next: 2 | 3 | 4) => void;
	setVoiceInstruments?: (next: Record<number, string>) => void;
	setVoiceSoundBanks?: (next: Record<number, 'orchestral' | 'gm'>) => void;
	setVoiceMidiChannels?: (next: Record<number, number>) => void;
	setVoiceVolumes?: (next: Record<number, number>) => void;
	setMutedVoices?: (next: Set<number>) => void;
	setSatbMasterVolume?: (v: number) => void;
	setAccMasterVolume?: (v: number) => void;
	setMixerMasterVolume?: (v: number) => void;
	setVoicePans?: (next: Record<number, number>) => void;
	setVoiceReverbSends?: (next: Record<number, number>) => void;
	setVoiceComps?: (next: Record<number, any>) => void;
	setVoiceEqs?: (next: Record<number, any>) => void;
	setMasterEq?: (next: any) => void;
	setSatbEq?: (next: any) => void;
	setSatbComp?: (next: any) => void;
	setAccEq?: (next: any) => void;
	setAccComp?: (next: any) => void;
	setReverbPreset?: (p: 'off' | 'room' | 'hall' | 'plate') => void;
	setReverbWet?: (v: number) => void;
	setCompEnabled?: (v: boolean) => void;
	setCompThreshold?: (v: number) => void;
	setCompRatio?: (v: number) => void;
	setCompAttack?: (v: number) => void;
	setCompRelease?: (v: number) => void;
	setCompMakeup?: (v: number) => void;

	timeSignature: TimeSignature;
};

export function applyGrandStaffProjectIOCommand(cmd: GrandStaffProjectIOCommand, args: ApplyGrandStaffProjectIOCommandArgs): void {
	if (cmd.type === 'new') {
		args.setRawNotes([]);
		args.setProjectTitle('');
		args.setProjectComposer('');
		args.setCurrentProjectFilePath(null);
		args.setKeySignatureRoot('C');
		args.setIsMinorMode(false);
		args.setTimeSignature({ numerator: 4, denominator: 4 });
		args.setHarmonyOverrides([]);
		args.setAccHarmonyOverrides?.([]);
		args.setOrnamentOverrides([]);
		args.setAnalysisContexts([]);
		args.setTimeSignatureChanges([]);
		args.setDoubleBarlineMeasures([]);
		args.setRepeatBarlines({});
		args.setVoltaBrackets([]);
		args.setDynamics?.([]);
		args.setTempoCurves?.([]);
		args.setTempoMarks?.([]);
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
		args.setVoiceSoundBanks?.({ 1: 'orchestral', 2: 'orchestral', 3: 'orchestral', 4: 'orchestral' });
		args.setVoiceMidiChannels?.({});
		args.setVoiceVolumes?.({ 1: 1, 2: 1, 3: 1, 4: 1 });
		args.setMutedVoices?.(new Set());
		args.setSatbMasterVolume?.(1);
		args.setAccMasterVolume?.(1);
		args.setMixerMasterVolume?.(1);
		args.setVoicePans?.({});
		args.setVoiceReverbSends?.({});
		args.setVoiceComps?.({});
		args.setVoiceEqs?.({});
		args.setMasterEq?.({});
		args.setSatbEq?.({}); args.setSatbComp?.({}); args.setAccEq?.({}); args.setAccComp?.({});
		args.setReverbPreset?.('room');
		args.setReverbWet?.(0.85);
		args.setCompEnabled?.(false);
		args.setCompThreshold?.(-18);
		args.setCompRatio?.(3);
		args.setCompAttack?.(0.01);
		args.setCompRelease?.(0.15);
		args.setCompMakeup?.(0);
		args.setSatbVisible?.(true);
		args.setPartCount?.(4);
		args.projectExtrasRef.current = {};
		return;
	}

	if (cmd.type !== 'open') return;

	args.setRawNotes([]);
	// Reset to defaults first so older projects (missing fields) don't
	// inherit settings from the previously opened project.
	args.setKeySignatureRoot('C');
	args.setProjectTitle('');
	args.setProjectComposer('');
	args.setTimeSignature({ numerator: 4, denominator: 4 });
	args.setTimeSignatureChanges([]);
	args.setIsMinorMode(false);
	args.setAutoLeadingToneInMinor(true);
	args.setKeyChangeMode('none');
	args.setModalTonicOverride('');
	args.setAnalysisContexts([]);
	args.setHarmonyOverrides([]);
	args.setAccHarmonyOverrides?.([]);
	args.setOrnamentOverrides([]);
	args.setAnalysisLocked(false);
	args.setTeacherPasswordHash(undefined);
	args.setAnalysisLockOptions({ hideViolations: true, hideRomanLabels: false, hideChordSymbols: false, hideOrnaments: false, hideAlternatives: false, disableExport: true });
	args.setSessionUnlocked?.(false);
	args.setAccompanimentTracks?.([]);
	args.setVoiceInstruments?.({ 1: 'acoustic_grand_piano', 2: 'acoustic_grand_piano', 3: 'acoustic_grand_piano', 4: 'acoustic_grand_piano' });
	args.setVoiceSoundBanks?.({ 1: 'orchestral', 2: 'orchestral', 3: 'orchestral', 4: 'orchestral' });
	args.setVoiceVolumes?.({ 1: 1, 2: 1, 3: 1, 4: 1 });
	args.setMutedVoices?.(new Set());
	args.setSatbMasterVolume?.(1);
	args.setAccMasterVolume?.(1);
	args.setMixerMasterVolume?.(1);
	args.setVoicePans?.({});
	args.setVoiceReverbSends?.({});
	args.setVoiceComps?.({});
	args.setVoiceEqs?.({});
	args.setMasterEq?.({});
	args.setSatbEq?.({}); args.setSatbComp?.({}); args.setAccEq?.({}); args.setAccComp?.({});
	args.setReverbPreset?.('room');
	args.setReverbWet?.(0.85);
	args.setCompEnabled?.(false);
	args.setCompThreshold?.(-18);
	args.setCompRatio?.(3);
	args.setCompAttack?.(0.01);
	args.setCompRelease?.(0.15);
	args.setCompMakeup?.(0);
	// Default a visibile; i file salvati col SATB nascosto lo reimpostano sotto.
	args.setSatbVisible?.(true);
	// Default a quattro parti; i file che ne salvano meno lo reimpostano sotto.
	args.setPartCount?.(4);
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
			// L'autore si azzera anche quando il file NON ce l'ha: un progetto vecchio
			// erediterebbe altrimenti la firma di quello aperto prima (è la stessa
			// trappola dei mute/solo per voce).
			args.setProjectComposer(typeof loadedProject.projectComposer === 'string' ? loadedProject.projectComposer : '');
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
			// Curve di tempo: ripristina dal file, oppure azzera (file vecchi senza il campo
			// → niente carry-over dalla sessione precedente).
			args.setTempoCurves?.(Array.isArray(loadedProject.tempoCurves) ? loadedProject.tempoCurves : []);
			args.setTempoMarks?.(Array.isArray((loadedProject as any).tempoMarks) ? (loadedProject as any).tempoMarks : []);
			// Dinamiche: come sopra — ripristina o azzera, così un file vecchio non
			// eredita i segni della sessione precedente.
			args.setDynamics?.(Array.isArray((loadedProject as any).dynamics) ? (loadedProject as any).dynamics : []);
			args.setSlurs?.(Array.isArray((loadedProject as any).slurs) ? (loadedProject as any).slurs : []);
			args.setOctaveShifts?.(Array.isArray((loadedProject as any).octaveShifts) ? (loadedProject as any).octaveShifts : []);
			args.setKeySignatureChanges?.(Array.isArray((loadedProject as any).keySignatureChanges) ? (loadedProject as any).keySignatureChanges : []);
			if (Array.isArray(loadedProject.harmonyOverrides)) {
				args.setHarmonyOverrides(loadedProject.harmonyOverrides);
			}
			// Override manuali dell'analisi ACC: sempre (reset a [] se assenti → no carry-over).
			args.setAccHarmonyOverrides?.(Array.isArray((loadedProject as any).accHarmonyOverrides) ? (loadedProject as any).accHarmonyOverrides : []);
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
			// Swing (ottavi terzinati, playback): assente nei file vecchi → off.
			args.setIsSwing(typeof (loadedProject as any).isSwing === 'boolean' ? (loadedProject as any).isSwing : false);

			// Tracce di accompagnamento: retrocompatibilità totale con file vecchi.
			if (Array.isArray(loadedProject.accompanimentTracks)) {
				args.setAccompanimentTracks?.(loadedProject.accompanimentTracks as AccompanimentTrack[]);
			} else {
				args.setAccompanimentTracks?.([]);
			}

			if (typeof loadedProject.satbName === 'string') args.setSatbName?.(loadedProject.satbName);
			// SATB nascosto: ripristina dal file (assente = visibile, già impostato sopra).
			if (typeof (loadedProject as any).satbVisible === 'boolean') args.setSatbVisible?.((loadedProject as any).satbVisible);
			// Numero di parti: assente nei file esistenti → quattro, come sempre stato.
			{
				const pc = Number((loadedProject as any).partCount);
				args.setPartCount?.((pc === 2 || pc === 3) ? (pc as 2 | 3) : 4);
			}
			// Mixer per-voce SATB (assente nei file vecchi → restano i default già impostati sopra).
			if (loadedProject.voiceInstruments && typeof loadedProject.voiceInstruments === 'object') {
				args.setVoiceInstruments?.(loadedProject.voiceInstruments as Record<number, string>);
			}
			if ((loadedProject as any).voiceSoundBanks && typeof (loadedProject as any).voiceSoundBanks === 'object') {
				args.setVoiceSoundBanks?.((loadedProject as any).voiceSoundBanks as Record<number, 'orchestral' | 'gm'>);
			}
			// Canali MIDI per-voce (assente nei file vecchi → resta {} = auto, già impostato sopra).
			if (loadedProject.voiceMidiChannels && typeof loadedProject.voiceMidiChannels === 'object') {
				args.setVoiceMidiChannels?.(loadedProject.voiceMidiChannels as Record<number, number>);
			}
			if (loadedProject.voiceVolumes && typeof loadedProject.voiceVolumes === 'object') {
				args.setVoiceVolumes?.(loadedProject.voiceVolumes as Record<number, number>);
			}
			// Azzera SEMPRE il mute al load (file pre-mixer privo del campo → niente mute fantasma ereditato).
			args.setMutedVoices?.(Array.isArray(loadedProject.mutedVoices) ? new Set(loadedProject.mutedVoices as number[]) : new Set());
			// Master del mixer (assente nei file vecchi → restano 1, già impostati sopra).
			const mv = (loadedProject as any).masterVolumes;
			if (mv && typeof mv === 'object') {
				if (typeof mv.satb === 'number') args.setSatbMasterVolume?.(mv.satb);
				if (typeof mv.acc === 'number') args.setAccMasterVolume?.(mv.acc);
				if (typeof mv.mixer === 'number') args.setMixerMasterVolume?.(mv.mixer);
			}
			// FX mixer per-voce + riverbero globale (assenti nei file vecchi → restano i default).
			if (loadedProject.voicePans && typeof loadedProject.voicePans === 'object') {
				args.setVoicePans?.(loadedProject.voicePans as Record<number, number>);
			}
			if (loadedProject.voiceReverbSends && typeof loadedProject.voiceReverbSends === 'object') {
				args.setVoiceReverbSends?.(loadedProject.voiceReverbSends as Record<number, number>);
			}
			if ((loadedProject as any).voiceComps && typeof (loadedProject as any).voiceComps === 'object') {
				args.setVoiceComps?.((loadedProject as any).voiceComps);
			}
			if ((loadedProject as any).voiceEqs && typeof (loadedProject as any).voiceEqs === 'object') {
				args.setVoiceEqs?.((loadedProject as any).voiceEqs);
			}
			args.setMasterEq?.(((loadedProject as any).masterEq && typeof (loadedProject as any).masterEq === 'object') ? (loadedProject as any).masterEq : {});
			args.setSatbEq?.(((loadedProject as any).satbEq && typeof (loadedProject as any).satbEq === 'object') ? (loadedProject as any).satbEq : {});
			args.setSatbComp?.(((loadedProject as any).satbComp && typeof (loadedProject as any).satbComp === 'object') ? (loadedProject as any).satbComp : {});
			args.setAccEq?.(((loadedProject as any).accEq && typeof (loadedProject as any).accEq === 'object') ? (loadedProject as any).accEq : {});
			args.setAccComp?.(((loadedProject as any).accComp && typeof (loadedProject as any).accComp === 'object') ? (loadedProject as any).accComp : {});
			const rv = (loadedProject as any).reverb;
			if (rv && typeof rv === 'object') {
				if (typeof rv.preset === 'string') args.setReverbPreset?.(rv.preset);
				if (typeof rv.wet === 'number') args.setReverbWet?.(rv.wet);
			}
			const cp = (loadedProject as any).comp;
			if (cp && typeof cp === 'object') {
				if (typeof cp.enabled === 'boolean') args.setCompEnabled?.(cp.enabled);
				if (typeof cp.threshold === 'number') args.setCompThreshold?.(cp.threshold);
				if (typeof cp.ratio === 'number') args.setCompRatio?.(cp.ratio);
				if (typeof cp.attack === 'number') args.setCompAttack?.(cp.attack);
				if (typeof cp.release === 'number') args.setCompRelease?.(cp.release);
				if (typeof cp.makeup === 'number') args.setCompMakeup?.(cp.makeup);
			} else {
				args.setCompEnabled?.(false); // assente → compressore off
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
		args.apply.setProjectComposer('');
		args.apply.setTimeSignature({ numerator: 4, denominator: 4 });
		args.apply.setTimeSignatureChanges([]);
		args.apply.setClipboard(null);
		args.apply.setSelectedNoteIds(new Set());
		args.apply.setActiveTab('editor');
		args.apply.setDoubleBarlineMeasures([]);
		args.apply.setRepeatBarlines({});
		args.apply.setVoltaBrackets([]);
		args.apply.setTempoCurves?.([]);
		args.apply.setTempoMarks?.([]);
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
		args.apply.setAccHarmonyOverrides?.([]);
		args.apply.setOrnamentOverrides([]);
		args.apply.setContextMenu(null);
		args.apply.setShowRomanAnalysis(true);
		args.apply.setShowSymbolAnalysis(false);
		args.apply.setShowMeasureNumbers(true);
		args.apply.setIsToolbarCustomizeOpen(false);
		args.apply.setMidiOutputs([]);
		args.apply.setSelectedMidiOutput(null);
		args.apply.setSatbVisible?.(true);
		args.apply.setSatbMasterVolume?.(1);
		args.apply.setAccMasterVolume?.(1);
		args.apply.setMixerMasterVolume?.(1);
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
		// Dal dialog di setup la conferma è già stata data (pulsante "Crea progetto"),
		// quindi si salta il confirm nativo.
		if (!payload?.skipConfirm) {
			const confirmed = window.confirm('Vuoi davvero creare un nuovo progetto? I dati non salvati andranno persi.');
			if (!confirmed) return true;
		}
		applyGrandStaffProjectIOCommand({ type: 'new' }, args.apply);
		return true;
	}

	return false;
}