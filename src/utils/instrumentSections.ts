/**
 * SEZIONI D'ORCHESTRA — la famiglia di appartenenza di un rigo.
 *
 * In una partitura i righi non stanno uno sotto l'altro alla rinfusa: sono raccolti in
 * famiglie (legni, ottoni, percussioni, archi…) e ogni famiglia è chiusa a sinistra da una
 * parentesi quadra. È quella parentesi a dire al lettore «questi suonano insieme», e a
 * trasformare una pila di pentagrammi in una pagina sola.
 *
 * Fino a qui l'unico modo di ottenere una parentesi era il GRUPPO D'ANALISI (`groupId`):
 * comodo, ma è un'altra cosa: dice chi CONCORRE ALL'ANALISI armonica, non chi appartiene
 * alla stessa famiglia. Le due divisioni possono anche tagliarsi a vicenda — un'analisi
 * d'insieme può prendere il primo violino e il fagotto — quindi devono restare due assi
 * distinti, con due segni distinti.
 *
 * La famiglia NON si chiede all'utente: si deduce dallo strumento già scelto per la traccia
 * (`instrumentId`, programma General MIDI). Chi assegna «Flauto» a un rigo ha già detto che
 * è un legno. `AccompanimentTrack.section` serve solo a smentire la deduzione quando serve
 * ('none' = fuori da ogni famiglia).
 */

export type SectionId =
	| 'woodwinds'
	| 'brass'
	| 'percussion'
	| 'strings'
	| 'keyboards'
	| 'plucked'
	| 'voices';

/** Valore memorizzato sulla traccia: una famiglia forzata, 'none' per escluderla, oppure
 *  assente = dedotta dallo strumento. */
export type SectionChoice = SectionId | 'none';

/** Ordine di partitura (dall'alto in basso), quello dei trattati d'orchestrazione. */
export const SECTION_ORDER: SectionId[] = [
	'woodwinds',
	'brass',
	'percussion',
	'keyboards',
	'plucked',
	'voices',
	'strings',
];

/** Chiavi i18n dei nomi di famiglia (namespace `ui`). */
export const SECTION_I18N_KEY: Record<SectionId, string> = {
	woodwinds: 'sect_woodwinds',
	brass: 'sect_brass',
	percussion: 'sect_percussion',
	strings: 'sect_strings',
	keyboards: 'sect_keyboards',
	plucked: 'sect_plucked',
	voices: 'sect_voices',
};

/** Ripiego se manca la traduzione (e per i test da riga di comando). */
export const SECTION_LABEL_IT: Record<SectionId, string> = {
	woodwinds: 'Legni',
	brass: 'Ottoni',
	percussion: 'Percussioni',
	strings: 'Archi',
	keyboards: 'Tastiere',
	plucked: 'Corde pizzicate',
	voices: 'Voci',
};

/**
 * Famiglia dedotta dal programma General MIDI.
 *
 * Le fasce GM sono quasi sempre omogenee (56-63 ottoni, 64-79 ance e canne = legni), ma
 * hanno tre trabocchetti che vanno tolti a mano, perché cadono proprio in mezzo agli archi:
 * 46 = arpa, 47 = timpani, e 52-54 = coro/voci dentro la fascia «ensemble». Sbagliarli
 * significa vedere i timpani abbracciati ai violini dalla stessa parentesi.
 */
export function sezioneDaStrumento(instrumentId: number | undefined, isDrum?: boolean): SectionId | undefined {
	if (isDrum) return 'percussion';
	const p = Number(instrumentId);
	if (!Number.isFinite(p) || p < 0 || p > 127) return undefined;

	// Eccezioni dentro le fasce, prima delle fasce stesse.
	if (p === 46) return 'plucked';       // arpa
	if (p === 47) return 'percussion';    // timpani
	if (p >= 52 && p <= 54) return 'voices'; // coro «aahs»/«oohs», voce sintetica

	if (p <= 7) return 'keyboards';       // pianoforti, clavicembalo, celesta…
	if (p <= 15) return 'percussion';     // percussioni intonate: vibrafono, marimba, campane
	if (p <= 23) return 'keyboards';      // organi, fisarmonica
	if (p <= 31) return 'plucked';        // chitarre
	// 32 è il contrabbasso acustico (qui: `double_bass_pizz`): in una partitura sta negli
	// archi, non fra i bassi da ritmica — quelli sono i 33-39, elettrici.
	if (p === 32) return 'strings';
	if (p <= 39) return 'plucked';        // bassi elettrici
	if (p <= 51) return 'strings';        // archi soli e d'insieme (43 = contrabbasso)
	if (p <= 63) return 'brass';          // ottoni (55 = «orchestra hit», resta qui)
	if (p <= 79) return 'woodwinds';      // ance (sax, oboe, corno inglese, fagotto, clarinetto) e canne (ottavino, flauto…)
	if (p <= 103) return undefined;       // sintetizzatori: nessuna famiglia d'orchestra
	if (p <= 111) return 'plucked';       // strumenti etnici a corda
	if (p <= 119) return 'percussion';    // percussivi
	return undefined;                      // effetti sonori
}

/** Famiglia EFFETTIVA di una traccia: la scelta dell'utente vince sulla deduzione. */
export function sezioneEffettiva(track: {
	instrumentId?: number;
	isDrum?: boolean;
	section?: string;
}): SectionId | undefined {
	const scelta = track.section as SectionChoice | undefined;
	if (scelta === 'none') return undefined;
	if (scelta && (SECTION_ORDER as string[]).includes(scelta)) return scelta as SectionId;
	return sezioneDaStrumento(track.instrumentId, track.isDrum);
}
