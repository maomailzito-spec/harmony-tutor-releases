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
 */
import { readFileSync } from 'fs';
import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';
import { autoHarmonize, realizeChorale, contiVeto, azzeraContiVeto, type SopranoConstraint, type ChoralConfig } from '../src/engine/choralRealization';

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
const RELATIVE_MINORI: Record<string, string> = {
  'C': 'A', 'G': 'E', 'D': 'B', 'A': 'F#', 'E': 'C#', 'B': 'G#', 'F#': 'D#', 'C#': 'A#',
  'F': 'D', 'Bb': 'G', 'Eb': 'C', 'Ab': 'F', 'Db': 'Bb', 'Gb': 'Eb', 'Cb': 'Ab',
};

type Esito = { errori: number; avvisi: number; perRegola: Record<string, number>; dettaglio: string[] };

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

let totOrig = 0, totGen = 0;
for (const f of process.argv.slice(2)) {
  const d = JSON.parse(readFileSync(f, 'utf8'));
  const note = (d.notes || []).filter((n: any) => !n.isRest);
  const radice = d.keySignatureRoot || 'C';
  const minore = !!d.isMinorMode;
  // La tonica VERA: in minore e' la relativa minore di cio' che il file chiama radice.
  const tonica = minore ? (RELATIVE_MINORI[radice] || radice) : radice;
  const ts = d.timeSignature || { numerator: 4, denominator: 4 };
  const bpm = ts.numerator * (4 / ts.denominator);

  const soprano = note.filter((n: any) => (n.voice ?? 1) === 1)
    .sort((a: any, b: any) => (a.measureIndex - b.measureIndex) || (a.beat - b.beat));
  const vincoli: SopranoConstraint[] = soprano.map((n: any) => ({
    midi: n.midi, measure: n.measureIndex ?? 0, beat: n.beat ?? 1,
  }));

  const progressione = autoHarmonize(vincoli, tonica, minore, 0, bpm);
  const config: ChoralConfig = {
    tonic: tonica, isMinor: minore, timeSignature: ts,
    rules: { allowParallel5ths: false, allowParallel8ves: false, allowCrossing: false, allowOverlap: false, doubleRoot: true },
    autoSevenths: true, sopranoMelody: vincoli,
    // SENZA_VETO=1 spegne il veto delle regole: serve al confronto prima/dopo, che va fatto
    // cambiando un interruttore e non l'albero di lavoro.
    vetoRegole: !process.env.SENZA_VETO,
  } as any;
  azzeraContiVeto();
  const generato = realizeChorale(progressione, config);
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
  console.log(`   veto: ${vetoDelBrano.controllati} controlli, ${vetoDelBrano.fermati} respinti` +
    (vetoDelBrano.fermati ? ` → ${vetoDelBrano.risolti} risolti, ${vetoDelBrano.migliorati} attenuati` +
      `  [${Object.entries(vetoDelBrano.perRegola).map(([r, n2]) => `${r}×${n2}`).join(' ')}]` : ''));
  if (process.env.DETTAGLIO) for (const r of b.dettaglio) console.log('      ' + r);
}
console.log(`\n${'═'.repeat(74)}`);
console.log(`TOTALE   originali: ${totOrig} errori   ·   generatore: ${totGen} errori`);
