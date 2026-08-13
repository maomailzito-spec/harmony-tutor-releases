/**
 * SMONTARE UNA SIGLA D'ACCORDO — `Gm(add9)/A` → fondamentale, qualità, basso.
 *
 * Serve a tre cose che vogliono la sigla a pezzi e non come stringa:
 *  · `<harmony>` del MusicXML, che chiede radice, tipo e basso separati;
 *  · `<Harmony>` del formato nativo di MuseScore;
 *  · la forma PARLATA per lo screen reader — «Sol minore con nona aggiunta sul
 *    basso di La» invece di «gi-emme-parentesi-a-di-di-nove».
 *
 * REGOLA DI FONDO: una sigla che non si riesce a scomporre NON si perde. Si
 * restituisce comunque la radice (che è la parte che si riconosce quasi sempre) e
 * il testo originale, così chi scrive il file può metterlo come testo invece di
 * buttarlo via. Meglio una sigla scritta a mano che una sigla mancante.
 */

export interface ChordSymbolParts {
    /** Lettera della fondamentale, A–G. */
    rootStep: string;
    /** Alterazione della fondamentale in semitoni: −2…+2. */
    rootAlter: number;
    /** Il corpo della sigla senza fondamentale e senza basso, nella grafia ORIGINALE
     *  comprese le parentesi: `m7`, `maj7`, `m(add9)`. È questo che si stampa. */
    quality: string;
    /** Basso dichiarato dopo la barra, se c'è. */
    bassStep?: string;
    bassAlter?: number;
    /** La sigla com'era scritta: si stampa questa, non una ricostruzione. */
    text: string;
    /** Tipo secondo il vocabolario MusicXML; `other` quando non si riconosce. */
    kind: string;
    /** Come si dice ad alta voce, in italiano. */
    spoken: string;
}

/** Tipi MusicXML per le qualità che si incontrano davvero. L'ordine conta: si prova
 *  la chiave più LUNGA per prima, altrimenti `m7` verrebbe letto come `m`. */
const QUALITA: Array<[string, string, string]> = [
    // sigla scritta            tipo MusicXML          come si dice
    ['maj7',                    'major-seventh',       'settima maggiore'],
    ['maj9',                    'major-ninth',         'nona maggiore'],
    ['M7',                      'major-seventh',       'settima maggiore'],
    ['m7b5',                    'half-diminished',     'semidiminuito'],
    ['m7',                      'minor-seventh',       'minore settima'],
    ['m9',                      'minor-ninth',         'minore nona'],
    ['m6',                      'minor-sixth',         'minore con sesta'],
    ['mMaj7',                   'major-minor',         'minore con settima maggiore'],
    ['dim7',                    'diminished-seventh',  'settima diminuita'],
    ['dim',                     'diminished',          'diminuito'],
    ['aug',                     'augmented',           'aumentato'],
    ['sus4',                    'suspended-fourth',    'con quarta sospesa'],
    ['sus2',                    'suspended-second',    'con seconda sospesa'],
    ['sus',                     'suspended-fourth',    'con quarta sospesa'],
    ['add9',                    'other',               'con nona aggiunta'],
    ['13',                      'dominant-13th',       'tredicesima'],
    ['11',                      'dominant-11th',       'undicesima'],
    ['9',                       'dominant-ninth',      'nona'],
    ['7',                       'dominant',            'settima'],
    ['6',                       'major-sixth',         'con sesta'],
    ['m',                       'minor',               'minore'],
    ['-',                       'minor',               'minore'],
    ['+',                       'augmented',           'aumentato'],
    ['°',                       'diminished',          'diminuito'],
    ['ø',                       'half-diminished',     'semidiminuito'],
    ['',                        'major',               'maggiore'],
];

/** CODE che si aggiungono alla qualità: `m(add9)`, `7b9`, `9#11`. Vanno DETTE, non
 *  buttate — sono spesso la ragione per cui quella sigla è scritta così. */
const CODE: Array<[string, string]> = [
    ['add9',  'con nona aggiunta'],
    ['add11', 'con undicesima aggiunta'],
    ['add13', 'con tredicesima aggiunta'],
    ['b9',    'con nona bemolle'],
    ['#9',    'con nona diesis'],
    ['b5',    'con quinta bemolle'],
    ['#5',    'con quinta diesis'],
    ['#11',   'con undicesima aumentata'],
    ['b13',   'con tredicesima bemolle'],
    ['sus4',  'con quarta sospesa'],
    ['sus2',  'con seconda sospesa'],
    ['6',     'con sesta'],
    ['9',     'con nona'],
];

/** La coda detta a parole. Ciò che non si riconosce si legge com'è scritto: una sigla
 *  compitata è sgradevole, una sigla MUTA è un'informazione persa. */
function codaParlata(coda: string): string {
    let resto = coda.replace(/[()\s]/g, '');
    const parti: string[] = [];
    let sicurezza = 0;
    while (resto && sicurezza++ < 8) {
        const trovata = CODE.find(([sigla]) => resto.startsWith(sigla));
        if (!trovata) break;
        parti.push(trovata[1]);
        resto = resto.slice(trovata[0].length);
    }
    if (resto) parti.push(resto);
    return parti.join(' ');
}

const NOME_NOTA: Record<string, string> = {
    C: 'Do', D: 'Re', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si',
};

function alterazione(s: string): number {
    const t = s.replace(/♯/g, '#').replace(/♭/g, 'b');
    if (t === '##' || t === 'x') return 2;
    if (t === '#') return 1;
    if (t === 'bb') return -2;
    if (t === 'b') return -1;
    return 0;
}

function nomeParlato(step: string, alter: number): string {
    const base = NOME_NOTA[step] ?? step;
    if (alter === 1) return `${base} diesis`;
    if (alter === 2) return `${base} doppio diesis`;
    if (alter === -1) return `${base} bemolle`;
    if (alter === -2) return `${base} doppio bemolle`;
    return base;
}

/** Radice + alterazione dall'inizio di una sigla. null se non comincia con una nota. */
function leggiRadice(s: string): { step: string; alter: number; resto: string } | null {
    const m = s.trim().match(/^([A-G])(##|bb|[#b♯♭x])?(.*)$/);
    if (!m) return null;
    return { step: m[1], alter: alterazione(m[2] || ''), resto: m[3] || '' };
}

export function parseChordSymbol(symbol: string | null | undefined): ChordSymbolParts | null {
    const testo = String(symbol ?? '').trim();
    if (!testo) return null;

    // Il basso dopo la barra si stacca per primo: `Gm(add9)/A`.
    const [corpoRaw, bassoRaw] = testo.split('/');
    const radice = leggiRadice(corpoRaw);
    if (!radice) return null;

    // Le parentesi non cambiano l'accordo, sono solo grafia: `m(add9)` = `madd9`. Si
    // tolgono per RICONOSCERE la qualità, ma la grafia da stampare resta quella scritta.
    const corpoQualita = radice.resto.replace(/[()\s]/g, '');
    const qualitaScritta = radice.resto.trim();

    let kind = 'other';
    let dettoQualita = '';
    const qualita = qualitaScritta;
    for (const [sigla, tipo, detto] of QUALITA) {
        if (sigla === '' ? corpoQualita === '' : corpoQualita.startsWith(sigla)) {
            kind = tipo;
            dettoQualita = detto;
            // Coda oltre la qualità di base (`m` + `add9`, `7` + `b9`): l'accordo resta
            // quello, ma il tipo diventa `other` — così il file conserva il TESTO invece
            // di dichiarare un accordo che non è. E la coda si DICE: è spesso la ragione
            // per cui quella sigla è scritta così.
            const coda = corpoQualita.slice(sigla.length);
            if (coda) {
                kind = 'other';
                const detta = codaParlata(coda);
                if (detta) dettoQualita = `${detto} ${detta}`.trim();
            }
            break;
        }
    }

    const basso = bassoRaw ? leggiRadice(bassoRaw) : null;

    const parlatoBasso = basso ? ` sul basso di ${nomeParlato(basso.step, basso.alter)}` : '';
    const spoken = `${nomeParlato(radice.step, radice.alter)} ${dettoQualita || qualita}`.trim() + parlatoBasso;

    return {
        rootStep: radice.step,
        rootAlter: radice.alter,
        quality: qualita,
        ...(basso ? { bassStep: basso.step, bassAlter: basso.alter } : {}),
        text: testo,
        kind,
        spoken,
    };
}

/** Numero TPC di MuseScore per una nota: linea delle quinte, Do naturale = 14. */
export function tpcOf(step: string, alter: number): number {
    const NATURALE: Record<string, number> = { F: 13, C: 14, G: 15, D: 16, A: 17, E: 18, B: 19 };
    return (NATURALE[step] ?? 14) + 7 * alter;
}
