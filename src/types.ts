
export type ScaleType = string;

export enum RootType {
  Major = 'major',
  Minor = 'minor',
}

export type ScaleNoteDefinition = {
  s: number; // string index (0: high e, 5: low E)
  f: number; // fret offset
  t?: RootType; // type of note
  isAlternate?: boolean;
};

export type ScaleShape = {
  name: string;
  color: string;
  notes: ScaleNoteDefinition[];
};

export type PlacedBox = {
  id: string;
  shapeIndex: number;
  fretPosition: number;
  scaleType: ScaleType;
};

export type FretboardNote = {
  noteName: string;
  pentatonicInfo?: {
    boxId: string;
    color: string;
    type?: RootType;
    isAlternate?: boolean;
  }
}

export type Key = {
  note: string;
  scale: 'Major' | 'Minor';
};

export type EnharmonicMode = 'auto' | 'sharp' | 'flat';

// --- NEW TYPES FOR CHORD VISUALIZER ---

export interface Note {
  sharp: string;
  flat: string;
  audioFile: string;
}

export type ChordType = string;

export const BuiltInChords = {
  // Triads
  Major: 'Major',
  Minor: 'Minor',
  Augmented: 'Augmented',
  Diminished: 'Diminished',

  // Suspended
  Sus2: 'Sus2',
  Sus4: 'Sus4',
  
  // Sevenths
  Major7: 'Major 7',
  Minor7: 'Minor 7',
  MinorMajor7: 'Minor Maj7',
  Dominant7: 'Dominant 7',
  Diminished7: 'Diminished 7',
  Minor7b5: 'Minor 7♭5', // Half-Diminished
  
  // Sixths
  Major6: 'Major 6',
  Minor6: 'Minor 6',

  // Ninths
  Major9: 'Major 9',
  Minor9: 'Minor 9',
  Dominant9: 'Dominant 9',
  Add9: 'Add 9',
  MinorAdd9: 'Minor Add 9',
  Dominant7b9: 'Dominant 7♭9',
  Dominant7sharp9: 'Dominant 7♯9',

  // Elevenths
  Minor11: 'Minor 11',
  Dominant11: 'Dominant 11',
  Dominant7sharp11: 'Dominant 7♯11',
  
  // Thirteenths
  Major13: 'Major 13',
  Minor13: 'Minor 13',
  Dominant13: 'Dominant 13',
  Dominant7b13: 'Dominant 7♭13',
  Dominant9_13: 'Dominant 9/13',
} as const;


export type EnharmonicPreference = 'sharp' | 'flat';

export interface DisplayNote extends Note {
  name: string;
  isEnharmonic: boolean;
  originalIndex: number;
}

export type Voicing = [number, number, number, number, number, number]; // [E, A, D, G, B, e], -1 for muted

export interface CagedVoicing {
  name: string;
  voicing: Voicing;
}

// --- NEW TYPES FOR INTERVAL VISUALIZER ---

export interface Interval {
  name: string;
  shortName: string;
  semitones: number;
  color: string;
  rgbColor: string;
}

export interface PlacedInterval {
  id: string;
  rootNote: { s: number; f: number; noteIndex: number; midi: number };
  targetNote: { s: number; f: number; noteIndex: number; midi: number };
  interval: Interval;
  direction: 'ascending' | 'descending';
}

// --- NEW TYPES FOR STAFF ---

export type AccidentalType = 'sharp' | 'flat' | 'natural' | 'double-sharp' | 'double-flat';
export type NoteDuration = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth' | 'thirty-second' | 'sixty-fourth';
export type ClefType = 'treble' | 'bass' | 'soprano' | 'alto' | 'tenor';
export type Voice = 1 | 2 | 3 | 4;

/**
 * LEGATURA DI PORTAMENTO (slur) — l'unico segno di questo gruppo che non sta SU una
 * nota ma FRA due: si tiene quindi in un elenco del brano, ancorato agli id dei due
 * capi, come le curve di tempo. Non va confusa con la legatura di VALORE
 * (`isTiedToNext`), che unisce due suoni uguali in uno solo.
 */
export interface Slur {
  id: string;
  fromNoteId: string;
  toNoteId: string;
}

/**
 * CAMBIO D'ARMATURA a metà brano (Do maggiore → Re maggiore alla battuta 9).
 *
 * Vale dall'inizio della battuta indicata in poi, e vale per TUTTO il brano — coro e
 * tracce insieme — come il metro: l'armatura è del pezzo, non del rigo.
 *
 * NON muove le note: cambia l'armatura disegnata e quindi quali alterazioni vengono
 * stampate. Per trasportare davvero un passaggio c'è il trasporto, che è un'altra cosa
 * e si vede.
 *
 * `root` segue la convenzione del brano: è la fondamentale MAGGIORE relativa (un Re
 * minore si scrive root 'F' + isMinor), perché l'armatura è la stessa.
 */
export interface KeySignatureChange {
  measureIndex: number;
  root: string;
  isMinor?: boolean;
}

/**
 * DURATA REALE di una battuta, quando NON coincide col metro.
 *
 * Battute di levare, battute d'aggiunta, cadenze: in musica sono normali, e in
 * MusicXML una battuta porta la propria durata indipendentemente dal metro. Il
 * programma invece è nato dando per scontato che ogni battuta duri quanto il metro,
 * e senza questa eccezione le note in eccedenza finivano disegnate sopra il primo
 * movimento della battuta successiva.
 *
 * Elenco SPARSO: ci stanno solo le battute che si discostano. Vedi
 * `src/utils/measureLengths.ts`.
 */
export interface MeasureLength {
  measureIndex: number;
  /** Durata reale in semiminime. */
  beats: number;
}

/**
 * SEGNO DI METRONOMO a metà brano — «♩ = 60», «𝅗𝅥 = 70».
 *
 * Da non confondere con [TempoCurve], che è un accelerando o un rallentando: là il
 * tempo SCIVOLA fra due note, qui CAMBIA di netto da una battuta in poi, ed è scritto.
 * La differenza non è tecnica ma di lettura: davanti a una curva l'esecutore vede che
 * qualcosa rallenta e non sa né quanto né fino a dove; davanti a un segno legge il
 * numero. Un file importato che dichiara i suoi andamenti merita il numero.
 *
 * `bpm` è riferito all'UNITÀ dichiarata, non alla semiminima: `beatUnit: 'half'` con
 * `bpm: 70` è una minima a 70, cioè 140 alla semiminima. Si conserva com'è scritto —
 * riportarlo subito alla semiminima farebbe stampare «♩ = 140» dove la partitura dice
 * «𝅗𝅥 = 70», che è la stessa velocità ma non la stessa indicazione. Per il calcolo
 * c'è `tempoMarkQuarterBpm`.
 */
export interface TempoMark {
  id: string;
  /** Vale dall'inizio di questa battuta, come i cambi di metro e d'armatura. */
  measureIndex: number;
  bpm: number;
  /** Unità di battito. Assente = semiminima. */
  beatUnit?: 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth';
  /** Unità col punto di valore (♩. = 80): moltiplica per 1,5. */
  dotted?: boolean;
}

/**
 * SEGNO D'OTTAVA (8va sopra / 8vb sotto).
 *
 * Serve ai passaggi che avrebbero troppi tagli addizionali: si scrivono un'ottava più
 * in basso (o più in alto) e il segno dice di suonarli spostati. Quindi:
 *
 *   l'altezza SCRITTA è quella che si vede sul rigo — e resta quella salvata;
 *   il segno cambia solo COME SUONA, di un'ottava.
 *
 * Niente altezze modificate di nascosto: mettere il segno non muove le note. Per
 * ripulire un passaggio già scritto alto si abbassa la selezione di un'ottava
 * (⇧+freccia giù) e POI si mette il segno — due gesti visibili, entrambi annullabili.
 *
 * Da non confondere con `octaveTranspose` delle tracce ACC, che riguarda solo il
 * suono degli strumenti traspositori e non si disegna.
 */
export interface OctaveShift {
  id: string;
  fromNoteId: string;
  toNoteId: string;
  /** `up` = 8va (suona un'ottava sopra), `down` = 8vb (un'ottava sotto). */
  direction: 'up' | 'down';
}

/** Articolazioni che si posano su una nota. L'ordine è quello della tavolozza. */
export type ArticulationMark = 'staccato' | 'staccatissimo' | 'accent' | 'marcato' | 'tenuto';

export type StaffNote = {
  id: string;
  pitch: string; // e.g., 'C', 'F'
  octave: number;
  accidental?: AccidentalType;
  explicitAccidental?: AccidentalType | null;
  userAccidental?: AccidentalType | null;
  position: number; // 0=C4, 1=D4, etc. relative to C4
  midi: number;
  color?: string;
  noteIndex: number;
  isPentatonicNote?: boolean;
  isPassing?: boolean;
  timestep?: number;
  xPosition?: number;
  duration?: NoteDuration;
  isRest?: boolean;
  isTriplet?: boolean;
  isDuplet?: boolean;
  isDotted?: boolean;
  isTiedToNext?: boolean;
  // Render hint: this note continues a tie from the previous system/line.
  // (Computed in the editor; stored notes only need isTiedToNext on the source note.)
  isTiedFromPrev?: boolean;
  groupId?: string;
  chordId?: string; // New property to group notes vertically in the same chord
  measureIndex?: number;
  beat?: number;
  // Tick-based timeline (high resolution). Optional for legacy compatibility.
  startTick?: number;
  durationTicks?: number;
  /** Playback-only override: original duration in ticks before the rhythmic
   *  trim shortened the note for notation. Lets playback sustain the note
   *  as long as the MIDI recording intended even though the score shows a
   *  shorter value (e.g. a quarter trimmed to dotted-eighth at the next
   *  onset still SOUNDS as a quarter). When undefined, durationTicks is
   *  used for both notation and playback. */
  playbackDurationTicks?: number;
  clef?: ClefType;
  /** Per-note staff override – lets the user move individual notes to the
   *  other staff regardless of the current parti-strette / parti-late mode. */
  clefOverride?: 'treble' | 'bass';
  errorType?: 'error' | 'warning' | 'exception' | null;
  voice?: Voice;
  manualBeamGroupId?: string;
  manualBeamDisabled?: boolean;
  manualStemDirection?: 'up' | 'down';
  manualTieDirection?: 'up' | 'down';
  // Ornament flags (set by analysis engine and/or manual override)
  isNeighbor?: boolean;
  isAppoggiatura?: boolean;
  isAnticipation?: boolean;
  isEscape?: boolean;
  isCambiata?: boolean;
  isSuspension?: any;
  ornamentMark?: string;
  ornamentOverride?: OrnamentType;
  /** ARTICOLAZIONI della nota: staccato, staccatissimo, accento, marcato, tenuto.
   *  È un ELENCO perché si combinano davvero — accento + staccato è scrittura
   *  corrente. Stanno sulla NOTA e non sul brano (a differenza delle dinamiche, che
   *  valgono per tutte le voci): un segno d'articolazione riguarda quel suono lì.
   *  Si disegnano sopra le voci 1/3 e sotto le 2/4, come la corona, e si SENTONO:
   *  vedi `src/utils/articulations.ts`. */
  articulations?: ArticulationMark[];
  /** Fermata (corona) — playback-only effect: doubles the note's sounding duration
   *  and shifts all subsequent events by the same amount. Rendered as a fermata
   *  glyph above (voices 1/3) or below (voices 2/4) the note. */
  isFermata?: boolean;
  /** Pitch classes of all chord tones at insertion time — used by re-voice to avoid reconstructing from potentially incomplete voicings. */
  chordPcs?: number[];
  /** Root note name of the chord at insertion time (e.g. 'C' for C7/E) — used by re-voice for correct enharmonic spelling. */
  chordRootName?: string;
  /** Raw (pre-quantize) tick position from real-time recording — preserved so Q can re-quantize to a different grid without undo. */
  rawStartTick?: number;
  /** Raw (pre-quantize) duration in ticks from real-time recording. */
  rawDurationTicks?: number;
  /** MIDI note-on velocity (1..127) captured from import or real-time recording.
   *  Drives expressive playback volume and is written back out on MIDI export.
   *  Undefined for manually-entered notes (played at full/default level). */
  velocity?: number;
};

/** Manual ornament classification for a note. */
export type OrnamentType = 'passing' | 'neighbor' | 'appoggiatura' | 'anticipation' | 'escape' | 'cambiata' | 'suspension' | 'structural' | 'ornamental';

/** Singola traccia di accompagnamento (piano, chitarra, ecc.).
 *  Non viene analizzata armonicamente e non passa dal voice-leading checker.
 *  Le note usano StaffNote con `voice = 0` per distinguersi dal SATB (1-4). */
export type AccompanimentTrack = {
  /** ID univoco della traccia */
  id: string;
  /** Nome visualizzato (es. "Piano", "Chitarra") */
  name: string;
  /** Strumento General MIDI (0-127) */
  instrumentId: number;
  /** Banco timbrico della traccia: 'orchestral' (FLAC locali, default) o 'gm'
   *  (vecchio soundfont GM remoto). Scelta utente per-traccia. Ignorato per batteria. */
  soundBank?: 'orchestral' | 'gm';
  /** Note della traccia — stessa struttura di StaffNote ma con voice sempre = 0 */
  notes: StaffNote[];
  /** Traccia silenziata */
  muted: boolean;
  /** Traccia in solo (se almeno un canale è in solo, suonano solo i canali in solo) */
  solo?: boolean;
  /** Traccia visibile nel rendering */
  visible: boolean;
  /** Volume relativo 0-1 */
  volume: number;
  /** Modalità pentagramma: "grandstaff" (treble+bass) o "treble_only" (rigo singolo).
   *  File legacy senza questo campo vengono trattati come "grandstaff" al consumo. */
  staffMode: 'grandstaff' | 'treble_only';
  /** Grand staff "a voci": come 'grandstaff' (treble+bass) ma le note usano le voci
   *  1-4 invece di voice 0 (1-2 = rigo violino/mano destra, 3-4 = rigo basso/mano
   *  sinistra), così da avere fino a 4 voci poliritmiche con accordi per voce,
   *  riusando il motore di incisione del SATB (gambi 1/3 su, 2/4 giù). Solo per
   *  staffMode === 'grandstaff'. Le altre tracce restano a voce singola (voice 0). */
  voiced?: boolean;
  /** Chiave del rigo singolo (usata quando staffMode === 'treble_only').
   *  Permette righi strumentali/vocali in chiavi diverse (violino, basso, soprano,
   *  contralto, tenore). Default 'treble' se assente. Ignorata in 'grandstaff'. */
  clef?: ClefType;
  /** Trasposizione d'OTTAVA in SUONO per strumenti traspositori (chitarra e basso
   *  suonano un'ottava SOTTO il scritto). In ottave: -1 = 8vb (un'ottava sotto),
   *  +1 = 8va, 0/assente = nessuna trasposizione. Riguarda solo il suono (riproduzione
   *  e uscita MIDI): la notazione resta invariata e la chiave mostra un "8" sotto/sopra.
   *  Solo per staffMode === 'treble_only' (chiave singola); ignorata per batteria. */
  octaveTranspose?: number;
  /** Gruppo d'analisi: le tracce con lo stesso groupId (es. le parti di un brano importato
   *  multi-traccia) vengono lette INSIEME dall'analisi armonica ACC, pur restando su righi
   *  distinti. Assente = traccia analizzata da sola. Assegnato dall'import "righi separati"
   *  e modificabile col toggle nel menu della chiave. */
  groupId?: string;
  /** Colore personalizzato della traccia (hex, es. "#38bdf8"). Mostrato come banda
   *  verticale a fianco del rigo e usato per colorare le note in modalità colore. */
  color?: string;
  /** Traccia di PERCUSSIONI (MIDI canale 10): le note non sono altezze ma pezzi del kit
   *  (note GM percussione: 36=cassa, 38=rullante, 42=charleston…). Suona il kit `drums`
   *  (one-shot) invece di `instrumentId`, si incide su rigo percussioni, e in uscita MIDI
   *  va sempre sul canale 10. `staffMode`/`voiced` ignorati. */
  isDrum?: boolean;
  /** Quale kit suona una traccia batteria: 'orchestral' (VSCO2, default) o 'rock' (Salamander).
   *  Determina il soundfont ('drums' vs 'drumkit'), la mappa pezzi e le posizioni sul rigo. */
  drumKit?: 'orchestral' | 'rock';
  /** Posizione stereo (pan) del canale: -1 = tutto a sinistra, 0 = centro (default/assente), +1 = destra.
   *  Applicata da uno StereoPannerNode tra il gain di traccia e il master. Solo suono. */
  pan?: number;
  /** Compressore INSERT per-traccia: on/off + threshold (dB) + ratio + attack/release (s) + makeup (dB).
   *  Inserito nella catena gain → comp → makeup → panner. Bypass = ratio 1/threshold 0/makeup 0dB. */
  comp?: { enabled?: boolean; threshold?: number; ratio?: number; attack?: number; release?: number; makeup?: number };
  /** EQ INSERT per-traccia a 3 bande (low shelf / mid peak / high shelf), inserito PRIMA del comp
   *  (gain → eq → comp). Bypass = guadagni a 0 dB. */
  eq?: { enabled?: boolean; low?: { freq?: number; gain?: number }; mid?: { freq?: number; gain?: number; q?: number }; high?: { freq?: number; gain?: number } };
  /** Quantità di mandata al RIVERBERO globale (send per-canale, 0..1; assente = default ~0.25).
   *  È il "send" sul fader della traccia: il segnale post-fader va anche al bus riverbero in
   *  questa misura. Il tipo di riverbero (preset) e il livello globale stanno sul master. */
  reverbSend?: number;
  /** Solo batteria: volume PER-PEZZO (chiave = nota GM del pezzo, es. 36=cassa, 42=charleston),
   *  gain lineare ~0..1.5, default 1 (assente = 1). Permette di bilanciare i singoli elementi
   *  del kit (cassa/rullante su, charleston giù) dal mixer batteria, oltre al volume di traccia.
   *  Moltiplica il gain di playback del singolo colpo; non tocca l'export MIDI. */
  pieceVolumes?: Record<number, number>;
  /** Canale MIDI in USCITA (1-16) verso l'uscita MIDI esterna. Se assente/0 = automatico
   *  (batteria → 10; tracce intonate → da 5 in su saltando il 10). Permette di instradare
   *  ogni traccia su un canale preciso in un DAW esterno (es. Logic). */
  midiChannel?: number;
};

/**
 * Tempo curve (rallentando / accelerando) — playback-only effect.
 * Applies a linear BPM transition from `fromBpm` to `toBpm` across all events
 * sounding in the inclusive window [startNoteId .. endNoteId] (sorted by absBeat).
 * Identified by the IDs of the first and last notes in the user's selection.
 */
export type TempoCurve = {
  startNoteId: string;
  endNoteId: string;
  fromBpm: number;
  toBpm: number;
};

/** User override that forces a specific ornament classification on a note. */
/**
 * Riassunto di ciò che un file da importare contiene, mostrato PRIMA di chiedere dove
 * metterlo: senza, si sceglie al buio fra "SATB", "righi separati" e "grand staff unico"
 * senza sapere quante parti ci sono né come si chiamano.
 */
export interface ImportSummary {
    kind: 'midi' | 'musicxml';
    title?: string;
    parts: Array<{
        name: string;
        noteCount: number;
        /** Strumento dichiarato dal file (numero di programma GM), quando c'è. */
        instrumentId?: number;
        /** Parte di PERCUSSIONI (canale 10, o nome della traccia). */
        isDrum?: boolean;
        /** Kit scelto per le percussioni, dedotto dai pezzi usati. */
        drumKit?: 'orchestral' | 'rock';
        /** Due righi (pianistica) o uno solo. */
        twoStaves?: boolean;
        /** Chiave del rigo singolo, quando è nota o deducibile dalla tessitura. */
        clef?: ClefType;
    }>;
}

export interface OrnamentOverride {
  noteId: string;
  type: OrnamentType;
  /** Stored at creation time for cross-session matching when note IDs change. */
  midi?: number;
  measureIndex?: number;
  beat?: number;
}

// FIX: Added Barline type for use in Staff.tsx
export type Barline = {
  id: string;
  xPosition: number;
  style?: 'single' | 'double' | 'final' | 'repeat-begin' | 'repeat-end' | 'repeat-both';
};

export interface VoltaBracket {
  startMeasure: number;
  endMeasure: number;
  number: number;
  text: string;
}

export type KeySignature = {
  type: 'sharp' | 'flat';
  count: number;
};

export type TimeSignature = {
  numerator: number;
  denominator: number;
};

export type TimeSignatureChange = {
  // Timeline position in quarter-note units from start (can be fractional).
  absBeat?: number;
  // Legacy support (older state): measure boundary context.
  measureIndex?: number;
  numerator: number;
  denominator: number;
};

// --- HARMONY ANALYSIS ---
export type ErrorConnection = {
  type: 'vertical' | 'horizontal';
  noteId1: string;
  noteId2: string;
  // Optional metadata to keep connection coloring tied to the originating rule.
  // If absent, the editor may derive severity from violations/endpoints.
  severity?: 'error' | 'warning' | 'exception';
  ruleId?: string;
};

export type RuleViolation = {
    ruleId: string;
    description: string;
    suggestion?: string;
    noteIds: string[];
    severity: 'error' | 'warning' | 'exception';
    /**
     * Nota davvero IN CAUSA, quando `noteIds` ne contiene anche altre solo per poter
     * disegnare il tratteggio (che vuole due estremi). Il clic sulla partitura apre di
     * preferenza la violazione che ha questa nota come colpevole, e selezionandola dal
     * pannello si seleziona lei — non le innocenti che le stanno accanto.
     */
    primaryNoteId?: string;
};

export type AnalysisContext = {
  // New: position in the score timeline (quarter-note beats from start, can be fractional).
  // This enables mid-measure key contexts (tonicizations/modulations) aligned to the playhead.
  absBeat?: number;
  // Legacy support (older state): measure boundary context.
  measureIndex?: number;
    newTonic: string;
    newIsMinor: boolean;
    // Optional custom label shown above the staff for this context.
    label?: string;
    // Optional: controls how the marker is rendered above the staff.
    // - 'both' (default/legacy): show label + [Tonic Quality]
    // - 'tonic': show only [Tonic Quality]
    // - 'text': show only label (no tonic appended)
    markerMode?: 'both' | 'tonic' | 'text';
    // Optional: inference confidence score (used only for engine-inferred contexts).
    score?: number;
    // Optional: source tag for UI/debug.
    source?: 'manual' | 'inferred';
};

export interface HarmonyAnalysisResult {
    analyzedNotes: StaffNote[];
    connections: ErrorConnection[];
    violations: RuleViolation[];
  // Optional: contexts inferred by the engine (tonicizations/modulations).
  // The editor can merge these with user-provided `analysisContexts`.
  inferredAnalysisContexts?: AnalysisContext[];
  // Optional: label overrides inferred by the engine (e.g. local cadences IV–V–I / ii–V–I).
  // The editor may apply these as display-only overrides (user overrides should still win).
  autoHarmonyLabelOverrides?: HarmonyLabelOverride[];
}

export type SequenceMatch = {
  startSlotIdx: number;
  endSlotIdx: number;
  lengthSteps: number;
  confidence: number;
  repeatsCount?: number;
  startTick: number;
  endTick: number;
  startMeasure: number;
  endMeasure: number;
  modelStartMeasure?: number;
  modelEndMeasure?: number;
  repeatStartMeasure?: number;
  repeatEndMeasure?: number;
  slotTicks?: number[];
  transpositionSemitones?: number | null;
  label?: string;
  /** True when the sequence contains chromatic alterations outside the key signature,
   *  indicating each link modulates to a new local tonic. */
  isModulating?: boolean;
  /** For modulating sequences: the inferred local tonic for each repetition
   *  (index 0 = model, 1 = first repeat, etc.). */
  modulationTonics?: string[];
};

/** Suggerimento di tonicizzazione locale inserito dall'utente (es. "tratta questo accordo come I in Bb").
 *  Non genera un marker visivo sulla partitura. Viene trattato dall'engine esattamente come un contesto
 *  inferito: iniettato in _effectiveCtxs con source='inferred', durata calcolata automaticamente
 *  (si esaurisce quando il contenuto armonico non supporta più la tonica hint).
 */
export type TonicizationHint = {
    absBeat: number;
    tonic: string;
    isMinor: boolean;
};

export type HarmonyLabelOverride = {
  // Timeline position in quarter-note units from start (can be fractional).
  absBeat: number;
  roman?: string;
  // Optional display-only roman (e.g. I=VI). If set, it should be preferred for rendering.
  romanDisplay?: string;
  figures?: string[];
  symbol?: string;
  note?: string;
  // If true, this override is used only to force a label at this absBeat
  // (i.e. prevent suppression), without overriding roman/figures/symbol.
  force?: boolean;
};
export interface SpelledPitch {
  letter: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
  accidental: -2 | -1 | 0 | 1 | 2;  // bb=-2, b=-1, nat=0, #=1, ##=2
  octave: number;                      // 2-6 per SATB
}
