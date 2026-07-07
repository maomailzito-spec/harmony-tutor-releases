// ─────────────────────────────────────────────────────────────────────────────
// Token compatti per l'export accessibile. L'analisi viene scritta nello slot
// <figured-bass> (l'unico elemento che VoiceOver legge navigando l'accordo); l'app
// emette solo TOKEN compatti su una riga, senza separatori — la verbalizzazione
// italiana la fa il dizionario di pronuncia di VoiceOver (esterno all'app).
//
// Due percorsi dati distinti:
//   • Modo 2 (funzionale): GRADO rispetto alla tonica + cifra-rivolto + secondaria
//     concatenata.  Es. V7, V65, V43bVII.  (dalla analisi funzionale = roman)
//   • Modo 3 (assoluto): RADICE reale dell'accordo + cifra-rivolto.  Es. Bb, Bb65,
//     F#7.  (dalla sigla dell'engine, che porta la fondamentale spellata)
//
// Cifra-rivolto POSIZIONALE, attaccata alla radice:
//   '' = triade fondamentale · 6 = triade 1° · 64 = triade 2°
//   7  = settima fondamentale · 65 = settima 1° · 43 = settima 2° · 42 = settima 3°
// Nessun separatore (mai '/', virgole, spazi). Fallback: token grezzo, mai omesso.
// ─────────────────────────────────────────────────────────────────────────────

/** ♭→b, ♯→#, °/º/ø→o; toglie l'eventuale display-pivot "x=y" (tiene x). */
export function normalizeRoman(roman: string): string {
    let r = String(roman || '').trim();
    if (r.includes('=')) r = r.split('=')[0].trim();
    return r.replace(/♭/g, 'b').replace(/♯/g, '#').replace(/°/g, 'o').replace(/º/g, 'o').replace(/ø/g, 'o');
}

/** Cifra-rivolto posizionale dalle cifre del basso figurato. */
export function inversionFigure(figures: string[]): string {
    const f = (figures || []).map(x => String(x).replace('♯', '#').replace('♭', 'b').trim());
    const has = (s: string) => f.includes(s);
    if (has('6') && has('5')) return '65';
    if (has('4') && has('3')) return '43';
    if ((has('4') && has('2')) || (f.length === 1 && has('2'))) return '42';
    if (has('7')) return '7';
    if (has('6') && has('4')) return '64';
    if (has('6')) return '6';
    return '';
}

/** Modo 2 — token FUNZIONALE: grado (dalla tonica) + cifra-rivolto + secondaria concatenata.
 *  Fallback: romano grezzo senza barra, mai omesso. */
export function functionalToken(input: { roman: string; figures?: string[] }): string {
    const roman = normalizeRoman(input.roman);
    if (!roman) return '';
    if (/^N/.test(roman)) return 'N6';
    const aug = roman.match(/^(It|Fr|Ger)/);
    if (aug) return aug[1] + '6';

    const [numRaw, denRaw] = roman.split('/');
    const numBase = normalizeRoman(numRaw);
    const denBase = denRaw ? normalizeRoman(denRaw) : '';
    // Separa grado(+qualità o/+) dalle cifre GIÀ presenti nel romano: così, aggiungendo la
    // cifra-rivolto calcolata, non la DUPLICHIAMO (es. roman "V7" + figures ["7"] → "V7", non "V77").
    const gm = numBase.match(/^((?:b|#)?(?:vii|VII|iii|III|iv|IV|vi|VI|ii|II|i|I|v|V)[o+]*)(\d*)$/);
    if (!gm) return roman.replace(/\//g, '');
    const gradePart = gm[1];   // grado + eventuale qualità, es. "V", "viio", "bVII"
    const romanFigs = gm[2];   // cifre già scritte nel romano, es. "7"
    const figs = input.figures || [];
    // Le figure esplicite (basso figurato) vincono; se assenti, tengo quelle già nel romano.
    const inv = figs.length ? inversionFigure(figs) : romanFigs;
    return gradePart + inv + denBase;
}

/** Modo 3 — token ASSOLUTO: radice reale (dalla sigla) + cifra-rivolto. Ritorna null se la
 *  sigla non espone una radice utilizzabile → il chiamante ricade sulla cifratura numerica. */
export function absoluteToken(input: { symbol?: string; figures?: string[] }): string | null {
    const body = String(input.symbol || '').split('/')[0].trim();
    const m = body.match(/^([A-G])(#{1,2}|b{1,2}|♯|♭)?/);
    if (!m) return null;
    const acc = (m[2] || '').replace('♯', '#').replace('♭', 'b');
    return m[1] + acc + inversionFigure(input.figures || []);
}

// ── Modo "Parlata": FRASE italiana completa dell'analisi, scritta direttamente nel .mscx e
//    letta da VoiceOver SENZA dizionario. Stesse convenzioni del dizionario token→italiano. ──
const DEG_IT = ['primo', 'secondo', 'terzo', 'quarto', 'quinto', 'sesto', 'settimo'];
const ROMAN_DEG: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7 };
const FUNC_IT: Record<number, string> = {
    1: 'della tonica', 2: 'della sopratonica', 3: 'della mediante', 4: 'della sottodominante',
    5: 'della dominante', 6: 'della sopradominante', 7: 'della sensibile',
};

function phraseForDegree(deg: number, inv: string, dim: boolean, aug: boolean, alter: string): string {
    let g = DEG_IT[deg - 1] + ' grado';
    if (alter === 'b') g += ' abbassato';
    if (alter === '#') g += ' alzato';
    const isSeventh = inv === '7' || inv === '65' || inv === '43' || inv === '42';
    if (!isSeventh) {
        if (dim) g += ' diminuito';
        else if (aug) g += ' aumentato';
        if (inv === '6') return g + ' primo rivolto';
        if (inv === '64') return g + ' secondo rivolto';
        return g;
    }
    let base: string;
    if (deg === 5 && !dim && !alter) base = 'settima di dominante';
    else if (dim) base = 'settima diminuita sul ' + DEG_IT[deg - 1] + ' grado' + (alter === 'b' ? ' abbassato' : alter === '#' ? ' alzato' : '');
    else base = 'settima sul ' + g;
    if (inv === '65') return base + ' in primo rivolto';
    if (inv === '43') return base + ' in secondo rivolto';
    if (inv === '42') return base + ' in terzo rivolto';
    return base;
}

/** Modo "Parlata": frase italiana completa (analisi funzionale per gradi). Fallback: romano grezzo. */
export function spokenPhrase(input: { roman: string; figures?: string[] }): string {
    const roman = normalizeRoman(input.roman);
    if (!roman) return '';
    if (/^N/.test(roman)) return 'sesta napoletana';
    const aug = roman.match(/^(It|Fr|Ger)/);
    if (aug) return ({ It: 'sesta eccedente italiana', Fr: 'sesta eccedente francese', Ger: 'sesta eccedente tedesca' })[aug[1] as 'It' | 'Fr' | 'Ger'];
    const [numRaw, denRaw] = roman.split('/');
    const gm = normalizeRoman(numRaw).match(/^(b|#)?(vii|VII|iii|III|iv|IV|vi|VI|ii|II|i|I|v|V)([o+]*)(\d*)$/);
    if (!gm) return roman.replace(/\//g, ' ');
    const alter = gm[1] || '';
    const deg = ROMAN_DEG[gm[2].toLowerCase()];
    const dim = gm[3].includes('o');
    const augQ = gm[3].includes('+');
    const figs = input.figures || [];
    const inv = figs.length ? inversionFigure(figs) : gm[4];
    let phrase = phraseForDegree(deg, inv, dim, augQ, alter);
    if (denRaw) {
        const dm = normalizeRoman(denRaw).match(/(vii|VII|iii|III|iv|IV|vi|VI|ii|II|i|I|v|V)/);
        if (dm) phrase += ' ' + FUNC_IT[ROMAN_DEG[dm[1].toLowerCase()]];
    }
    return phrase;
}
