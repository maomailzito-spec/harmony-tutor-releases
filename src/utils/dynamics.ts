/**
 * DINAMICHE — dal segno scritto alla velocity suonata.
 *
 * I segni di dinamica sono oggetti della partitura: valgono per TUTTE le voci
 * (scelta dell'utente: un *f* si scrive una volta e riguarda l'insieme, come nella
 * scrittura corale), e sono ancorati a un punto nel tempo — `absBeat` — come già
 * fanno gli override d'armonia e i contesti d'analisi.
 *
 * Questo modulo è PURO: nessun React, nessuna geometria, nessun accesso al disco.
 * Serve al playback, all'esportazione e ai collaudi allo stesso modo.
 */

export type DynamicLevel = 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff';

/** Segno di dinamica: un livello, oppure una forcella fra due punti. */
export type DynamicMark =
    | { kind: 'level'; absBeat: number; level: DynamicLevel }
    /** Accento istantaneo su quel solo attacco (sf, sfz, rf). Non cambia il livello in vigore. */
    | { kind: 'accent'; absBeat: number; label: 'sf' | 'sfz' | 'rf' }
    /** Forte piano: attacco forte, e da lì in poi si resta piano. */
    | { kind: 'fp'; absBeat: number }
    /** Forcella: da un punto all'altro, crescendo o diminuendo. */
    | { kind: 'hairpin'; fromAbsBeat: number; toAbsBeat: number; direction: 'cresc' | 'dim' };

/**
 * Livello → velocity MIDI. Scala convenzionale, la stessa che usano i programmi di
 * notazione: lascia spazio sopra e sotto per gli accenti senza saturare.
 */
export const DYNAMIC_VELOCITY: Record<DynamicLevel, number> = {
    ppp: 16, pp: 33, p: 49, mp: 64, mf: 80, f: 96, ff: 112, fff: 127,
};

/** Livello di partenza quando il brano non dice niente. */
export const DEFAULT_DYNAMIC: DynamicLevel = 'mf';

const ORDER: DynamicLevel[] = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];

/** Un gradino più forte / più piano, per le forcelle che non hanno un arrivo scritto. */
const step = (l: DynamicLevel, dir: 'cresc' | 'dim'): DynamicLevel => {
    const i = ORDER.indexOf(l);
    const j = Math.max(0, Math.min(ORDER.length - 1, i + (dir === 'cresc' ? 2 : -2)));
    return ORDER[j];
};

const EPS = 1e-6;
const clampVel = (v: number) => Math.max(1, Math.min(127, Math.round(v)));

// ── La curva percettiva: velocity → volume ──
// Sta QUI, insieme alle dinamiche, e non nell'editor: è la stessa scala che serve per
// suonare e per interpolare le forcelle. Tenerla altrove voleva dire interpolare numeri
// di velocity — che sono lineari — mentre l'orecchio sente in decibel: il crescendo
// partiva a razzo e si spegneva a metà.
// Ampiezza (59) e curvatura (2.5) sono i due numeri da girare per tarare a orecchio:
// il mezzoforte resta ≈ −5 dB (livello storico del programma), il pianissimo ≈ −28.
const AMPIEZZA_DB = 59;
const CURVATURA = 2.5;
const PAVIMENTO_DB = -36; // sotto, un pianissimo su un portatile sparisce

/** Forma delle forcelle: quanto il movimento si concentra nella zona debole.
 *  1 = passi tutti uguali in decibel; sotto 1 = più ampi all'inizio di un crescendo
 *  (e alla fine di un diminuendo), che è dove l'orecchio ha più risoluzione.
 *  È il numero da girare a orecchio. */
const FORMA_FORCELLA = 0.7;

/** Decibel (rispetto al massimo) di una velocity MIDI. */
export const dbForVelocity = (velocity: number): number => {
    const v = Math.max(0, Math.min(127, velocity)) / 127;
    return Math.max(PAVIMENTO_DB, -AMPIEZZA_DB * Math.pow(1 - v, CURVATURA));
};

/** L'inverso: la velocity che produce quei decibel. Serve alle forcelle. */
const velocityForDb = (db: number): number => {
    const d = Math.max(PAVIMENTO_DB, Math.min(0, db));
    const v = 1 - Math.pow(-d / AMPIEZZA_DB, 1 / CURVATURA);
    return v * 127;
};

/** Velocity → fattore di volume per il playback. Le note senza velocity restano piene. */
export function velocityToGain(velocity: number | undefined): number {
    if (velocity == null || !Number.isFinite(velocity)) return 1;
    return Math.pow(10, dbForVelocity(velocity) / 20);
}

/** Livelli e fp ordinati nel tempo (gli unici che spostano il livello in vigore). */
const levelPoints = (marks: DynamicMark[]): Array<{ absBeat: number; level: DynamicLevel }> => {
    const out: Array<{ absBeat: number; level: DynamicLevel }> = [];
    for (const m of marks || []) {
        if (!m) continue;
        if (m.kind === 'level') out.push({ absBeat: m.absBeat, level: m.level });
        else if (m.kind === 'fp') out.push({ absBeat: m.absBeat, level: 'p' }); // dopo l'attacco si resta piano
    }
    return out.sort((a, b) => a.absBeat - b.absBeat);
};

/** Livello scritto in vigore a un dato punto, ignorando le forcelle. */
export function levelAtAbsBeat(marks: DynamicMark[], absBeat: number): DynamicLevel {
    const pts = levelPoints(marks);
    let cur: DynamicLevel = DEFAULT_DYNAMIC;
    for (const p of pts) {
        if (p.absBeat <= absBeat + EPS) cur = p.level;
        else break;
    }
    return cur;
}

/**
 * Velocity da suonare per una nota che attacca in `absBeat`.
 *
 * In ordine: il livello scritto in vigore; se il punto cade dentro una forcella, si
 * interpola fra il livello di partenza e quello d'arrivo (se all'arrivo non c'è un
 * segno scritto, si assume un paio di gradini nella direzione della forcella);
 * infine gli accenti (sf, sfz, rf) e l'attacco del fp, che agiscono sulla sola nota.
 */
export function velocityAtAbsBeat(marks: DynamicMark[], absBeat: number): number {
    const attivi = marks || [];
    const base = DYNAMIC_VELOCITY[levelAtAbsBeat(attivi, absBeat)];

    // Forcella che contiene questo punto (l'ultima che comincia prima o qui).
    let vel = base;
    for (const m of attivi) {
        if (!m || m.kind !== 'hairpin') continue;
        const a = Math.min(m.fromAbsBeat, m.toAbsBeat);
        const b = Math.max(m.fromAbsBeat, m.toAbsBeat);
        if (absBeat < a - EPS || absBeat > b + EPS) continue;
        if (b - a < EPS) continue;

        const partenza = DYNAMIC_VELOCITY[levelAtAbsBeat(attivi, a)];
        // Arrivo: un livello scritto ESATTAMENTE alla fine della forcella (o subito
        // dopo) è la meta; altrimenti si va di due gradini nella sua direzione.
        const scrittoDopo = levelPoints(attivi).find(p => p.absBeat >= b - EPS);
        const arrivo = scrittoDopo
            ? DYNAMIC_VELOCITY[scrittoDopo.level]
            : DYNAMIC_VELOCITY[step(levelAtAbsBeat(attivi, a), m.direction)];

        // Interpolazione in DECIBEL, non sui numeri di velocity: interpolando la velocity
        // il crescendo guadagnava 8 dB fra la prima e la seconda nota e 0,2 fra le ultime
        // due — partiva a razzo e si spegneva a metà.
        //
        // E la salita non è nemmeno uniforme, ma PIÙ AMPIA DOVE IL SUONO È DEBOLE e più
        // stretta dove è già forte: in cima l'orecchio distingue meno, e passi uguali lì
        // sono sprecati. Vale in tutte e due le direzioni, perché è una regola sul
        // livello e non sulla direzione: nel diminuendo gli scarti sono piccoli finché
        // resta forte e si allargano quando è sceso.
        // FORMA_FORCELLA < 1 concentra il movimento nella zona debole; 1 = uniforme.
        const t = (absBeat - a) / (b - a);
        const dbPartenza = dbForVelocity(partenza);
        const dbArrivo = dbForVelocity(arrivo);
        const esponente = dbArrivo >= dbPartenza ? FORMA_FORCELLA : (1 / FORMA_FORCELLA);
        const tCurvo = Math.pow(t, esponente);
        vel = velocityForDb(dbPartenza + (dbArrivo - dbPartenza) * tCurvo);
    }

    // Accenti sulla singola nota.
    for (const m of attivi) {
        if (!m) continue;
        if (m.kind === 'accent' && Math.abs(m.absBeat - absBeat) < EPS) vel = vel + 30;
        if (m.kind === 'fp' && Math.abs(m.absBeat - absBeat) < EPS) vel = DYNAMIC_VELOCITY.f;
    }

    return clampVel(vel);
}

/** Etichetta da stampare sul rigo. */
export function dynamicLabel(m: DynamicMark): string {
    switch (m.kind) {
        case 'level': return m.level;
        case 'accent': return m.label;
        case 'fp': return 'fp';
        case 'hairpin': return m.direction === 'cresc' ? 'cresc.' : 'dim.';
        default: return '';
    }
}
