/**
 * CHE COSA C'È NEL CORPUS.
 *
 * Il corpus è la cartella `tests/`: da lì escono le statistiche che guidano il generatore
 * (`estrai-stats-per-modo.ts`) e i brani su cui lo si misura (`banco-corali.ts`). Sapere che
 * cosa contiene non è curiosità: una statistica costruita per un terzo su file sintetici —
 * «Modulazione C → X», esercizi enarmonici — insegna cose che non sono stile.
 */
import * as fs from 'fs';
import * as path from 'path';
import { tonicaReale } from '../src/utils/relativeMinors';

const TESTS = path.join(__dirname, '..', 'tests');
type Voce = { nome: string; fonte: string; note: number; voci: number; battute: number; tonalita: string; quattroVoci: boolean };

const fonteDi = (n: string): string =>
  /delamont/i.test(n) ? 'Delamont'
  : /delachi/i.test(n) ? 'Delachi'
  : /dubois|dubuois|duboi/i.test(n) ? 'Dubois'
  : /pedron/i.test(n) ? 'Pedron'
  : /schinelli/i.test(n) ? 'Schinelli'
  : /bach|cantata|corale/i.test(n) ? 'Bach e corali'
  : /piston/i.test(n) ? 'Piston'
  : /modulazione|progressione|progr|ritardo|rit[ .]|volta|appoggiat|ornament|passing|passapp|anticip|enarmoni|diminuiti|sesta|seste|cromatic|modal change|dominante secondaria|note estranee|tonicizz|raddoppi|accordi|quinte di mozart|prova|test|demo|esempio/i.test(n) ? 'esercizi sintetici'
  : 'altro';

const voci: Voce[] = [];
for (const f of fs.readdirSync(TESTS).filter(x => x.endsWith('.htp') || x.endsWith('.json'))) {
  let d: any; try { d = JSON.parse(fs.readFileSync(path.join(TESTS, f), 'utf8')); } catch { continue; }
  const note = (d.notes || []).filter((n: any) => !n.isRest);
  if (!note.length) continue;
  const insieme = new Set(note.map((n: any) => n.voice ?? 1));
  const minore = !!d.isMinorMode;
  voci.push({
    nome: f.replace(/\.(htp|json)$/, ''),
    fonte: fonteDi(f),
    note: note.length,
    voci: insieme.size,
    battute: Math.max(...note.map((n: any) => n.measureIndex ?? 0)) + 1,
    tonalita: `${tonicaReale(d.keySignatureRoot || 'C', minore)} ${minore ? 'min' : 'Mag'}`,
    quattroVoci: [1, 2, 3, 4].every(v => insieme.has(v)),
  });
}

if (process.argv[2] === 'json') { console.log(JSON.stringify(voci, null, 1)); } else {
  const perFonte = new Map<string, Voce[]>();
  for (const v of voci) { if (!perFonte.has(v.fonte)) perFonte.set(v.fonte, []); perFonte.get(v.fonte)!.push(v); }
  const ordine = [...perFonte.entries()].sort((a, b) => b[1].length - a[1].length);
  console.log(`${voci.length} brani in tests/\n`);
  for (const [fonte, elenco] of ordine) {
    const q = elenco.filter(v => v.quattroVoci).length;
    const min = elenco.filter(v => v.tonalita.includes('min')).length;
    console.log(`${fonte.padEnd(20)} ${String(elenco.length).padStart(3)} brani   ${String(q).padStart(3)} a quattro voci   ${String(min).padStart(3)} in minore`);
  }
  console.log();
  for (const [fonte, elenco] of ordine) {
    console.log(`\n── ${fonte.toUpperCase()} (${elenco.length}) ──`);
    for (const v of elenco.sort((a, b) => a.nome.localeCompare(b.nome, 'it'))) {
      console.log(`  ${v.nome.slice(0, 40).padEnd(40)} ${v.tonalita.padEnd(8)} ${String(v.battute).padStart(3)} batt  ${v.quattroVoci ? '4 voci' : `${v.voci} voc${v.voci === 1 ? 'e' : 'i'}`}`);
    }
  }
}
