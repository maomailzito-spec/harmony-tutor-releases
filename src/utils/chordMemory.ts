/**
 * LA MEMORIA DELL'ACCORDO — cio' che un pattern non suona non va perduto.
 *
 * Un pattern di accompagnamento non e' un effetto applicato sopra un accordo conservato
 * altrove: le note scritte SONO l'accordo, e il pattern successivo lo ricostruisce da
 * quelle. Ne segue che ogni figura piu' corta dell'accordo ne cancella una parte per
 * sempre: cambiando pattern due volte ci si ritrova con un accordo diverso da quello che si
 * era scritto, senza aver tolto niente a mano — e il comportamento dei pattern sembra
 * imprevedibile, perche' ogni passaggio parte da un accordo un po' piu' povero.
 *
 * Il rimedio e' che cio' che il pattern NON suona viaggi con le note e torni dentro
 * all'applicazione successiva. Due proprieta' che contano:
 *
 *  • SI CONSERVA SOLO CIO' CHE ANDREBBE PERSO. Se la figura tocca tutte le note
 *    dell'accordo — arpeggi, blocco — il campo non viene nemmeno scritto: niente peso nel
 *    file e niente da mantenere allineato.
 *  • LA MEMORIA SI EREDITA. Passando per tre figure di fila le note messe da parte dalla
 *    prima non si perdono per strada alla seconda.
 */

/** Campi che descrivono DOVE e QUANDO: si rifanno a ogni applicazione, quindi non si
 *  conservano — ricordarli produrrebbe note fantasma con posizioni vecchie. */
const CAMPI_VOLATILI = ['id', 'startTick', 'durationTicks', 'beat', 'chordGroupId', 'playbackDurationTicks', 'chordDropped'] as const;

function senzaVolatili(n: any): any {
	const fuori = new Set<string>(CAMPI_VOLATILI as readonly string[]);
	const out: any = {};
	for (const k of Object.keys(n ?? {})) if (!fuori.has(k)) out[k] = n[k];
	return out;
}

/**
 * Marca le note prodotte da un pattern con le note dell'accordo che il pattern non suona.
 *
 * @param prodotte le note che il pattern ha generato
 * @param base     l'accordo di partenza (puo' a sua volta portare una memoria da ereditare)
 */
export function conMemoriaDellAccordo<T extends { midi?: number | null }>(prodotte: T[], base: T[]): T[] {
	const presenti = new Set<number>();
	for (const n of prodotte) {
		const m = Number((n as any)?.midi);
		if (Number.isFinite(m)) presenti.add(m);
	}

	const candidate: any[] = [...base];
	for (const b of base) for (const d of ((b as any)?.chordDropped ?? [])) candidate.push(d);

	const scartate: any[] = [];
	const visti = new Set<number>();
	for (const c of candidate) {
		const m = Number(c?.midi);
		if (!Number.isFinite(m) || presenti.has(m) || visti.has(m)) continue;
		visti.add(m);
		scartate.push(senzaVolatili(c));
	}

	return prodotte.map((n: any) => {
		const pulita = { ...n };
		delete pulita.chordDropped;
		return (scartate.length > 0 ? { ...pulita, chordDropped: scartate } : pulita) as T;
	});
}

/**
 * Rimette nell'accordo le note che un pattern precedente aveva messo da parte.
 * Restituisce le altezze dell'accordo, dal grave all'acuto, senza doppioni.
 */
export function accordoConLeNoteRecuperate(noteScritte: any[]): any[] {
	const perMidi = new Map<number, any>();
	for (const n of noteScritte) {
		const m = Number(n?.midi);
		if (Number.isFinite(m) && !perMidi.has(m)) perMidi.set(m, n);
	}
	for (const n of noteScritte) {
		for (const d of (n?.chordDropped ?? [])) {
			const m = Number(d?.midi);
			if (Number.isFinite(m) && !perMidi.has(m)) perMidi.set(m, d);
		}
	}
	return [...perMidi.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
}
