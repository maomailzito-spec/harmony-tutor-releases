/**
 * COM'È FATTA UN'ARMONIZZAZIONE — accordo per accordo, col moto delle voci estreme.
 *
 * Il banco (`banco-corali.ts`) conta le violazioni e non sa dire se la musica è buona.
 * Questo invece mostra ciò che si ascolta: le sigle, le quattro voci, e per ogni passaggio
 * se soprano e basso vanno per moto contrario, retto o obliquo — segnalando i punti in cui
 * il BASSO STA FERMO mentre il soprano si muove, che è il difetto che l'utente ha sentito
 * per primo («va bene in certi casi ma è una soluzione usata troppo spesso»).
 *
 *   npx tsx scripts/mostra-armonizzazione.ts <file.htp>            l'originale
 *   npx tsx scripts/mostra-armonizzazione.ts <file.htp> genera     il generatore sulla sua melodia
 *   npx tsx scripts/mostra-armonizzazione.ts <file.htp> genera rip  + cosa rifà il veto
 */
import { readFileSync } from 'fs';
import { applyHarmonyRules, getKeySignature, getRomanAnalysis } from '../src/utils/musicTheory';
import { tonicaReale } from '../src/utils/relativeMinors';
const NOMI = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const V: Record<number, string> = { 1: 'S', 2: 'A', 3: 'T', 4: 'B' };
import { autoHarmonize, realizeChorale, type SopranoConstraint, type ChoralConfig } from '../src/engine/choralRealization';
const d = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let note = (d.notes || []).filter((n: any) => !n.isRest);
const minore = !!d.isMinorMode;
const tonica = tonicaReale(d.keySignatureRoot || 'C', minore);
const ts = d.timeSignature || { numerator: 4, denominator: 4 };
const ks = getKeySignature(tonica, minore ? 'Minor' : 'Major');
if (process.argv[4]) (globalThis as any).__HT_RIP = 1;
if (process.argv[3] === 'genera') {
  const sop = note.filter((n: any) => (n.voice ?? 1) === 1).sort((a: any, b: any) => (a.measureIndex - b.measureIndex) || (a.beat - b.beat));
  const vincoli: SopranoConstraint[] = sop.map((n: any) => ({ midi: n.midi, measure: n.measureIndex ?? 0, beat: n.beat ?? 1 }));
  const prog = autoHarmonize(vincoli, tonica, minore, 0, ts.numerator * (4 / ts.denominator));
  const gen = realizeChorale(prog, { tonic: tonica, isMinor: minore, timeSignature: ts,
    rules: { allowParallel5ths: false, allowParallel8ves: false, allowCrossing: false, allowOverlap: false, doubleRoot: true },
    autoSevenths: true, sopranoMelody: vincoli } as ChoralConfig);
  note = (gen.notes || []).filter((n: any) => !n.isRest);
}
const res: any = applyHarmonyRules(note as any, ks as any, tonica, minore, [], ts, [], [], [], { partCount: 4 });
const an: any[] = res.analyzedNotes || note;
const per = new Map<string, any[]>();
for (const n of an) { if (n.isRest) continue; const k = `${n.measureIndex}:${n.beat}`; (per.get(k) ?? per.set(k, []).get(k)!).push(n); }
const chiavi = [...per.keys()].sort((a, b) => { const [am,ab]=a.split(':').map(Number),[bm,bb]=b.split(':').map(Number); return am!==bm?am-bm:ab-bb; });
console.log(`${process.argv[2].split('/').pop()}  [${tonica}${minore?' min':' Mag'}]\n`);
let bassoPrima: number | null = null, sopPrima: number | null = null;
for (const k of chiavi) {
  const [mi, bt] = k.split(':').map(Number);
  const g = per.get(k)!;
  let et = '?';
  try { const r = getRomanAnalysis(g.filter((n:any)=>!n.isPassing&&!n.isNeighbor) as any, tonica, minore); if (r?.roman) et = r.roman + (r.figures||[]).join(''); } catch {}
  const s = g.find((n:any)=>n.voice===1), b = g.find((n:any)=>n.voice===4);
  const moto = (s && b && sopPrima!=null && bassoPrima!=null)
    ? (Math.sign(s.midi-sopPrima)===0||Math.sign(b.midi-bassoPrima)===0 ? 'obliquo'
      : Math.sign(s.midi-sopPrima)===Math.sign(b.midi-bassoPrima) ? 'retto' : 'CONTRARIO') : '';
  const bassoFermo = (b && bassoPrima!=null && b.midi===bassoPrima && s && sopPrima!=null && s.midi!==sopPrima) ? '  ← basso FERMO' : '';
  const voci = g.sort((a:any,c:any)=>c.voice-a.voice).map((n:any)=>`${V[n.voice]}=${NOMI[n.midi%12]}`).join(' ');
  console.log(`b${String(mi+1).padStart(2)}.${bt}  ${et.padEnd(8)} ${voci.padEnd(30)} ${moto.padEnd(10)}${bassoFermo}`);
  if (s) sopPrima = s.midi; if (b) bassoPrima = b.midi;
}
const v = (res.violations||[]).filter((x:any)=>x.severity==='error'||x.severity==='warning');
console.log(`\n${v.filter((x:any)=>x.severity==='error').length} errori, ${v.filter((x:any)=>x.severity==='warning').length} avvisi`);
