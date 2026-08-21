/**
 * LA VOCE DALL'ACCORDO — assegnazione delle voci SATB per ordine verticale.
 *
 * Il modo di scrittura «carta e matita»: si scrivono le note e basta, e la voce non la si
 * dichiara mai. Chi decide è la stessa cosa che decide sulla pagina stampata, cioè l'ORDINE
 * VERTICALE dentro l'accordo: la più acuta è il soprano, la più grave è il basso.
 *
 * DUE COSE CHE NON DECIDONO, ed è importante che non decidano:
 *
 *  • Il RIGO. In posizione stretta il tenore si scrive sul rigo di violino, quindi «rigo
 *    basso = tenore o basso» non è vero. Il rigo è impaginazione, non identità di voce, e
 *    qui non entra: l'ordine verticale è preso sull'accordo intero.
 *  • L'ORDINE IN CUI SI SCRIVE. Soprano e poi tenore, o il contrario, o tutte e quattro a
 *    rovescio: il risultato è identico, perché si guarda l'accordo finito e non il percorso
 *    che ci ha portato.
 *
 * LE PAUSE COMANDANO. Una pausa non ha altezza, quindi l'ordine verticale non può
 * collocarla: la sua voce viene da dove la si posa, come sulla carta. Perciò la pausa si
 * PRENDE la sua voce e le note si distribuiscono su quelle rimaste. La precedenza va in una
 * direzione sola, altrimenti due meccanismi litigherebbero sullo stesso posto.
 *
 * QUANDO NON PUÒ SAPERE lo dice invece di indovinare. Un accordo con due note e nessuna
 * pausa è ambiguo — soprano e basso? soprano e tenore? — e lo è anche per un lettore umano.
 * In quel caso si tengono le voci ESTREME, che è la convenzione della scrittura ridotta,
 * ma `certo: false` segnala che è una convenzione e non una lettura.
 */

export type VoiceNum = 1 | 2 | 3 | 4;

/** Voci in uso secondo il numero di parti. A tre parti la convenzione è 1-2-4 (voci
 *  ESTREME più il contralto): il tenore è la parte che si toglie per prima. */
export function vociInUso(partCount: number): VoiceNum[] {
	if (partCount <= 2) return [1, 4];
	if (partCount === 3) return [1, 2, 4];
	return [1, 2, 3, 4];
}

export interface NotaDaCollocare {
	id: string;
	/** Altezza in semitoni. Le pause non ne hanno. */
	midi?: number | null;
	isRest?: boolean;
	/** Voce gia' scritta: per le PAUSE (e per le note tenute da prima) e' quella che
	 *  rivendicano, e comanda. */
	voice?: number | null;
	/** Il rigo su cui l'elemento e' scritto ('treble', 'bass', o le chiavi antiche). */
	rigo: string;
}

export interface EsitoCollocazione {
	/** id → voce, SOLO per cio' che e' determinato. Chi non c'e' resta com'e': la sua voce
	 *  e' un'ipotesi, non una lettura, e si disegna neutra. */
	voci: Map<string, VoiceNum>;
}

/**
 * LA CERTEZZA E' PER RIGO, non per accordo.
 *
 * Dentro un pentagramma le voci che lo abitano sono note in partenza (nel grand staff
 * normale: soprano e contralto sopra, tenore e basso sotto; in parti strette il rigo alto
 * ne ospita tre). Quindi appena su un rigo ci sono tante note quante sono le sue voci
 * libere, l'ordine verticale le determina TUTTE — e lo fa subito, senza aspettare che
 * l'accordo sia completo.
 *
 * E' anche l'unica riassegnazione sicura da fare mentre si scrive: due voci dello stesso
 * rigo si disegnano sullo stesso rigo, quindi correggerne l'ordine non fa MAI saltare una
 * nota da un pentagramma all'altro sotto le mani.
 *
 * Cio' che non e' determinato non viene toccato: una nota sola su un rigo puo' essere il
 * tenore o il basso, e nessuna regola verticale puo' saperlo finche' non arriva la seconda
 * (o la pausa che dice chi tace).
 */
export function vociDeterminate(
	elementi: NotaDaCollocare[],
	/** rigo → voci che quel rigo ospita, ORDINATE dall'acuto al grave. */
	vociDelRigo: Map<string, VoiceNum[]>,
): EsitoCollocazione {
	const voci = new Map<string, VoiceNum>();

	const perRigo = new Map<string, NotaDaCollocare[]>();
	for (const el of elementi) {
		const arr = perRigo.get(el.rigo);
		if (arr) arr.push(el); else perRigo.set(el.rigo, [el]);
	}

	for (const [rigo, dentro] of perRigo) {
		const ospitate = vociDelRigo.get(rigo);
		if (!ospitate || ospitate.length === 0) continue;

		// 1) Chi rivendica (pause posate li', note e pause tenute da prima) si tiene la sua
		//    voce e la toglie dal giro.
		const occupate = new Set<VoiceNum>();
		for (const el of dentro) {
			if (!el.isRest) continue;
			const v = Number(el.voice) as VoiceNum;
			if (ospitate.includes(v)) occupate.add(v);
		}
		const libere = ospitate.filter(v => !occupate.has(v));

		// 2) Le note del rigo, dall'acuto al grave.
		const note = dentro
			.filter(el => !el.isRest && Number.isFinite(Number(el.midi)))
			.sort((a, b) => Number(b.midi) - Number(a.midi));

		// 3) Determinato solo quando le note riempiono le voci libere di QUESTO rigo.
		//    Meno note che voci: non si sa quale sia quale, e non si tocca.
		if (note.length !== libere.length) continue;
		note.forEach((n, i) => voci.set(n.id, libere[i]));
	}

	return { voci };
}
