/**
 * QUANTE ECCEZIONI SI PRENDE IL GENERATORE, e quali — contro gli autori.
 *
 * Osservazione dell'utente: «usa le eccezioni alle regole in modo improprio, le
 * sfrutta per trovare vie di uscita. Le eccezioni servirebbero per fare delle
 * cose MIGLIORI che altrimenti le regole non permetterebbero; lui invece fa
 * delle cose peggiori grazie alle eccezioni».
 *
 * Misurato su nove brani (`DAL_BASSO=1` per l'altro mestiere):
 *
 *     autori      289 eccezioni su 2516 note   114,9‰
 *     generatore  328 su 2460                  133,3‰
 *
 * Il totale dice poco; la ripartizione dice tutto. Si appoggia a poche
 * eccezioni molto piu' degli autori e IGNORA quelle che loro usano:
 *
 *     EXC-7-TRANSFERRED-RES    autori 14   generatore 58   ← 4×
 *     EXC-7m01                          4              18
 *     EXC-Hidden-Stepwise             102             179
 *     EXC-S02                          46               0   ← mai usata
 *     EXC-Unison-Step                  41               6
 *
 *   npx tsx scripts/quante-eccezioni-usa.ts <file.htp> [altri…]
 */
import { readFileSync } from 'fs';
import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';
import { autoHarmonize, autoHarmonizeFromBass, realizeChorale, type SopranoConstraint, type ChoralConfig } from '../src/engine/choralRealization';
const REL: Record<string,string> = {C:'A',G:'E',D:'B',A:'F#',E:'C#',B:'G#','F#':'D#',F:'D',Bb:'G',Eb:'C',Ab:'F',Db:'Bb',Gb:'Eb'};
const conta=(vs:any[])=>{const o:Record<string,number>={}; for(const v of vs) if(/^EXC/.test(String(v.ruleId))) o[v.ruleId]=(o[v.ruleId]||0)+1; return o;};
const somma=(o:Record<string,number>)=>Object.values(o).reduce((a,b)=>a+b,0);
const A:Record<string,number>={}, G:Record<string,number>={};
let nA=0,nG=0;
for (const f of process.argv.slice(2)) {
  const d=JSON.parse(readFileSync(f,'utf8'));
  const minore=!!d.isMinorMode, radice=d.keySignatureRoot||'C';
  const tonica=minore?(REL[radice]||radice):radice;
  const ts=d.timeSignature||{numerator:4,denominator:4}; const bpm=ts.numerator*(4/ts.denominator);
  const orig:any=applyHarmonyRules(d.notes,getKeySignature(radice,'Major') as any,tonica,minore,
    d.analysisContexts||[],ts,undefined,undefined,undefined);
  for(const [k,v] of Object.entries(conta(orig.violations||[]))) A[k]=(A[k]||0)+v;
  nA += d.notes.filter((n:any)=>!n.isRest).length;
  const daBasso=!!process.env.DAL_BASSO;
  const voce=daBasso?4:1;
  const linea=d.notes.filter((n:any)=>n&&!n.isRest&&(n.voice??1)===voce)
    .sort((a:any,b:any)=>(a.measureIndex-b.measureIndex)||(a.beat-b.beat));
  const v:SopranoConstraint[]=linea.map((n:any)=>({midi:n.midi,measure:n.measureIndex??0,beat:n.beat??1}));
  const prog=daBasso?autoHarmonizeFromBass(v,tonica,minore,0,bpm):autoHarmonize(v,tonica,minore,0,bpm);
  const res=realizeChorale(prog,{tonic:tonica,isMinor:minore,timeSignature:ts as any,
    rules:{allowParallel5ths:false,allowParallel8ves:false,allowCrossing:false,allowOverlap:false,doubleRoot:true},
    autoSevenths:true, ...(daBasso?{bassMelody:v}:{sopranoMelody:v})} as ChoralConfig);
  const gen:any=applyHarmonyRules(res.notes as any,getKeySignature(radice,'Major') as any,tonica,minore,
    [],ts as any,undefined,undefined,undefined);
  for(const [k,v2] of Object.entries(conta(gen.violations||[]))) G[k]=(G[k]||0)+v2;
  nG += (res.notes as any[]).filter(n=>!n.isRest).length;
}
const pc=(a:number,b:number)=>(1000*a/b).toFixed(1);
console.log(`\nECCEZIONI USATE  (per mille note)\n`);
console.log(`   autori     ${String(somma(A)).padStart(4)} su ${nA} note   ${pc(somma(A),nA)}‰`);
console.log(`   generatore ${String(somma(G)).padStart(4)} su ${nG} note   ${pc(somma(G),nG)}‰\n`);
const tutte=[...new Set([...Object.keys(A),...Object.keys(G)])].sort((x,y)=>(G[y]||0)-(G[x]||0));
console.log('   quale                          autori   generatore');
for(const k of tutte) console.log(`   ${k.padEnd(30)} ${String(A[k]||0).padStart(5)} ${String(G[k]||0).padStart(11)}`);
console.log('');
