/**
 * STATISTICHE DI PROGRESSIONE, DIVISE PER MODO E CON LA TONICA GIUSTA.
 *
 * Serve al generatore di corali («il corpus propone»). Non tocca
 * `progressionStats.json`, che alimenta il suggeritore di accordi: scrive un file suo.
 *
 * DUE COSE LA DISTINGUONO dall'estrattore che c'era.
 *
 * 1. LA TONICA. Quello passava `keySignatureRoot` tale e quale come tonica dell'analisi, ma
 *    quel campo tiene la fondamentale MAGGIORE relativa: ogni brano in minore del corpus è
 *    stato analizzato nella tonalità sbagliata (un pezzo in Mi minore letto in Sol minore).
 *    Di lì vengono i numeri incongrui del modo minore — la tonica `i` a 41 osservazioni e
 *    una processione di `♭VI`, `♭VII`, `♭III` che sono i gradi di casa scambiati per
 *    alterazioni. Vedi `utils/relativeMinors.ts`.
 *
 * 2. IL MODO. Le statistiche stavano in un mucchio solo, quindi la `V` del maggiore e quella
 *    del minore erano la stessa voce, e in minore il generatore avrebbe visto la dominante
 *    dieci volte più frequente della tonica. Qui i due modi hanno tabelle separate.
 *
 *   npx tsx scripts/estrai-stats-per-modo.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { applyHarmonyRules, getKeySignature, getRomanAnalysis } from '../src/utils/musicTheory';
import { tonicaReale } from '../src/utils/relativeMinors';

const TESTS_DIR = path.join(__dirname, '..', 'tests');
const files = fs.readdirSync(TESTS_DIR)
    .filter(f => f.endsWith('.json') || f.endsWith('.htp'))
    .map(f => path.join(TESTS_DIR, f));

type Mappa = Record<string, Record<string, number>>;
type PerModo = {
    unigrammi: Record<string, number>;
    bigrammi: Mappa;
    /** Gli stessi conti separati per FORZA DEL MOVIMENTO su cui l'accordo cade.
     *
     *  Serve a distinguere due cose che i bigrammi da soli non distinguono: un V sul tempo
     *  debole che spinge la conclusione sul forte, e un V sul tempo forte che è una cadenza
     *  sospesa. È lo stesso accordo dopo lo stesso accordo, e sono due gesti diversi.
     *  `forte` = battere e (nei metri pari) movimento di mezzo; `debole` = il resto. */
    unigrammiForte: Record<string, number>;
    unigrammiDebole: Record<string, number>;
    bigrammiForte: Mappa;
    bigrammiDebole: Mappa;
    /** QUALE NOTA DELL'ACCORDO SI RADDOPPIA, per rivolto.
     *
     *  `raddoppi[rivolto][membro] = quante volte`, dove il membro è l'intervallo sopra la
     *  fondamentale: `0` fondamentale, `3` terza, `7` quinta, `10` settima.
     *
     *  Serve al REALIZZATORE, non alla scelta dell'armonia: è una domanda che si pone quando
     *  le quattro note esistono. I raddoppi sbagliati sono il primo addebito rimasto al
     *  generatore, e il corpus la risposta ce l'ha. */
    raddoppi: Record<string, Record<string, number>>;
    raddoppiTonali: Record<string, Record<string, number>>;
    /** LE CHIUSURE DI FRASE, distinte per posizione nel PERIODO.
     *
     *  La gerarchia è quella di scuola: inciso ≈ una battuta, semifrase due, frase quattro,
     *  periodo otto o sedici. Il periodo si divide in ANTECEDENTE — la frase che propone — e
     *  CONSEGUENTE, la frase che risponde e conclude. Sono due gesti diversi e chiudono
     *  diversamente: nel corpus l'antecedente chiude sul V il 29% delle volte contro il 14%
     *  sul I (è la cadenza sospesa), il conseguente il contrario, 24% sul I contro il 17%.
     *
     *  Il generatore non aveva nessuna nozione di frase, quindi «cadenza sospesa» non era
     *  nemmeno esprimibile: un V a fine semifrase era un V come un altro. */
    chiusure: { antecedente: Record<string, number>; conseguente: Record<string, number> };
    /** Le stesse chiusure per POSIZIONE NEL BRANO — prima frase, frasi interne, ultima.
     *
     *  È l'asse che dice dove sta un gesto nella FORMA, e il corpus lo separa nettamente: la
     *  prima frase chiude sulla dominante il 40% delle volte (è l'apertura sospesa), l'ultima
     *  sulla tonica il 36%, e i gradi di deviazione — `III`, `VI`, `♭VII` — chiudono SOLO
     *  frasi interne, mai l'ultima: zero volte su 55. Ciò che nega una chiusura ha bisogno di
     *  un seguito, e nell'ultima frase il seguito non c'è. */
    chiusurePosizione: { prima: Record<string, number>; interna: Record<string, number>; ultima: Record<string, number> };
    /** LE VOCI ESTREME. Soprano e basso tracciano la via; quel che sta in mezzo è colore.
     *  Il corpus le ha scritte e non le avevamo mai guardate.
     *
     *  `intervalliEstremi[forza][semitoni]` = con che intervallo si presentano soprano e
     *  basso (in semitoni, ridotto all'ottava);
     *  `motoEstremi[tipo]` = come si muovono l'uno rispetto all'altro fra un accordo e il
     *  successivo — contrario, obliquo, retto. */
    intervalliEstremi: Record<string, Record<string, number>>;
    motoEstremi: Record<string, number>;
    /** `rivolti[grado][cifra] = quante volte`. Risponde a «se metto un ii, che basso ci va»:
     *  il corpus dice che il ii sta in primo rivolto il doppio delle volte del I, e che il
     *  vii° in posizione fondamentale è raro. Prima quel giudizio era una mia costante. */
    rivolti: Mappa;
    brani: number; transizioni: number;
};
const vuoto = (): PerModo => ({ unigrammi: {}, bigrammi: {}, unigrammiForte: {}, unigrammiDebole: {}, bigrammiForte: {}, bigrammiDebole: {}, intervalliEstremi: { forte: {}, debole: {} }, motoEstremi: {}, chiusure: { antecedente: {}, conseguente: {} }, chiusurePosizione: { prima: {}, interna: {}, ultima: {} }, raddoppi: {}, raddoppiTonali: {}, rivolti: {}, brani: 0, transizioni: 0 });
const modi: Record<'major' | 'minor', PerModo> = { major: vuoto(), minor: vuoto() };

/**
 * LA FONDAMENTALE DI UN ACCORDO, dalle sole note.
 *
 * L'analisi restituisce la sigla ma non la fondamentale, e per sapere che RUOLO ha ciascuna
 * voce — se raddoppia la fondamentale, la terza o la quinta — serve quella. Si trova per
 * costruzione: la fondamentale è l'unica nota da cui le altre si impilano per terze.
 */
/** La classe d'altezza di un nome di nota, per il conto dei gradi tonali. */
function noteNameToPcLocale(nome: string): number {
    const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    let pc = base[String(nome)[0]?.toUpperCase()] ?? 0;
    for (const ch of String(nome).slice(1)) { if (ch === '#') pc++; else if (ch === 'b') pc--; }
    return ((pc % 12) + 12) % 12;
}

function fondamentaleDi(pcs: number[]): number | null {
    const insieme = [...new Set(pcs.map(p => ((p % 12) + 12) % 12))];
    if (insieme.length < 3 || insieme.length > 4) return null;
    let migliore: number | null = null, migliorPunteggio = -1;
    for (const r of insieme) {
        const sopra = insieme.map(p => ((p - r) % 12 + 12) % 12);
        if (!sopra.includes(0)) continue;
        const terza = sopra.includes(3) || sopra.includes(4);
        if (!terza) continue;
        // LE QUINTE VANNO IN ORDINE. Accettando l'ottava eccedente alla pari, una triade
        // minore si lascia leggere anche dalla propria terza (Do-Mib-Sol vista da Mib dà
        // 0-4-8) e i conti sui raddoppi escono senza senso. La quinta giusta è la quinta
        // giusta; diminuita e eccedente esistono ma valgono meno.
        const punteggio = sopra.includes(7) ? 3 : sopra.includes(6) ? 2 : sopra.includes(8) ? 1 : 0;
        if (punteggio === 0) continue;
        // E ogni nota dev'essere uno dei gradi della pila.
        if (!sopra.every(x => [0, 3, 4, 6, 7, 8, 10, 11].includes(x))) continue;
        if (punteggio > migliorPunteggio) { migliorPunteggio = punteggio; migliore = r; }
    }
    return migliore;
}

/** Che rivolto è, dal MEMBRO che sta al basso (0 fondamentale, 3/4 terza, 6/7/8 quinta,
 *  10/11 settima). Più diretto che passare dal cifrato scritto. */
function rivoltoDaMembro(membroAlBasso: number): number {
    if (membroAlBasso === 3 || membroAlBasso === 4) return 1;
    if (membroAlBasso === 6 || membroAlBasso === 7 || membroAlBasso === 8) return 2;
    if (membroAlBasso === 10 || membroAlBasso === 11) return 3;
    return 0;
}

/** Via il cifrato dal grado: `V65` → `V`, `vii°6` → `vii°`, `V/vi6` → `V/vi`. */
function senzaCifre(label: string): string {
    return String(label || '').replace(/[0-9]+$/, '').replace(/\/([^/]*?)[0-9]+$/, '/$1').trim();
}

let letti = 0, saltati = 0;
for (const f of files) {
    let proj: any;
    try { proj = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { saltati++; continue; }
    const notes = (proj.notes || []).filter((n: any) => n && !n.isRest);
    if (notes.length < 8) { saltati++; continue; }
    const radice = String(proj.keySignatureRoot || 'C');
    const isMinor = Boolean(proj.isMinorMode);
    // LA TONICA VERA, non la radice d'armatura.
    const tonica = tonicaReale(radice, isMinor);
    const ts = proj.timeSignature || { numerator: 4, denominator: 4 };
    try {
        const keySig = getKeySignature(tonica, isMinor ? 'Minor' : 'Major');
        const res: any = applyHarmonyRules(
            notes as any, keySig as any, tonica, isMinor,
            proj.analysisContexts || [], ts as any, undefined, proj.ornamentOverrides || [],
        );
        const analizzate: any[] = res?.analyzedNotes || notes;

        // Le note si raggruppano per movimento; la sigla la dà `getRomanAnalysis` sul gruppo,
        // non è un campo che le note portino addosso.
        const perMovimento = new Map<string, any[]>();
        for (const n of analizzate) {
            if (!n || n.isRest) continue;
            (perMovimento.get(`${n.measureIndex}:${n.beat}`) ?? perMovimento.set(`${n.measureIndex}:${n.beat}`, []).get(`${n.measureIndex}:${n.beat}`)!).push(n);
        }
        const denom = Number(ts.denominator || 4);
        const movPerBattuta = Number(ts.numerator || 4) * (4 / denom);
        const chiavi = [...perMovimento.keys()].sort((a, b) => {
            const [am, ab] = a.split(':').map(Number), [bm, bb] = b.split(':').map(Number);
            return am !== bm ? am - bm : ab - bb;
        });

        const m0 = modi[isMinor ? 'minor' : 'major'];
        const tonicaPc = ((noteNameToPcLocale(tonica) % 12) + 12) % 12;
        const seq: string[] = [];
        const conCifre: { grado: string; cifra: string }[] = [];
        const forze: boolean[] = [];
        const estremi: ({ s: number; b: number; forte: boolean } | null)[] = [];
        const battute: number[] = [];
        let ultimoAssoluto = -Infinity;
        for (const k of chiavi) {
            const [mi, bt] = k.split(':').map(Number);
            // Solo movimenti INTERI, e non più fitti di uno: le suddivisioni portano note di
            // passaggio e rivolti fantasma, che come statistica sono rumore.
            if (Math.abs(bt - Math.round(bt)) > 0.01) continue;
            const bRound = Math.round(bt);
            const forzaQui = bRound === 1 || (movPerBattuta % 2 === 0 && bRound === movPerBattuta / 2 + 1);
            const assoluto = mi * movPerBattuta + bt;
            if (assoluto - ultimoAssoluto < 0.99) continue;
            const strutturali = perMovimento.get(k)!.filter((n: any) =>
                !n.isPassing && !n.isNeighbor && !n.isAppoggiatura && !n.isAnticipation && !n.isEscape && !n.isSuspension);
            if (strutturali.length < 2) continue;
            ultimoAssoluto = assoluto;
            // ── I RADDOPPI ──
            // Serve la fondamentale dell'accordo per sapere che ruolo ha ciascuna nota.
            {
                const quattro = strutturali.filter((x: any) => x.voice >= 1 && x.voice <= 4);
                const radicePc = quattro.length === 4 ? fondamentaleDi(quattro.map((x: any) => Number(x.midi))) : null;
                if (radicePc != null) {
                    const bassa = quattro.reduce((a: any, b: any) => (Number(a.midi) <= Number(b.midi) ? a : b));
                    const rv = String(rivoltoDaMembro(((Number(bassa.midi) - radicePc) % 12 + 12) % 12));
                    const conto: Record<number, number> = {};
                    for (const x of quattro) {
                        const mm = ((Number(x.midi) - radicePc) % 12 + 12) % 12;
                        conto[mm] = (conto[mm] || 0) + 1;
                    }
                    const doppio = Object.entries(conto).find(([, v]) => v >= 2);
                    if (doppio) {
                        (m0.raddoppi[rv] ||= {})[doppio[0]] = (m0.raddoppi[rv][doppio[0]] || 0) + 1;
                        // È un GRADO TONALE della tonalità (I, IV, V)? Il raddoppio della
                        // terza è ammesso quando la nota raddoppiata è uno di quelli — il ii
                        // può raddoppiare la propria terza perché è il quarto grado.
                        const pcDoppia = (radicePc + Number(doppio[0])) % 12;
                        const gradoDaTonica = ((pcDoppia - tonicaPc) % 12 + 12) % 12;
                        const tonale = gradoDaTonica === 0 || gradoDaTonica === 5 || gradoDaTonica === 7;
                        const chiave = `${doppio[0]}|${tonale ? 'tonale' : 'modale'}`;
                        (m0.raddoppiTonali[rv] ||= {})[chiave] = (m0.raddoppiTonali[rv][chiave] || 0) + 1;
                    }
                }
            }
            // Le voci estreme dell'accordo, quando ci sono tutt'e due.
            const conVoce = perMovimento.get(k)!.filter((x: any) => x.voice >= 1 && x.voice <= 4);
            const sop = conVoce.find((x: any) => x.voice === 1);
            const bas = conVoce.find((x: any) => x.voice === 4);
            estremi.push(sop && bas ? { s: Number(sop.midi), b: Number(bas.midi), forte: forzaQui } : null);
            try {
                const r = getRomanAnalysis(strutturali as any, tonica, isMinor);
                if (r && r.roman && r.roman !== '?') {
                    seq.push(senzaCifre(r.roman));
                    // Il CIFRATO, che dice quale nota sta al basso.
                    const cifra = (r.figures || []).join('') || '5';
                    conCifre.push({ grado: senzaCifre(r.roman), cifra });
                    // Forte: il battere, e nei metri pari anche il movimento di mezzo.
                    forze.push(forzaQui);
                    battute.push(mi);
                }
            } catch { /* accordo illeggibile: si salta */ }
        }
        // Ripetizioni consecutive dello stesso grado: non sono progressione.
        const puliti = seq.filter((r, i2) => i2 === 0 || r !== seq[i2 - 1]);
        if (puliti.length < 3) { saltati++; continue; }

        const m = modi[isMinor ? 'minor' : 'major'];
        m.brani++;
        for (const r of puliti) m.unigrammi[r] = (m.unigrammi[r] || 0) + 1;
        // I conti per forza del movimento si fanno sulla sequenza NON ripulita, perché lì
        // ogni accordo ha ancora il suo posto nella battuta.
        for (let k = 0; k < seq.length; k++) {
            const dove = forze[k] ? m.unigrammiForte : m.unigrammiDebole;
            dove[seq[k]] = (dove[seq[k]] || 0) + 1;
            if (k === 0 || seq[k] === seq[k - 1]) continue;
            const mappa = forze[k] ? m.bigrammiForte : m.bigrammiDebole;
            (mappa[seq[k - 1]] ||= {})[seq[k]] = (mappa[seq[k - 1]][seq[k]] || 0) + 1;
        }
        for (const c of conCifre) (m.rivolti[c.grado] ||= {})[c.cifra] = (m.rivolti[c.grado][c.cifra] || 0) + 1;
        // ── LE CHIUSURE DI FRASE ──
        // Segmentazione sulla griglia: frase = quattro battute, e le frasi si alternano
        // antecedente / conseguente dentro il periodo. È una griglia regolare e non tutti i
        // brani la seguono, ma il segnale c'è ed è netto.
        const ultimaBattuta = Math.max(...battute, 0);
        const quanteFrasi = Math.floor((ultimaBattuta + 1) / 4);
        for (let fr = 0; fr < quanteFrasi; fr++) {
            let ultimo = -1;
            for (let k = 0; k < seq.length; k++) {
                if (battute[k] >= fr * 4 && battute[k] < (fr + 1) * 4) ultimo = k;
            }
            if (ultimo < 0) continue;
            // SI CONTA DALLA FINE. L'ultima frase è quella che conclude, quindi è sempre
            // conseguente; risalendo si alternano. Contando da CAPO invece si sbaglia
            // sistematicamente — un'anacrusi, un'apertura irregolare, e l'assegnazione
            // slitta di uno: provato, dava il segnale ROVESCIATO.
            const dallaFine = quanteFrasi - 1 - fr;
            const dove = dallaFine % 2 === 0 ? m.chiusure.conseguente : m.chiusure.antecedente;
            dove[seq[ultimo]] = (dove[seq[ultimo]] || 0) + 1;
            // E per posizione nella forma: prima frase, interne, ultima.
            const p = fr === 0 ? m.chiusurePosizione.prima
                : fr === quanteFrasi - 1 ? m.chiusurePosizione.ultima
                : m.chiusurePosizione.interna;
            p[seq[ultimo]] = (p[seq[ultimo]] || 0) + 1;
        }

        // ── LE VOCI ESTREME ──
        for (let k = 0; k < estremi.length; k++) {
            const e = estremi[k];
            if (!e) continue;
            const iv = ((e.s - e.b) % 12 + 12) % 12;
            const dove = m.intervalliEstremi[e.forte ? 'forte' : 'debole'];
            dove[String(iv)] = (dove[String(iv)] || 0) + 1;
            const p = k > 0 ? estremi[k - 1] : null;
            if (!p) continue;
            const ds = Math.sign(e.s - p.s), db = Math.sign(e.b - p.b);
            const tipo = (ds === 0 || db === 0) ? 'obliquo' : (ds === db ? 'retto' : 'contrario');
            m.motoEstremi[tipo] = (m.motoEstremi[tipo] || 0) + 1;
        }
        for (let i = 1; i < puliti.length; i++) {
            const da = puliti[i - 1], a = puliti[i];
            (m.bigrammi[da] ||= {})[a] = (m.bigrammi[da][a] || 0) + 1;
            m.transizioni++;
        }
        letti++;
    } catch { saltati++; }
}

const out = {
    meta: {
        estrattoIl: new Date().toISOString(),
        braniLetti: letti,
        braniSaltati: saltati,
        nota: 'Tonica corretta (relativa minore) e tabelle separate per modo. Vedi la testata dello script.',
    },
    major: modi.major,
    minor: modi.minor,
};
const outPath = path.join(__dirname, '..', 'src', 'data', 'progressionStatsByMode.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`letti ${letti}, saltati ${saltati}`);
for (const k of ['major', 'minor'] as const) {
    const m = modi[k];
    const top = Object.entries(m.unigrammi).sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log(`\n${k}: ${m.brani} brani, ${m.transizioni} transizioni`);
    console.log('  ' + top.map(([g, c]) => `${g}:${c}`).join('  '));
}
console.log(`\nscritto in ${outPath}`);
