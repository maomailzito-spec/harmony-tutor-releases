/** Quali gradi sceglie il generatore, rispetto a quelli che scelgono gli autori. */
import { readFileSync } from 'fs';
import { applyHarmonyRules, getKeySignature, getRomanAnalysis } from '../src/utils/musicTheory';
import { tonicaReale } from '../src/utils/relativeMinors';
import { autoHarmonize, realizeChorale, type SopranoConstraint, type ChoralConfig } from '../src/engine/choralRealization';
const senza = (l: string) => String(l||'').replace(/[0-9]+$/,'').replace(/\/([^/]*?)[0-9]+$/,'/$1').replace(/[♯♭♮]+$/,'').trim();
const A: Record<string, number> = {}, G: Record<string, number> = {};
for (const f of process.argv.slice(2)) {
  const d = JSON.parse(readFileSync(f, 'utf8'));
  const note = (d.notes || []).filter((n: any) => !n.isRest);
  const minore = !!d.isMinorMode;
  const tonica = tonicaReale(d.keySignatureRoot || 'C', minore);
  const ts = d.timeSignature || { numerator: 4, denominator: 4 };
  const ks = getKeySignature(tonica, minore ? 'Minor' : 'Major');
  const sigle = (notes: any[], dove: Record<string, number>) => {
    try {
      const res: any = applyHarmonyRules(notes as any, ks as any, tonica, minore, [], ts, [], [], [], { partCount: 4 });
      const an: any[] = res.analyzedNotes || notes;
      const per = new Map<string, any[]>();
      for (const n of an) { if (n.isRest) continue; const k = `${n.measureIndex}:${n.beat}`; (per.get(k) ?? per.set(k, []).get(k)!).push(n); }
      for (const g of per.values()) {
        const r = getRomanAnalysis(g.filter((x: any) => !x.isPassing && !x.isNeighbor) as any, tonica, minore);
        if (r?.roman && r.roman !== '?') { const s = senza(r.roman); dove[s] = (dove[s] || 0) + 1; }
      }
    } catch { /* */ }
  };
  sigle(note, A);
  const sop = note.filter((n: any) => (n.voice ?? 1) === 1).sort((a: any, b: any) => (a.measureIndex - b.measureIndex) || (a.beat - b.beat));
  const v: SopranoConstraint[] = sop.map((n: any) => ({ midi: n.midi, measure: n.measureIndex ?? 0, beat: n.beat ?? 1 }));
  try {
    const prog = autoHarmonize(v, tonica, minore, 0, ts.numerator * (4 / ts.denominator));
    const gen = realizeChorale(prog, { tonic: tonica, isMinor: minore, timeSignature: ts,
      rules: { allowParallel5ths: false, allowParallel8ves: false, allowCrossing: false, allowOverlap: false, doubleRoot: true },
      autoSevenths: true, sopranoMelody: v } as ChoralConfig);
    sigle((gen.notes || []).filter((n: any) => !n.isRest), G);
  } catch { /* */ }
}
const ta = Object.values(A).reduce((a, b) => a + b, 0), tg = Object.values(G).reduce((a, b) => a + b, 0);
const tutti = [...new Set([...Object.keys(A), ...Object.keys(G)])]
  .sort((x, y) => (G[y] || 0) / tg - (A[y] || 0) / ta - ((G[x] || 0) / tg - (A[x] || 0) / ta));
console.log(`${'grado'.padEnd(10)}${'autori'.padStart(9)}${'generatore'.padStart(12)}${'scarto'.padStart(9)}`);
for (const k of tutti) {
  const a = 100 * (A[k] || 0) / ta, g = 100 * (G[k] || 0) / tg;
  if (Math.max(a, g) < 1.5) continue;
  console.log(`${k.padEnd(10)}${a.toFixed(1).padStart(8)}%${g.toFixed(1).padStart(11)}%${(g - a >= 0 ? '+' : '') + (g - a).toFixed(1).padStart(8)}`);
}
