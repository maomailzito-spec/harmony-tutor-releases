/**
 * BANCO DI PROVA DEL GENERATORE DI CORALI.
 *
 * Prende brani a quattro voci già scritti — armonizzazioni d'autore, come gli esercizi
 * del Dubois — ne estrae il SOPRANO, lo fa armonizzare al generatore, e conta gli errori
 * che il checker dell'applicazione trova nei due risultati.
 *
 * Il confronto ha senso perché il metro è perfetto: stessa melodia, stessa tonalità,
 * stesso checker. L'originale d'autore è lo zero da raggiungere, e ogni modifica al
 * generatore si misura invece di valutarla a occhio su un esempio.
 *
 * Il checker è `applyHarmonyRules`, lo stesso che gira nell'editor: se dice che va bene
 * qui, l'utente non vedrà segnalazioni sullo schermo.
 *
 *   npx tsx scripts/banco-corali.ts  "<file.htp>"  [altri.htp …]
 *
 * DAL_BASSO=1 armonizza il BASSO invece del soprano — che nella didattica
 * e' il caso principale (il basso dato viene prima del canto dato) ed e' anche
 * il meno ambiguo: sapendo il grado del basso la prima scelta vale il 57,3%
 * contro il 43,1% della melodia.
 */
import { readFileSync } from 'fs';
import { applyHarmonyRules, getActiveNotesTimeline, getKeySignature, getRomanAnalysis } from '../src/utils/musicTheory';
import { autoHarmonize, autoHarmonizeFromBass, realizeChorale, contiVeto, azzeraContiVeto, type SopranoConstraint, type ChoralConfig } from '../src/engine/choralRealization';
import { bonusTransizione } from '../src/engine/corpusProgressione';

/**
 * LA PIATTEZZA NON HA UN CODICE DI REGOLA.
 *
 * Il conto delle violazioni dice se il generatore SBAGLIA, non se fa musica. Un'armonizzazione
 * puo' essere a zero errori e suonare morta — l'utente l'ha sentito su una melodia del
 * Delachi: quinto grado ribattuto per quattro battute e due retrocessioni `V → ii`, tutto
 * regolare e tutto inerte. Senza una misura, ogni scelta fra «meno errori» e «meno piatto» si
 * fa a occhio.
 *
 * Tre numeri, sulla PROGRESSIONE scelta (non sulle note):
 *
 *   altalena       due accordi che si scambiano il posto quattro volte (`V–I–V–I`): ogni
 *                  passaggio e' idiomatico e l'insieme e' morto;
 *   retrocessioni  passaggi che il corpus fa MENO del solito (`V → ii`, `V → IV`): il conto
 *                  e' quello centrato di `bonusTransizione`, negativo = controcorrente;
 *   vocabolario    quanti gradi diversi si usano in tutto il brano.
 */
function piattezza(prog: any[], minore: boolean): { altalena: number; retro: number; vocabolario: number } {
  const grado = (r: string) => r.replace(/[0-9]+$/, '');
  const g = prog.map(c => grado(String(c.roman)));
  let altalena = 0;
  for (let i = 3; i < g.length; i++) if (g[i] === g[i - 2] && g[i - 1] === g[i - 3]) altalena++;
  const IDX: Record<string, number> = minore
    ? { i: 0, 'ii°': 1, iio: 1, III: 2, iv: 3, V: 4, v: 4, VI: 5, VII: 6 }
    : { I: 0, ii: 1, iii: 2, IV: 3, V: 4, vi: 5, 'vii°': 6, viio: 6 };
  let retro = 0;
  for (let i = 1; i < g.length; i++) {
    const a = IDX[g[i - 1]], b = IDX[g[i]];
    if (a == null || b == null || a === b) continue;
    if (bonusTransizione(minore, a, b) < -0.2) retro++;
  }
  return { altalena, retro, vocabolario: new Set(g).size };
}

const V: Record<number, string> = { 1: 'S', 2: 'A', 3: 'T', 4: 'B' };

/**
 * IL CAMPO `keySignatureRoot` NON E' LA TONICA.
 *
 * Nei file dell'applicazione quel campo tiene sempre la fondamentale MAGGIORE relativa: un
 * brano in Mi minore lo scrive 'G' con `isMinorMode`. Il banco lo passava tale e quale al
 * generatore, che quindi armonizzava un corale in Mi minore credendolo in Sol minore.
 *
 * Non e' un dettaglio di forma: su «Corale 17 Schinelli» il soprano aveva 31 note su 74
 * fuori dalla tonalita' (tutti i Mi e i Si naturali, che in Mi minore sono di casa), e il
 * generatore le armonizzava con accordi di Sol minore. Ne uscivano 58 errori e trentuno
 * scontri cromatici che il generatore non aveva nessuna colpa di aver scritto.
 */
/** Dalla tonica minore alla radice MAGGIORE relativa: serve all'armatura, che
 *  `getKeySignature` vuole sempre in maggiore. */
const RELATIVE_MAGGIORI: Record<string, string> = {
  A: 'C', E: 'G', B: 'D', 'F#': 'A', 'C#': 'E', 'G#': 'B', 'D#': 'F#',
  D: 'F', G: 'Bb', C: 'Eb', F: 'Ab', Bb: 'Db', Eb: 'Gb',
};

const RELATIVE_MINORI: Record<string, string> = {
  'C': 'A', 'G': 'E', 'D': 'B', 'A': 'F#', 'E': 'C#', 'B': 'G#', 'F#': 'D#', 'C#': 'A#',
  'F': 'D', 'Bb': 'G', 'Eb': 'C', 'Ab': 'F', 'Db': 'Bb', 'Gb': 'Eb', 'Cb': 'Ab',
};

type Esito = { errori: number; avvisi: number; perRegola: Record<string, number>; dettaglio: string[] };

/**
 * LA PROGRESSIONE COM'E' SCRITTA DALL'AUTORE.
 *
 * Senza, «altalene» e «retrocessioni» sono numeri senza termine di paragone:
 * 55 altalene e' tanto, o e' quanto ne fa Bach? Si e' scoperto misurandolo che
 * il generatore altalena CINQUE VOLTE piu' degli autori ma retrocede MENO —
 * cioe' uno dei due numeri andava spinto giu' e l'altro no, e a occhio si
 * sarebbe curato quello sbagliato.
 */
function progressioneDAutore(note: any[], tonica: string, minore: boolean, ts: any,
                             cambiMetro: any[], contesti: any[],
                             ornamenti: any[] | undefined, armonie: any[] | undefined): string[] {
  try {
    const res: any = applyHarmonyRules(
      note, getKeySignature(minore ? RELATIVE_MAGGIORI[tonica] || tonica : tonica, 'Major') as any,
      tonica, minore, contesti || [], ts, undefined, ornamenti, armonie,
    );
    const linea = getActiveNotesTimeline(res.analyzedNotes || note, ts, cambiMetro || []);
    const strutturale = (x: any) => x && !x.isRest
      && !x.isPassing && !x.isNeighbor && !x.isAnticipation && !x.isAppoggiatura && !x.isEscape;
    const gradi: string[] = [];
    let prec = '';
    for (const ev of (linea || [])) {
      const st = (ev.notes as any[]).filter(strutturale);
      if (st.length < 2) continue;
      const ra = getRomanAnalysis(st as any, tonica, minore);
      if (!ra?.roman) continue;
      const g = String(ra.roman).replace(/\s+/g, '').replace(/[0-9]+$/, '');
      if (g && g !== prec) { gradi.push(g); prec = g; }
    }
    return gradi;
  } catch { return []; }
}

function controlla(note: any[], tonica: string, minore: boolean, ts: any): Esito {
  const ks = getKeySignature(tonica, minore ? 'Minor' : 'Major');
  const res: any = applyHarmonyRules(note as any, ks as any, tonica, minore, [], ts, [], [], [], { partCount: 4 });
  const perId = new Map(note.map((n: any) => [n.id, n]));
  const esito: Esito = { errori: 0, avvisi: 0, perRegola: {}, dettaglio: [] };
  for (const v of (res.violations || []) as any[]) {
    if (v.severity !== 'error' && v.severity !== 'warning') continue;
    if (v.severity === 'error') esito.errori++; else esito.avvisi++;
    esito.perRegola[v.ruleId] = (esito.perRegola[v.ruleId] || 0) + 1;
    const ns = (v.noteIds || []).map((i: string) => perId.get(i)).filter(Boolean) as any[];
    const dove = ns.map(n => `b${(n.measureIndex ?? 0) + 1}.${n.beat} ${V[n.voice] || '?'}`).join(' ');
    esito.dettaglio.push(`${v.severity === 'error' ? 'ERR ' : 'avv '} ${String(v.ruleId).padEnd(12)} ${dove}  ${String(v.message || '').slice(0, 60)}`);
  }
  return esito;
}

let totOrig = 0, totGen = 0, totAlt = 0, totRetro = 0;
let totAltA = 0, totRetroA = 0, totAccG = 0, totAccA = 0;
for (const f of process.argv.slice(2)) {
  const d = JSON.parse(readFileSync(f, 'utf8'));
  const note = (d.notes || []).filter((n: any) => !n.isRest);
  const radice = d.keySignatureRoot || 'C';
  const minore = !!d.isMinorMode;
  // La tonica VERA: in minore e' la relativa minore di cio' che il file chiama radice.
  const tonica = minore ? (RELATIVE_MINORI[radice] || radice) : radice;
  const ts = d.timeSignature || { numerator: 4, denominator: 4 };
  const bpm = ts.numerator * (4 / ts.denominator);

  // DAL_BASSO=1: si tiene il BASSO e si fa scrivere il resto. E' l'esercizio
  // del basso dato, che nella didattica viene prima del canto dato.
  const voceTenuta = process.env.DAL_BASSO ? 4 : 1;
  const soprano = note.filter((n: any) => (n.voice ?? 1) === voceTenuta)
    .sort((a: any, b: any) => (a.measureIndex - b.measureIndex) || (a.beat - b.beat));
  const vincoli: SopranoConstraint[] = soprano.map((n: any) => ({
    midi: n.midi, measure: n.measureIndex ?? 0, beat: n.beat ?? 1,
  }));

  // SENZA_CORPUS=1 torna ai pesi scritti a mano nella scelta dei gradi.
  // RITMO=<movimenti> per armonizzare a ritmo armonico scelto invece che una
  // nota = un accordo. Serve a misurare la scrittura elastica: col valore 0 il
  // generatore deve reggere OGNI nota, e le note di passaggio non esistono.
  const ritmo = Number(process.env.RITMO || 0) || 0;
  const progressione = process.env.DAL_BASSO
    ? autoHarmonizeFromBass(vincoli, tonica, minore, ritmo, bpm)
    : autoHarmonize(vincoli, tonica, minore, ritmo, bpm, { corpus: !process.env.SENZA_CORPUS, condotta: !process.env.SENZA_CONDOTTA, frase: !process.env.SENZA_FRASE });
  const config: ChoralConfig = {
    tonic: tonica, isMinor: minore, timeSignature: ts,
    rules: { allowParallel5ths: false, allowParallel8ves: false, allowCrossing: false, allowOverlap: false, doubleRoot: true },
    autoSevenths: true,
    ...(process.env.DAL_BASSO ? { bassMelody: vincoli } : { sopranoMelody: vincoli }),
    // SENZA_VETO=1 spegne il veto delle regole: serve al confronto prima/dopo, che va fatto
    // cambiando un interruttore e non l'albero di lavoro.
    vetoRegole: !process.env.SENZA_VETO,
    passoIndietro: !process.env.SENZA_PASSO,
    ripasso: !process.env.SENZA_RIPASSO,
  } as any;
  azzeraContiVeto();
  const generato = realizeChorale(progressione, config);
  const p = piattezza(progressione, minore);
  totAlt += p.altalena; totRetro += p.retro;
  // Lo stesso metro sulla progressione D'AUTORE: e' il paragone che mancava.
  const gradiAutore = progressioneDAutore(note, tonica, minore, ts,
    d.timeSignatureChanges || [], d.analysisContexts || [],
    (d.ornamentOverrides || []).length ? d.ornamentOverrides : undefined,
    (d.harmonyOverrides || []).length ? d.harmonyOverrides : undefined);
  const pa = piattezza(gradiAutore.map(g => ({ roman: g })) as any, minore);
  totAltA += pa.altalena; totRetroA += pa.retro;
  totAccG += progressione.length; totAccA += gradiAutore.length;
  const vetoDelBrano = { ...contiVeto, perRegola: { ...contiVeto.perRegola } };
  const noteGen = (generato.notes || []).filter((n: any) => !n.isRest);

  const a = controlla(note, tonica, minore, ts);
  const b = controlla(noteGen, tonica, minore, ts);
  totOrig += a.errori; totGen += b.errori;

  console.log(`\n${'─'.repeat(74)}`);
  console.log(`${f.split('/').pop()}   ·   ${soprano.length} note di melodia, ${progressione.length} accordi  [${tonica}${minore ? ' min' : ' Mag'}]`);
  console.log(`   originale d'autore :  ${String(a.errori).padStart(3)} errori   ${String(a.avvisi).padStart(3)} avvisi`);
  console.log(`   generatore         :  ${String(b.errori).padStart(3)} errori   ${String(b.avvisi).padStart(3)} avvisi`);
  // CIO' CHE SBAGLIA SOLO LUI. Molti brani veri non sono esercizi di scuola: hanno note
  // estranee che il checker segnala anche nell'originale, quindi il totale grezzo non dice
  // niente. Il confronto per REGOLA invece si', anche su materiale «sporco»: se una regola
  // l'originale non la viola mai e il generatore la viola cento volte, quello e' un difetto
  // del generatore, non del brano.
  const solo = Object.entries(b.perRegola)
    .map(([r, n2]) => [r, n2 - (a.perRegola[r] || 0)] as [string, number])
    .filter(([, d]) => d > 0).sort((x, y) => y[1] - x[1]);
  if (solo.length) console.log('   in piu\' rispetto all\'originale: ' + solo.map(([r, n2]) => `${r}+${n2}`).join('  '));
  // Il veto ha lavorato? E' una domanda diversa da «il risultato e' migliore»: se i conti
  // sono a zero il problema non e' la severita' del checker, e' che non lo stiamo chiamando.
  console.log(`   condotta: ${p.altalena} altalene, ${p.retro} retrocessioni, ${p.vocabolario} gradi diversi`
            + `   (l'autore: ${pa.altalena} / ${pa.retro} / ${pa.vocabolario} su ${gradiAutore.length} accordi)`);
  console.log(`   veto: ${vetoDelBrano.controllati} controlli, ${vetoDelBrano.fermati} respinti` +
    (vetoDelBrano.fermati ? ` → ${vetoDelBrano.risolti} risolti, ${vetoDelBrano.migliorati} attenuati` +
      `${vetoDelBrano.passiIndietro ? `, ${vetoDelBrano.passiIndietro} passi indietro` : ''}` +
      `${vetoDelBrano.ripassati ? `, ${vetoDelBrano.ripassati} ridisposti` : ''}` +
      `  [${Object.entries(vetoDelBrano.perRegola).map(([r, n2]) => `${r}×${n2}`).join(' ')}]` : ''));
  if (process.env.DETTAGLIO) for (const r of b.dettaglio) console.log('      ' + r);
}
console.log(`\n${'═'.repeat(74)}`);
console.log(`TOTALE   originali: ${totOrig} errori   ·   generatore: ${totGen} errori`);
const perc = (a: number, b: number) => b ? (100 * a / b).toFixed(1) + '%' : '—';
console.log(`CONDOTTA                accordi   altalene           retrocessioni`);
console.log(`  generatore     ${String(totAccG).padStart(11)}   ${(totAlt + ' (' + perc(totAlt, totAccG) + ')').padEnd(18)} ${totRetroA >= 0 ? (totRetro + ' (' + perc(totRetro, totAccG) + ')') : ''}`);
console.log(`  autori         ${String(totAccA).padStart(11)}   ${(totAltA + ' (' + perc(totAltA, totAccA) + ')').padEnd(18)} ${totRetroA + ' (' + perc(totRetroA, totAccA) + ')'}`);
