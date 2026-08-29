/**
 * SOPRANO E BASSO DATI INSIEME: l'accordo scelto contiene davvero il basso?
 *
 * Con tutte e due le voci date l'armonia si sceglieva dal solo SOPRANO e il basso veniva
 * imposto dopo, in fase di scrittura: uscivano accordi con un basso che non gli appartiene.
 * `SENZA_BASSO=1` torna a quel comportamento, per il confronto.
 */
import { readFileSync } from 'fs';
import { tonicaReale } from '../src/utils/relativeMinors';
import { autoHarmonize, realizeChorale, type SopranoConstraint, type ChoralConfig } from '../src/engine/choralRealization';
import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';
let tot=0, estranei=0, brani=0, err=0;
const CON = process.env.SENZA_BASSO !== '1';
for (const f of process.argv.slice(2)) {
  let d:any; try { d = JSON.parse(readFileSync(f,'utf8')); } catch { continue; }
  const note=(d.notes||[]).filter((n:any)=>!n.isRest);
  const minore=!!d.isMinorMode, tonica=tonicaReale(d.keySignatureRoot||'C',minore);
  const ts=d.timeSignature||{numerator:4,denominator:4}, bpm=ts.numerator*(4/ts.denominator);
  const ord=(a:any,b:any)=>(a.measureIndex-b.measureIndex)||(a.beat-b.beat);
  const sop=note.filter((n:any)=>Number(n.voice)===1).sort(ord);
  const bas=note.filter((n:any)=>Number(n.voice)===4).sort(ord);
  if (sop.length<8 || bas.length<8) continue;
  const vc=(l:any[]):SopranoConstraint[]=>l.map((n:any)=>({midi:n.midi,measure:n.measureIndex??0,beat:n.beat??1}));
  let prog:any[]; try { prog = autoHarmonize(vc(sop), tonica, minore, 0, bpm,
    CON ? {bassoDato: vc(bas)} as any : undefined); } catch { continue; }
  const cfg: ChoralConfig={tonic:tonica,isMinor:minore,timeSignature:ts,
    rules:{allowParallel5ths:false,allowParallel8ves:false,allowCrossing:false,allowOverlap:false,doubleRoot:true},
    autoSevenths:true, sopranoMelody:vc(sop), bassMelody:vc(bas)} as any;
  let gen:any; try { gen=realizeChorale(prog,cfg); } catch { continue; }
  brani++;
  const generate=(gen.notes||[]).filter((n:any)=>!n.isRest);
  const per=new Map<string,any[]>();
  for(const n of generate){ const k=`${n.measureIndex}:${n.beat}`; if(!per.has(k))per.set(k,[]); per.get(k)!.push(n); }
  for (const g of per.values()) {
    if (g.length!==4) continue;
    const b=g.find((n:any)=>Number(n.voice)===4); if(!b) continue;
    const alte=g.filter((n:any)=>Number(n.voice)!==4).map((n:any)=>((n.midi%12)+12)%12);
    const bpc=((b.midi%12)+12)%12;
    tot++;
    // il basso è estraneo se le tre voci superiori formano una triade che non lo contiene
    const set=new Set(alte);
    if (set.size===3 && !set.has(bpc)) estranei++;
  }
  try { const ks=getKeySignature(tonica,minore?'Minor':'Major');
    const r:any=applyHarmonyRules(generate as any,ks as any,tonica,minore,[],ts,[],[],[],{partCount:4});
    err+=(r.violations||[]).filter((v:any)=>v.severity==='error').length; } catch {}
}
console.log(`${brani} brani, ${tot} accordi:  ${estranei} col BASSO ESTRANEO  ·  ${err} errori`);
