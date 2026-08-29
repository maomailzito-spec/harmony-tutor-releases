/**
 * IL GENERATORE RISPETTA UNA VOCE INTERNA DATA?
 *
 * Le si passa la voce d'autore (contralto o tenore) e si conta quante delle sue note
 * ricompaiono identiche nel risultato. `DA_INTERNA=1` sceglie l'armonia dalla voce interna
 * stessa, che è il caso d'uso vero; senza, armonizza dal soprano e la voce interna fa da
 * secondo vincolo — i due litigano, e si vede.
 *
 *   VOCE=2|3  DA_INTERNA=1  npx tsx scripts/prova-voce-interna.ts tests/*.htp
 */
import { readFileSync } from 'fs';
import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';
import { tonicaReale } from '../src/utils/relativeMinors';
import { autoHarmonize, realizeChorale, type SopranoConstraint, type ChoralConfig } from '../src/engine/choralRealization';
let tot=0, rispettate=0, brani=0, errTot=0;
const VOCE = Number(process.env.VOCE ?? 2);
for (const f of process.argv.slice(2)) {
  let d:any; try { d = JSON.parse(readFileSync(f,'utf8')); } catch { continue; }
  const note = (d.notes||[]).filter((n:any)=>!n.isRest);
  const minore = !!d.isMinorMode;
  const tonica = tonicaReale(d.keySignatureRoot||'C', minore);
  const ts = d.timeSignature||{numerator:4,denominator:4};
  const bpm = ts.numerator*(4/ts.denominator);
  const ord = (a:any,b:any)=>(a.measureIndex-b.measureIndex)||(a.beat-b.beat);
  const sop = note.filter((n:any)=>Number(n.voice)===1).sort(ord);
  const interna = note.filter((n:any)=>Number(n.voice)===VOCE).sort(ord);
  if (sop.length < 8 || interna.length < 8) continue;
  const vinc = (l:any[]):SopranoConstraint[] => l.map((n:any)=>({midi:n.midi, measure:n.measureIndex??0, beat:n.beat??1}));
  // DA_INTERNA=1: l'armonia si sceglie dalla voce interna stessa, che e' il caso d'uso vero.
  const daInterna = process.env.DA_INTERNA === '1';
  const linea = daInterna ? interna : sop;
  let prog:any[]; try { prog = autoHarmonize(vinc(linea), tonica, minore, 0, bpm, {corpus:true,condotta:true,frase:true} as any); } catch { continue; }
  const cfg: ChoralConfig = { tonic:tonica, isMinor:minore, timeSignature:ts,
    rules:{allowParallel5ths:false,allowParallel8ves:false,allowCrossing:false,allowOverlap:false,doubleRoot:true},
    autoSevenths:true, ...(daInterna ? {} : { sopranoMelody: vinc(sop) }),
    ...(process.env.SENZA_VINCOLO==='1' ? {} : { lockedVoices: { [VOCE]: vinc(interna) } }) } as any;
  let gen:any; try { gen = realizeChorale(prog, cfg); } catch { continue; }
  brani++;
  const dato = new Map(interna.map((n:any)=>[`${n.measureIndex}:${n.beat}`, n.midi]));
  for (const n of (gen.notes||[]).filter((x:any)=>!x.isRest && Number(x.voice)===VOCE)) {
    const atteso = dato.get(`${n.measureIndex}:${n.beat}`);
    if (atteso == null) continue;
    tot++; if (Number(n.midi) === atteso) rispettate++;
  }
  try {
    const ks = getKeySignature(tonica, minore?'Minor':'Major');
    const r:any = applyHarmonyRules((gen.notes||[]).filter((x:any)=>!x.isRest) as any, ks as any, tonica, minore, [], ts, [], [], [], {partCount:4});
    errTot += (r.violations||[]).filter((v:any)=>v.severity==='error').length;
  } catch {}
}
const NOME = {2:'contralto',3:'tenore'}[VOCE] ?? String(VOCE);
console.log(`${NOME} dato su ${brani} brani:  ${rispettate}/${tot} note rispettate (${(100*rispettate/Math.max(tot,1)).toFixed(1)}%)   ·   ${errTot} errori in tutto`);
