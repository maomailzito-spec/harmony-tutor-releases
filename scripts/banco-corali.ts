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
import { autoHarmonize, realizeChorale, type SopranoConstraint, type ChoralConfig } from '../src/engine/choralRealization';

const V: Record<number, string> = { 1: 'S', 2: 'A', 3: 'T', 4: 'B' };

type Esito = { errori: number; avvisi: number; perRegola: Record<string, number>; dettaglio: string[] };

function controlla(note: any[], radice: string, minore: boolean, ts: any): Esito {
  const ks = getKeySignature(radice, minore ? 'Minor' : 'Major');
  const res: any = applyHarmonyRules(note as any, ks as any, radice, minore, [], ts, [], [], [], { partCount: 4 });
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
  const ts = d.timeSignature || { numerator: 4, denominator: 4 };
  const bpm = ts.numerator * (4 / ts.denominator);

  const soprano = note.filter((n: any) => (n.voice ?? 1) === 1)
    .sort((a: any, b: any) => (a.measureIndex - b.measureIndex) || (a.beat - b.beat));
  const vincoli: SopranoConstraint[] = soprano.map((n: any) => ({
    midi: n.midi, measure: n.measureIndex ?? 0, beat: n.beat ?? 1,
  }));

  const progressione = autoHarmonize(vincoli, radice, minore, 0, bpm);
  const config: ChoralConfig = {
    tonic: radice, isMinor: minore, timeSignature: ts,
    rules: { allowParallel5ths: false, allowParallel8ves: false, allowCrossing: false, allowOverlap: false, doubleRoot: true },
    autoSevenths: true, sopranoMelody: vincoli,
  } as any;
  const generato = realizeChorale(progressione, config);
  const noteGen = (generato.notes || []).filter((n: any) => !n.isRest);

  const a = controlla(note, radice, minore, ts);
  const b = controlla(noteGen, radice, minore, ts);
  totOrig += a.errori; totGen += b.errori;

  console.log(`\n${'─'.repeat(74)}`);
  console.log(`${f.split('/').pop()}   ·   ${soprano.length} note di melodia, ${progressione.length} accordi`);
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
  if (process.env.DETTAGLIO) for (const r of b.dettaglio) console.log('      ' + r);
}
console.log(`\n${'═'.repeat(74)}`);
console.log(`TOTALE   originali: ${totOrig} errori   ·   generatore: ${totGen} errori`);
