/**
 * IL RISULTATO COME LO VEDE L'UTENTE.
 *
 * Non basta contare quante note della voce data vengono rispettate: quello che finisce sul
 * rigo è il generato PIÙ la voce data reincollata sopra (è cosa fa `handleApply`). Se il
 * motore ha scelto l'armonia ignorando quella voce, la reincollatura produce incroci e
 * accordi incompleti — ed è esattamente il difetto che l'utente ha visto.
 *
 * Sui 73 brani del banco, contralto dato:
 *     SENZA il vincolo   337 incroci · 859 accordi incompleti · 1440 errori
 *     COL vincolo          6 incroci · 198 accordi incompleti ·  307 errori
 *
 *   VOCE=2|3  [SENZA=1]  npx tsx scripts/prova-voce-interna-risultato.ts tests/*.htp
 */
import { readFileSync } from 'fs';
import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';
import { tonicaReale } from '../src/utils/relativeMinors';
import { autoHarmonize, realizeChorale, type SopranoConstraint, type ChoralConfig } from '../src/engine/choralRealization';
const VOCE = Number(process.env.VOCE ?? 2);
let incroci=0, accordi=0, brani=0, err=0, raddoppi=0;
for (const f of process.argv.slice(2)) {
  let d:any; try { d = JSON.parse(readFileSync(f,'utf8')); } catch { continue; }
  const note = (d.notes||[]).filter((n:any)=>!n.isRest);
  const minore = !!d.isMinorMode;
  const tonica = tonicaReale(d.keySignatureRoot||'C', minore);
  const ts = d.timeSignature||{numerator:4,denominator:4};
  const bpm = ts.numerator*(4/ts.denominator);
  const ord=(a:any,b:any)=>(a.measureIndex-b.measureIndex)||(a.beat-b.beat);
  const interna = note.filter((n:any)=>Number(n.voice)===VOCE).sort(ord);
  if (interna.length < 8) continue;
  const vinc:SopranoConstraint[] = interna.map((n:any)=>({midi:n.midi, measure:n.measureIndex??0, beat:n.beat??1}));
  let prog:any[]; try { prog = autoHarmonize(vinc, tonica, minore, 0, bpm, {corpus:true,condotta:true,frase:true} as any); } catch { continue; }
  const cfg: ChoralConfig = { tonic:tonica, isMinor:minore, timeSignature:ts,
    rules:{allowParallel5ths:false,allowParallel8ves:false,allowCrossing:false,allowOverlap:false,doubleRoot:true},
    autoSevenths:true, ...(process.env.SENZA==='1'?{}:{ lockedVoices:{ [VOCE]: vinc } }) } as any;
  let gen:any; try { gen = realizeChorale(prog, cfg); } catch { continue; }
  brani++;
  // COME FA handleApply: le note generate della voce data si buttano, si rimettono le originali.
  const generate = (gen.notes||[]).filter((n:any)=>!n.isRest);
  const finale = [...interna, ...generate.filter((n:any)=>Number(n.voice)!==VOCE)];
  const per = new Map<string,any[]>();
  for (const n of finale) { const k=`${n.measureIndex}:${n.beat}`; if(!per.has(k)) per.set(k,[]); per.get(k)!.push(n); }
  for (const g of per.values()) {
    if (g.length !== 4) continue;
    accordi++;
    const m:Record<number,number> = {}; for (const n of g) m[Number(n.voice)] = Number(n.midi);
    if (m[1] < m[2] || m[2] < m[3] || m[3] < m[4]) incroci++;
    const pcs = g.map((n:any)=>((n.midi%12)+12)%12);
    if (new Set(pcs).size < 3) raddoppi++;   // accordo incompleto = un raddoppio di troppo
  }
  try {
    const ks = getKeySignature(tonica, minore?'Minor':'Major');
    const r:any = applyHarmonyRules(finale as any, ks as any, tonica, minore, [], ts, [], [], [], {partCount:4});
    err += (r.violations||[]).filter((v:any)=>v.severity==='error').length;
  } catch {}
}
const N = {2:'contralto',3:'tenore'}[VOCE] ?? String(VOCE);
console.log(`${N.padEnd(10)} ${brani} brani, ${accordi} accordi:  ${incroci} INCROCI  ·  ${raddoppi} accordi incompleti  ·  ${err} errori`);
