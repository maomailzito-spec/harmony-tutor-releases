/**
 * QUANTO UNA VOCE DETERMINA L'ARMONIA.
 *
 * Armonizza a partire da ciascuna delle quattro voci e conta quante volte ritrova il grado
 * scritto dall'autore. Serviva a decidere se «armonizza da una voce interna» avesse senso:
 * la risposta è che una voce vale l'altra (soprano 36,1%, contralto 37,3%, tenore 36,2%,
 * basso 38,1%), perché una classe d'altezza sta in tre triadi diatoniche chiunque la canti.
 * Il basso è più determinante solo perché fissa anche il RIVOLTO, e lì c'è
 * `autoHarmonizeFromBass`.
 */
import { readFileSync } from 'fs';
import { applyHarmonyRules, getKeySignature, getRomanAnalysis } from '../src/utils/musicTheory';
import { tonicaReale } from '../src/utils/relativeMinors';
import { autoHarmonize, type SopranoConstraint } from '../src/engine/choralRealization';
const senza = (l:string) => String(l||'').replace(/[0-9]+$/,'').replace(/\/([^/]*?)[0-9]+$/,'/$1').replace(/[♯♭♮]+$/,'').trim();
const conta: Record<string,{tot:number; uguali:number}> = {};
for (const f of process.argv.slice(2)) {
  let d:any; try { d = JSON.parse(readFileSync(f,'utf8')); } catch { continue; }
  const note = (d.notes||[]).filter((n:any)=>!n.isRest);
  if (note.length < 16) continue;
  const minore = !!d.isMinorMode;
  const tonica = tonicaReale(d.keySignatureRoot||'C', minore);
  const ts = d.timeSignature||{numerator:4,denominator:4};
  const bpm = ts.numerator*(4/ts.denominator);
  const ks = getKeySignature(tonica, minore?'Minor':'Major');
  // IL METRO: il grado che ha scritto l'autore, accordo per accordo.
  const vero = new Map<string,string>();
  try {
    const res:any = applyHarmonyRules(note as any, ks as any, tonica, minore, [], ts, [], [], [], {partCount:4});
    const an:any[] = res.analyzedNotes || note;
    const per = new Map<string,any[]>();
    for (const n of an) { if (n.isRest) continue; const k=`${n.measureIndex}:${n.beat}`; if(!per.has(k)) per.set(k,[]); per.get(k)!.push(n); }
    for (const [k,g] of per) {
      const r = getRomanAnalysis(g.filter((x:any)=>!x.isPassing && !x.isNeighbor) as any, tonica, minore);
      if (r?.roman && r.roman !== '?') vero.set(k, senza(r.roman));
    }
  } catch { continue; }
  if (vero.size < 8) continue;

  for (const [voce, eti] of [[1,'soprano'],[2,'contralto'],[3,'tenore'],[4,'basso']] as [number,string][]) {
    const linea = note.filter((n:any)=>Number(n.voice)===voce)
      .sort((a:any,b:any)=>(a.measureIndex-b.measureIndex)||(a.beat-b.beat));
    if (linea.length < 8) continue;
    const vinc: SopranoConstraint[] = linea.map((n:any)=>({midi:n.midi, measure:n.measureIndex??0, beat:n.beat??1}));
    let prog:any[]; try { prog = autoHarmonize(vinc, tonica, minore, 0, bpm, {corpus:true,condotta:true,frase:true} as any); } catch { continue; }
    if (!conta[eti]) conta[eti] = {tot:0, uguali:0};
    for (const acc of prog) {
      const k = `${acc.measure}:${acc.beat}`;
      const v = vero.get(k); if (!v) continue;
      conta[eti].tot++;
      if (senza(acc.roman) === v) conta[eti].uguali++;
    }
  }
}
console.log('\nquante volte il generatore ritrova il grado scritto dall\'autore,');
console.log('armonizzando a partire da UNA SOLA voce:\n');
for (const eti of ['soprano','contralto','tenore','basso']) {
  const c = conta[eti]; if (!c || !c.tot) continue;
  const pct = (100*c.uguali/c.tot).toFixed(1);
  const barra = '█'.repeat(Math.round(c.uguali/c.tot*40));
  console.log(`  ${eti.padEnd(10)} ${String(pct).padStart(5)}%  ${barra}  (${c.uguali}/${c.tot})`);
}
console.log('\nnota: il basso è sottostimato — qui usa la stessa funzione delle altre,');
console.log('      non `autoHarmonizeFromBass`, che sa anche dedurre il rivolto.');
