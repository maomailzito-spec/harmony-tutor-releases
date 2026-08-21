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
	/** Voce già scritta sulla nota: per le PAUSE è quella posata dall'utente e comanda. */
	voice?: number | null;
}

export interface EsitoCollocazione {
	/** id della nota → voce assegnata. Contiene solo ciò che va cambiato o confermato. */
	voci: Map<string, VoiceNum>;
	/** false quando l'accordo non basta a determinare le voci e si è usata la convenzione
	 *  delle voci estreme (accordo incompleto senza pause che dicano chi tace). */
	certo: boolean;
	/** Note che non hanno trovato posto: più note che voci libere. Restano come stanno. */
	avanzate: string[];
}

/**
 * Assegna le voci alle note di UN SOLO accordo (un attacco).
 *
 * @param elementi note e pause che attaccano in quel punto
 * @param partCount numero di parti della scrittura (4, 3, 2)
 */
export function vociDallAccordo(elementi: NotaDaCollocare[], partCount: number): EsitoCollocazione {
	const voci = new Map<string, VoiceNum>();
	const inUso = vociInUso(partCount);

	// 1) Le pause si prendono la loro voce e la tolgono dal giro.
	const occupate = new Set<VoiceNum>();
	for (const el of elementi) {
		if (!el.isRest) continue;
		const v = Number(el.voice);
		if (inUso.includes(v as VoiceNum)) {
			occupate.add(v as VoiceNum);
			voci.set(el.id, v as VoiceNum);
		}
	}

	// 2) Le note si ordinano dall'acuto al grave e prendono le voci rimaste nello stesso
	//    ordine: la più acuta la voce più alta fra quelle libere.
	const note = elementi
		.filter(el => !el.isRest && Number.isFinite(Number(el.midi)))
		.sort((a, b) => Number(b.midi) - Number(a.midi));

	const libere = inUso.filter(v => !occupate.has(v));

	// L'accordo determina le voci solo se riempie tutte le parti: note + pause = parti.
	const certo = note.length + occupate.size >= inUso.length;

	// 3) Accoppiamento DALL'ESTERNO VERSO IL CENTRO: la nota più acuta con la voce libera
	//    più alta, la più grave con la più bassa, poi si stringe. Un solo giro di regola che
	//    copre tutti i casi:
	//     · accordo pieno → assegnazione completa e determinata;
	//     · accordo incompleto → restano prese le voci ESTREME, che è la convenzione della
	//       scrittura ridotta (due note diventano soprano e basso);
	//     · note di troppo → ad avanzare è una voce INTERNA, non il basso. Partendo dall'alto
	//       avanzava la nota più grave, cioè si perdeva proprio quella che regge l'armonia.
	const avanzate: string[] = [];
	const scelte: Array<VoiceNum | undefined> = new Array(note.length);
	{
		let i = 0;
		let j = note.length - 1;
		let alta = 0;
		let bassa = libere.length - 1;
		while (i <= j && alta <= bassa) {
			scelte[i] = libere[alta];
			i++; alta++;
			if (i > j || alta > bassa) break;
			scelte[j] = libere[bassa];
			j--; bassa--;
		}
	}
	note.forEach((n, k) => {
		const v = scelte[k];
		if (v) voci.set(n.id, v);
		else avanzate.push(n.id);
	});

	return { voci, certo, avanzate };
}
