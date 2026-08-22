/**
 * STRUMENTI TRASPOSITORI — come si SCRIVE ciò che suona.
 *
 * Una tromba in Si♭ legge un Do e suona un Si♭. Sulla pagina quindi convivono due altezze
 * per la stessa nota, e bisogna decidere quale sta nel file.
 *
 * QUI DENTRO IL FILE PORTA IL SUONO REALE, e la scrittura si ricava. Non e' una scelta
 * nuova: l'importatore MusicXML lo fa gia' — trascrive le parti traspositrici in suoni
 * reali perche' «il programma non lo sa rappresentare». Tenendo quella convenzione,
 * l'analisi continua a leggere l'armonia vera senza sapere niente di tutto questo, la
 * riproduzione suona cio' che e' scritto nel file, e l'uscita MIDI resta giusta. Cambia
 * solo il DISEGNO, che e' esattamente cio' che l'interruttore «suoni reali» commuta.
 *
 * L'intervallo si descrive con DUE numeri, non uno. I semitoni da soli non bastano a
 * scrivere: +2 semitoni sopra un La♭ danno un Si♭, non un La♯, e per saperlo bisogna
 * muovere anche la LETTERA. Ogni strumento porta quindi il salto cromatico e quello
 * diatonico, ed e' la coppia a produrre l'alterazione giusta in chiave e sul rigo.
 */

import type { KeySignature } from '../types';

const LETTERE = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const INDICE_LETTERA: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const PC_LETTERA: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const mod = (n: number, m: number) => ((n % m) + m) % m;

export interface Trasposizione {
	/** Semitoni da SCRITTO a SUONATO: la tromba in Si♭ vale -2 (scrive Do, suona Si♭). */
	semitoni: number;
	/** Gradi di scala (lettere) nello stesso verso: -1 per il Si♭, -4 per il Fa. */
	gradi: number;
}

export interface StrumentoTraspositore extends Trasposizione {
	id: string;
	/** Nome breve mostrato nell'interfaccia (è già notazione, non si traduce). */
	sigla: string;
	i18nKey: string;
}

/** I tagli piu' comuni.
 *
 * NIENTE OTTAVE, di proposito: chitarra, basso e contrabbasso hanno gia' `octaveTranspose`,
 * che e' un'altra cosa — la chiave con l'8 sotto, dove la nota resta scritta dov'e' e scende
 * solo il suono. Mettere l'ottava anche qui darebbe due meccanismi per lo stesso mestiere, e
 * chi ne accendesse due si troverebbe la parte due ottave fuori. */
export const STRUMENTI_TRASPOSITORI: StrumentoTraspositore[] = [
	{ id: 'none',       sigla: 'in Do',   i18nKey: 'transp_none',       semitoni: 0,   gradi: 0 },
	{ id: 'bb',         sigla: 'in Si♭',  i18nKey: 'transp_bb',         semitoni: -2,  gradi: -1 },
	{ id: 'a',          sigla: 'in La',   i18nKey: 'transp_a',          semitoni: -3,  gradi: -2 },
	{ id: 'eb_alto',    sigla: 'in Mi♭',  i18nKey: 'transp_eb_alto',    semitoni: -9,  gradi: -5 },
	{ id: 'f',          sigla: 'in Fa',   i18nKey: 'transp_f',          semitoni: -7,  gradi: -4 },
	{ id: 'bb_tenore',  sigla: 'in Si♭ (9ª)', i18nKey: 'transp_bb_tenor', semitoni: -14, gradi: -8 },
	{ id: 'eb_baritono',sigla: 'in Mi♭ (13ª)', i18nKey: 'transp_eb_bari', semitoni: -21, gradi: -12 },
	{ id: 'eb_sopra',   sigla: 'in Mi♭ (3ª sopra)', i18nKey: 'transp_eb_above', semitoni: 3, gradi: 2 },
];

export function trasposizioneDaId(id?: string | null): Trasposizione {
	const t = STRUMENTI_TRASPOSITORI.find(x => x.id === id);
	return t ? { semitoni: t.semitoni, gradi: t.gradi } : { semitoni: 0, gradi: 0 };
}

export interface Compitata {
	/** Lettera: 'C'…'B'. */
	lettera: string;
	octave: number;
	midi: number;
	/** Alterazione in semitoni rispetto alla lettera naturale: -2…+2. */
	alterazione: number;
}

/**
 * Sposta una nota di un intervallo dato come coppia (semitoni, gradi).
 *
 * L'alterazione non si sceglie: si RICAVA. Fissata la lettera d'arrivo e l'altezza
 * d'arrivo, la differenza fra le due e' l'alterazione necessaria — ed e' cosi' che un
 * La♭ salito di seconda maggiore diventa Si♭ e non La♯.
 */
export function spostaDiIntervallo(nota: { lettera: string; octave: number; midi: number }, di: Trasposizione): Compitata {
	const assoluto = nota.octave * 7 + (INDICE_LETTERA[nota.lettera] ?? 0);
	const nuovoAssoluto = assoluto + di.gradi;
	const lettera = LETTERE[mod(nuovoAssoluto, 7)];
	const octave = Math.floor(nuovoAssoluto / 7);
	const midi = nota.midi + di.semitoni;
	const alterazione = midi - ((octave + 1) * 12 + PC_LETTERA[lettera]);
	return { lettera, octave, midi, alterazione };
}

/** Da SUONO REALE a SCRITTURA per lo strumento: il verso opposto della trasposizione. */
export function comeSiScrive(nota: { lettera: string; octave: number; midi: number }, di: Trasposizione): Compitata {
	return spostaDiIntervallo(nota, { semitoni: -di.semitoni, gradi: -di.gradi });
}

/** Da SCRITTURA a SUONO REALE: serve quando si scrive una nota con la vista traspositrice. */
export function comeSuona(nota: { lettera: string; octave: number; midi: number }, di: Trasposizione): Compitata {
	return spostaDiIntervallo(nota, di);
}

/**
 * L'armatura che LEGGE lo strumento. Un brano in Do maggiore su una tromba in Si♭ si
 * scrive in Re maggiore: l'armatura si sposta dello stesso intervallo delle note, se no
 * ogni nota porterebbe la sua alterazione e la parte sarebbe illeggibile.
 */
export function armaturaScritta(concert: KeySignature, di: Trasposizione): KeySignature {
	const root = String((concert as any).root ?? 'C');
	const lettera = root[0].toUpperCase();
	const alt = root.slice(1).replace(/♯/g, '#').replace(/♭/g, 'b');
	const alterazione = (alt.match(/#/g)?.length ?? 0) - (alt.match(/b/g)?.length ?? 0);
	const midi = 60 + PC_LETTERA[lettera] + alterazione;
	const spostata = comeSiScrive({ lettera, octave: 4, midi }, di);
	const suffisso = spostata.alterazione > 0 ? '#'.repeat(spostata.alterazione)
		: spostata.alterazione < 0 ? 'b'.repeat(-spostata.alterazione) : '';
	return { ...(concert as any), root: spostata.lettera + suffisso } as KeySignature;
}
