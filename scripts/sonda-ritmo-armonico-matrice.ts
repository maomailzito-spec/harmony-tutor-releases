import { autoHarmonize, realizeChorale, type SopranoConstraint, type ChoralConfig } from '../src/engine/choralRealization';
const VAL: Record<string, number> = { whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25 };

type Nota = { midi: number; measure: number; beat: number };
const casi: { nome: string; num: number; den: number; mel: Nota[] }[] = [
  { nome: '4/4 valori misti, attacchi su 1 e 3', num: 4, den: 4, mel: [
    {midi:72,measure:0,beat:1},{midi:74,measure:0,beat:3},{midi:76,measure:0,beat:3.5},{midi:77,measure:0,beat:4},
    {midi:76,measure:1,beat:1},{midi:74,measure:1,beat:2},{midi:72,measure:1,beat:3}] },
  { nome: '4/4 la melodia comincia a b2', num: 4, den: 4, mel: [
    {midi:72,measure:0,beat:2},{midi:74,measure:0,beat:3},{midi:76,measure:0,beat:4},
    {midi:77,measure:1,beat:1},{midi:76,measure:1,beat:2},{midi:74,measure:1,beat:3},{midi:72,measure:1,beat:4}] },
  { nome: '3/4 semiminime', num: 3, den: 4, mel: [
    {midi:72,measure:0,beat:1},{midi:74,measure:0,beat:2},{midi:76,measure:0,beat:3},
    {midi:77,measure:1,beat:1},{midi:76,measure:1,beat:2},{midi:74,measure:1,beat:3}] },
  { nome: '3/4 valori misti', num: 3, den: 4, mel: [
    {midi:72,measure:0,beat:1},{midi:74,measure:0,beat:2.5},{midi:76,measure:0,beat:3},
    {midi:77,measure:1,beat:1},{midi:76,measure:1,beat:2},{midi:74,measure:1,beat:3}] },
  { nome: '6/8', num: 6, den: 8, mel: [
    {midi:72,measure:0,beat:1},{midi:74,measure:0,beat:2},{midi:76,measure:0,beat:3},
    {midi:77,measure:1,beat:1},{midi:76,measure:1,beat:2},{midi:74,measure:1,beat:3}] },
];

for (const c of casi) {
  const bpm = c.num * (4 / c.den);
  for (const ritmo of [0, 0.5, 1, 2, 4]) {
    const v: SopranoConstraint[] = c.mel.map(m => ({ ...m }));
    let esito = '';
    try {
      const prog = autoHarmonize(v, 'C', false, ritmo, bpm);
      const attacchi = new Set(c.mel.map(m => `${m.measure}:${m.beat}`));
      const vuoti = prog.filter(x => !attacchi.has(`${x.measure}:${x.beat}`)).length;
      const cfg: ChoralConfig = { tonic:'C', isMinor:false, timeSignature:{numerator:c.num,denominator:c.den} as any,
        rules:{allowParallel5ths:false,allowParallel8ves:false,allowCrossing:false,allowOverlap:false,doubleRoot:true},
        sopranoMelody: v };
      const res = realizeChorale(prog, cfg);
      const perMV = new Map<string, number>();
      for (const n of res.notes as any[]) {
        if (n.voice === 1) continue;                       // il soprano vero lo tiene lo spartito
        const k = `${n.measureIndex}:${n.voice}`;
        perMV.set(k, (perMV.get(k) || 0) + (VAL[n.duration]||0) * (n.isDotted ? 1.5 : 1));
      }
      const storte = [...perMV.entries()].filter(([, s]) => Math.abs(s - bpm) > 1e-9);
      esito = `${prog.length} accordi` +
        (vuoti ? `  ${vuoti} NEL VUOTO` : '') +
        (storte.length ? `  ${storte.length} MISURE STORTE (es. ${storte[0][0]} fa ${storte[0][1]} invece di ${bpm})` : '');
    } catch (e: any) { esito = 'ECCEZIONE: ' + e.message; }
    console.log(`${c.nome.padEnd(38)} ritmo ${String(ritmo).padEnd(4)} → ${esito}`);
  }
  console.log('');
}
