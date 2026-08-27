/**
 * IL COMPITO DELL'ALLIEVO ACCANTO A QUELLO DEL MAESTRO.
 *
 * Prende un'armonizzazione d'autore, ne estrae il soprano, la fa rifare al generatore, e
 * mette le due progressioni una sotto l'altra movimento per movimento.
 *
 * Serve a vedere ciò che il conto delle violazioni non dice: le «interpretazioni dubbie» —
 * il grado scelto male su una nota che ne chiedeva un altro, la settima messa dove bastava la
 * triade, il rivolto che non ha ragione d'essere. Sono cose che non violano nessuna regola e
 * che un insegnante segna comunque.
 *
 *   npx tsx scripts/confronta-con-autore.ts "tests/Dubois n1 p76.htp"
 */
import { readFileSync } from 'fs';
import { applyHarmonyRules, getKeySignature, getRomanAnalysis } from '../src/utils/musicTheory';
import { tonicaReale } from '../src/utils/relativeMinors';
import { autoHarmonize, realizeChorale, type SopranoConstraint, type ChoralConfig } from '../src/engine/choralRealization';

const NOMI = ['Do','Do#','Re','Mib','Mi','Fa','Fa#','Sol','Sol#','La','Sib','Si'];
const f = process.argv[2];
const d = JSON.parse(readFileSync(f, 'utf8'));
const note = (d.notes || []).filter((n: any) => !n.isRest);
const minore = !!d.isMinorMode;
const tonica = tonicaReale(d.keySignatureRoot || 'C', minore);
const ts = d.timeSignature || { numerator: 4, denominator: 4 };
const ks = getKeySignature(tonica, minore ? 'Minor' : 'Major');

/** Le sigle di un'armonizzazione, per «battuta.movimento». */
function sigle(notes: any[]): Map<string, string> {
  const res: any = applyHarmonyRules(notes as any, ks as any, tonica, minore, [], ts, [], [], [], { partCount: 4 });
  const an: any[] = res.analyzedNotes || notes;
  const per = new Map<string, any[]>();
  for (const n of an) { if (n.isRest) continue; const k = `${n.measureIndex}:${n.beat}`; (per.get(k) ?? per.set(k, []).get(k)!).push(n); }
  const fuori = new Map<string, string>();
  for (const [k, g] of per) {
    try {
      const r = getRomanAnalysis(g.filter((x: any) => !x.isPassing && !x.isNeighbor && !x.isAppoggiatura) as any, tonica, minore);
      if (r?.roman && r.roman !== '?') fuori.set(k, r.roman + (r.figures || []).join(''));
    } catch { /* */ }
  }
  return fuori;
}

const sop = note.filter((n: any) => (n.voice ?? 1) === 1).sort((a: any, b: any) => (a.measureIndex - b.measureIndex) || (a.beat - b.beat));
const vincoli: SopranoConstraint[] = sop.map((n: any) => ({ midi: n.midi, measure: n.measureIndex ?? 0, beat: n.beat ?? 1 }));
const prog = autoHarmonize(vincoli, tonica, minore, 0, ts.numerator * (4 / ts.denominator));
const gen = realizeChorale(prog, { tonic: tonica, isMinor: minore, timeSignature: ts,
  rules: { allowParallel5ths: false, allowParallel8ves: false, allowCrossing: false, allowOverlap: false, doubleRoot: true },
  autoSevenths: true, sopranoMelody: vincoli } as ChoralConfig);
const noteGen = (gen.notes || []).filter((n: any) => !n.isRest);

const dellAutore = sigle(note);
const delGeneratore = sigle(noteGen);
// il basso, per vedere la linea
const bassoDi = (notes: any[]) => {
  const m = new Map<string, number>();
  for (const n of notes) if ((n.voice ?? 0) === 4) m.set(`${n.measureIndex}:${n.beat}`, n.midi);
  return m;
};
const bA = bassoDi(note), bG = bassoDi(noteGen);

console.log(`${f.split('/').pop()}  [${tonica}${minore ? ' min' : ' Mag'}]\n`);
console.log(`${'dove'.padEnd(8)}${'soprano'.padEnd(9)}${'AUTORE'.padEnd(11)}${'basso'.padEnd(7)}${'GENERATORE'.padEnd(13)}${'basso'.padEnd(7)}`);
let diverse = 0;
for (const s of sop) {
  const k = `${s.measureIndex}:${s.beat}`;
  const a = dellAutore.get(k) ?? '·', g = delGeneratore.get(k) ?? '·';
  const na = bA.get(k), ng = bG.get(k);
  const uguale = a.replace(/[0-9]+$/, '') === g.replace(/[0-9]+$/, '');
  if (!uguale) diverse++;
  console.log(`b${String((s.measureIndex ?? 0) + 1).padStart(2)}.${s.beat}   ${NOMI[s.midi % 12].padEnd(9)}${a.padEnd(11)}${(na != null ? NOMI[na % 12] : '').padEnd(7)}${g.padEnd(13)}${(ng != null ? NOMI[ng % 12] : '').padEnd(7)}${uguale ? '' : '  ≠'}`);
}
console.log(`\n${diverse} accordi su ${sop.length} scelti diversamente dall'autore (${Math.round(100 * diverse / sop.length)}%)`);
