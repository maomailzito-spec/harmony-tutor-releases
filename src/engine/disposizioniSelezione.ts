/**
 * LE DISPOSIZIONI POSSIBILI DI UN ACCORDO GIÀ SCRITTO.
 *
 * Serve al gesto che l'utente ha descritto: «se vedo un passaggio che non mi convince,
 * seleziono, decido quali parti devono cambiare delle quattro voci e vado muovendole finché
 * non trovo la disposizione adeguata».
 *
 * È mirato al contrario di come lavora il generatore. Il generatore SCEGLIE; qui si
 * ENUMERA e basta, e a scegliere è l'utente scorrendo. Il checker non entra in questo file:
 * l'analisi gira già sullo spartito e marca gli errori mentre si cicla, quindi il verdetto
 * l'utente ce l'ha davanti senza che nessuno glielo debba ripetere.
 *
 * Due differenze importanti dal ciclo delle sette disposizioni (`VOICING_DISPOSITIONS`):
 *
 *   - RISPETTA LE VOCI SCELTE. Le voci che l'utente non ha selezionato non si muovono di un
 *     semitono. La selezione è già l'affermazione «muovi questi»: non serve altra interfaccia.
 *   - NON HA BISOGNO DI SAPERE CHE ACCORDO È. Le classi d'altezza a disposizione sono quelle
 *     che stanno scritte, e la GRAFIA di ciascuna si riprende dalla nota che la portava. Così
 *     funziona su un corale scritto a mano o generato, dove i dati dell'accordo (`chordPcs`,
 *     `chordRootName`) che il revoice degli accordi cifrati si aspetta non ci sono.
 */
import type { StaffNote } from '../types';

export type Voce = 1 | 2 | 3 | 4;

/** Ambiti SATB, gli stessi del generatore. */
const AMBITI: Record<Voce, { min: number; max: number }> = {
  1: { min: 60, max: 79 },  // soprano  Do4 – Sol5
  2: { min: 55, max: 74 },  // contralto Sol3 – Re5
  3: { min: 48, max: 67 },  // tenore   Do3 – Sol4
  4: { min: 40, max: 60 },  // basso    Mi2 – Do4
};

/** Una disposizione: l'altezza di ciascuna delle quattro voci. */
export type Disposizione = Record<Voce, number>;

const pc = (m: number) => ((m % 12) + 12) % 12;

/**
 * Tutte le disposizioni possibili dell'accordo scritto, ordinate da quella che si sposta
 * MENO rispetto a com'è adesso — così scorrendo si allontana per gradi invece che saltare.
 *
 * @param note        le note dell'accordo (una per voce, voci 1..4)
 * @param vociLibere  quali voci possono muoversi; le altre restano dove sono
 * @param precedente  l'accordo prima, se c'è: a parità di spostamento si preferisce la
 *                    disposizione che gli si lega meglio
 */
export function disposizioniPossibili(
  note: StaffNote[],
  vociLibere: Set<number>,
  precedente?: Disposizione | null,
): Disposizione[] {
  const perVoce = new Map<Voce, StaffNote>();
  for (const n of note) {
    const v = Number((n as any).voice) as Voce;
    if (v >= 1 && v <= 4 && !(n as any).isRest) perVoce.set(v, n);
  }
  if (perVoce.size !== 4) return [];

  const attuale = {
    1: Number((perVoce.get(1) as any).midi), 2: Number((perVoce.get(2) as any).midi),
    3: Number((perVoce.get(3) as any).midi), 4: Number((perVoce.get(4) as any).midi),
  } as Disposizione;

  // Le classi d'altezza a disposizione sono quelle scritte: nessuna nota nuova entra
  // nell'accordo, si ridistribuisce ciò che c'è.
  const classi = Array.from(new Set([1, 2, 3, 4].map(v => pc(attuale[v as Voce]))));

  // Le altezze che ciascuna voce può prendere: le classi dell'accordo dentro il suo ambito.
  const scelte: Record<Voce, number[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (const v of [1, 2, 3, 4] as Voce[]) {
    if (!vociLibere.has(v)) { scelte[v] = [attuale[v]]; continue; }
    const { min, max } = AMBITI[v];
    const out: number[] = [];
    for (let m = min; m <= max; m++) if (classi.includes(pc(m))) out.push(m);
    scelte[v] = out;
  }

  const fuori: Disposizione[] = [];
  for (const b of scelte[4]) for (const t of scelte[3]) {
    if (t < b) continue;                       // niente incroci
    if (t - b > 24) continue;                  // basso e tenore possono stare larghi, ma non tanto
    for (const a of scelte[2]) {
      if (a < t || a - t > 12) continue;       // fra voci contigue superiori, mai più di un'ottava
      for (const s of scelte[1]) {
        if (s < a || s - a > 12) continue;
        // L'accordo deve restare COMPLETO: ridistribuire non vuol dire perdere una nota.
        const presenti = new Set([pc(b), pc(t), pc(a), pc(s)]);
        if (presenti.size !== classi.length) continue;
        fuori.push({ 1: s, 2: a, 3: t, 4: b });
      }
    }
  }

  // L'ordine è il senso di questo elenco: prima ciò che somiglia a com'è adesso.
  const spostamento = (d: Disposizione) =>
    ([1, 2, 3, 4] as Voce[]).reduce((tot, v) => tot + Math.abs(d[v] - attuale[v]), 0);
  const legame = (d: Disposizione) => precedente
    ? ([1, 2, 3, 4] as Voce[]).reduce((tot, v) => tot + Math.abs(d[v] - precedente[v]), 0)
    : 0;
  fuori.sort((x, y) => (spostamento(x) - spostamento(y)) || (legame(x) - legame(y)));
  return fuori;
}

/** La grafia di ogni classe d'altezza, ripresa dalle note scritte. */
export function grafiaPerClasse(note: StaffNote[]): Map<number, StaffNote> {
  const m = new Map<number, StaffNote>();
  for (const n of note) {
    if ((n as any).isRest) continue;
    const k = pc(Number((n as any).midi));
    if (!m.has(k)) m.set(k, n);
  }
  return m;
}
