/**
 * IL GENERATORE SEGUE LA REGOLA DELL'OTTAVA? (e la risposta e' si', gia' troppo)
 *
 * Gemello di `gli-autori-seguono-la-regola.ts`, e serve a giudicare la regola
 * dell'ottava col METRO GIUSTO. La prima volta l'avevo misurata contando gli
 * ERRORI sul banco e conclusa «non paga» — ma la regola dell'ottava parla di
 * STILE, non di errori, e il banco non e' il giudice di quello. E' la lezione
 * gia' pagata altrove: meno errori non e' piu' musica.
 *
 * Il metro giusto e' l'accordo con la regola. E dice:
 *
 *     gli AUTORI      61%
 *     il GENERATORE   69%
 *
 * Il generatore la segue GIA' PIU' DEL REPERTORIO. Spingerlo oltre lo
 * allontanerebbe da Bach invece di avvicinarlo — ed e' il vero motivo per cui
 * la preferenza costava errori: portava oltre il punto di rendimento, nella
 * rigidita'.
 *
 *   npx tsx scripts/il-generatore-segue-la-regola.ts <file.htp> [altri…]
 */
import { readFileSync } from 'fs';
import { autoHarmonizeFromBass, parseRoman, type SopranoConstraint } from '../src/engine/choralRealization';
import { armonieDellaRegola } from '../src/engine/regolaDellOttava';
const REL: Record<string,string> = {C:'A',G:'E',D:'B',A:'F#',E:'C#',B:'G#','F#':'D#',F:'D',Bb:'G',Eb:'C',Ab:'F',Db:'Bb',Gb:'Eb'};
const PC: Record<string,number> = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
const GRADO: (number|null)[] = [0,null,1,2,2,3,null,4,5,5,6,6];
const pcDi=(s:string)=>{const b=PC[s.charAt(0).toUpperCase()]; if(b==null)return null; let a=0;
  for(const c of s.slice(1)){if(c==='#')a++;else if(c==='b')a--;} return ((b+a)%12+12)%12;};
let esaminati=0, coincide=0;
for (const f of process.argv.slice(2)) {
  const d=JSON.parse(readFileSync(f,'utf8'));
  const minore=!!d.isMinorMode, radice=d.keySignatureRoot||'C';
  const tonica=minore?(REL[radice]||radice):radice;
  const tp=pcDi(tonica); if(tp==null) continue;
  const ts=d.timeSignature||{numerator:4,denominator:4}; const bpm=ts.numerator*(4/ts.denominator);
  const bas=d.notes.filter((n:any)=>n&&!n.isRest&&(n.voice??1)===4).sort((a:any,b:any)=>(a.measureIndex-b.measureIndex)||(a.beat-b.beat));
  const v:SopranoConstraint[]=bas.map((n:any)=>({midi:n.midi,measure:n.measureIndex??0,beat:n.beat??1}));
  const prog=autoHarmonizeFromBass(v,tonica,minore,0,bpm);
  const pc2=(m:number)=>((m%12)+12)%12;
  for(let i=0;i<prog.length;i++){
    const b=v[i]?.midi; if(b==null) continue;
    const g=GRADO[(pc2(b)-tp+12)%12]; if(g==null) continue;
    const passo=(a?:number,b2?:number)=>a==null||b2==null?null:((pc2(b2)-pc2(a)+18)%12)-6;
    const av=passo(b, v[i+1]?.midi), ind=passo(b, v[i-1]?.midi);
    const pg=(x:number|null)=>x!=null&&Math.abs(x)>=1&&Math.abs(x)<=2;
    if(!pg(av)&&!pg(ind)) continue;
    const sale = pg(av) ? (av as number)>0 : (ind as number)<0;
    const attese=armonieDellaRegola(g,sale); if(!attese.length) continue;
    let p:any; try{p=parseRoman(String(prog[i].roman));}catch{continue}
    if(!p||p.secondaryTarget!=null) continue;
    esaminati++;
    if(attese.some(a=>a.grado===p.degree&&a.rivolto===(p.inversion??0))) coincide++;
  }
}
console.log(`il GENERATORE coincide con la regola: ${coincide}/${esaminati} = ${(100*coincide/esaminati).toFixed(0)}%`);
