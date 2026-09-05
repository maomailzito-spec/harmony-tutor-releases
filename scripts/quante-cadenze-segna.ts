/**
 * QUANTE CADENZE SEGNA IL MOTORE, e ogni quante battute.
 *
 * Verifica chiesta dall'utente: «il V→VI ha sempre carattere d'inganno, ma la
 * CADENZA d'inganno e' quel movimento in posizione CONCLUSIVA. Un V→VI che
 * prosegue con VII→I non e' una cadenza: la frase sta continuando».
 *
 * Il difetto c'e', e la causa e' in una riga: `isCadenceBoundary` chiede
 * soltanto che l'accordo d'arrivo sia il BATTERE DELLA MISURA SUCCESSIVA. Non
 * guarda corone, pause, valori lunghi, fine di frase — niente. Quindi si segna
 * una cadenza a ogni stanghetta dove la coppia combacia.
 *
 * MISURATO su 251 brani d'autore: 924 cadenze su 2842 battute, una ogni 3,1.
 * `CAD-DEC` da sola 145 volte, per una figura che dovrebbe essere occasionale.
 *
 * E il controesempio dell'utente si riproduce esattamente: su `I | V | vi |
 * vii° | I`, dove la frase prosegue e chiude sul vii°→I, il motore segna TRE
 * cadenze — `CAD-DEC`, `CAD-HC`, `CAD-IAC`.
 *
 *   npx tsx scripts/quante-cadenze-segna.ts
 */
import { readFileSync, readdirSync } from 'fs';
import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';
const REL: Record<string,string> = {C:'A',G:'E',D:'B',A:'F#',E:'C#',B:'G#','F#':'D#',F:'D',Bb:'G',Eb:'C',Ab:'F',Db:'Bb',Gb:'Eb'};
const DAUT=/dubois|pedron|delachi|delamont|schinelli|bach|cantata|corale/i;
const per: Record<string,number>={}; let brani=0, battute=0, tot=0;
for (const f of readdirSync('tests').sort()) {
  if(!DAUT.test(f)||!/\.(htp|json)$/.test(f)) continue;
  let d:any; try{d=JSON.parse(readFileSync('tests/'+f,'utf8'))}catch{continue}
  if(!Array.isArray(d.notes)||d.notes.length<8) continue;
  const minore=!!d.isMinorMode, radice=d.keySignatureRoot||'C';
  const tonica=minore?(REL[radice]||radice):radice;
  let res:any; try{ res=applyHarmonyRules(d.notes,getKeySignature(radice,'Major') as any,tonica,minore,
    d.analysisContexts||[],d.timeSignature||{numerator:4,denominator:4},undefined,undefined,undefined);}catch{continue}
  brani++;
  battute += 1 + d.notes.reduce((m:number,n:any)=>Math.max(m,n.measureIndex??0),0);
  for(const v of (res.violations||[])) if(/^CAD-/.test(String(v.ruleId))) { per[v.ruleId]=(per[v.ruleId]||0)+1; tot++; }
}
console.log(`\n${brani} brani · ${battute} battute · ${tot} cadenze segnate`);
console.log(`   una cadenza ogni ${(battute/tot).toFixed(1)} battute\n`);
for(const [k,v] of Object.entries(per).sort((a,b)=>b[1]-a[1])) console.log(`   ${k.padEnd(12)} ${String(v).padStart(5)}`);
console.log('');
