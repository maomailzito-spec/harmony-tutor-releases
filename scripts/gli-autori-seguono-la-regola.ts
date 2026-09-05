/**
 * GLI AUTORI SEGUONO LA REGOLA DELL'OTTAVA?
 *
 * Prima di far pesare la tavola nel generatore, si guarda se il repertorio la
 * conferma: dove il basso cammina per grado, l'armonia d'autore coincide con
 * quella che la regola prescrive?
 *
 *   npx tsx scripts/gli-autori-seguono-la-regola.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  applyHarmonyRules, getActiveNotesTimeline, getKeySignature, getRomanAnalysis,
} from '../src/utils/musicTheory';
import { parseRoman } from '../src/engine/choralRealization';
import { armoniaDellaRegola } from '../src/engine/regolaDellOttava';

const REL: Record<string, string> = {
  C: 'A', G: 'E', D: 'B', A: 'F#', E: 'C#', B: 'G#', 'F#': 'D#',
  F: 'D', Bb: 'G', Eb: 'C', Ab: 'F', Db: 'Bb', Gb: 'Eb',
};
const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const GRADO: (number | null)[] = [0, null, 1, 2, 2, 3, null, 4, 5, 5, 6, 6];
const NOMI = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
const RIV = ['', '6', '6/4', '4/2'];
const DAUTORE = new RegExp(process.env.SOLO || 'dubois|pedron|delachi|delamont|schinelli|bach|cantata|corale', 'i');
const strut = (n: any) => n && !n.isRest
  && !n.isPassing && !n.isNeighbor && !n.isAnticipation && !n.isAppoggiatura && !n.isEscape;
const pcDi = (s: string) => {
  const b = PC[s.charAt(0).toUpperCase()];
  if (b == null) return null;
  let a = 0;
  for (const c of s.slice(1)) { if (c === '#') a++; else if (c === 'b') a--; }
  return ((b + a) % 12 + 12) % 12;
};

function main() {
  const dir = path.resolve(__dirname, '..', 'tests');
  const files = fs.readdirSync(dir).filter(f => /\.(json|htp)$/.test(f) && DAUTORE.test(f)).sort();
  let esaminati = 0, coincide = 0;
  const perGrado: number[][] = Array.from({ length: 7 }, () => [0, 0]);
  const invece: Record<string, Record<string, number>> = {};

  for (const nome of files) {
    let d: any;
    try { d = JSON.parse(fs.readFileSync(path.join(dir, nome), 'utf8')); } catch { continue; }
    if (!Array.isArray(d.notes) || d.notes.length < 8) continue;
    const minore = !!d.isMinorMode;
    const radice = d.keySignatureRoot || 'C';
    const tonica = minore ? (REL[radice] || radice) : radice;
    const tp = pcDi(tonica);
    if (tp == null) continue;
    const ts = d.timeSignature || { numerator: 4, denominator: 4 };
    let res: any;
    try {
      res = applyHarmonyRules(d.notes, getKeySignature(radice, 'Major') as any, tonica, minore,
        d.analysisContexts || [], ts, undefined, undefined, undefined);
    } catch { continue; }
    const linea = getActiveNotesTimeline(res.analyzedNotes || d.notes, ts, d.timeSignatureChanges || []);

    const passi: { deg: number; inv: number; basso: number }[] = [];
    let prec = '';
    for (const ev of (linea || [])) {
      const st = (ev.notes as any[]).filter(strut);
      if (st.length < 2) continue;
      const ra = getRomanAnalysis(st as any, tonica, minore);
      if (!ra?.roman) continue;
      const eti = String(ra.roman).replace(/\s+/g, '') + (ra.figures || []).join('');
      if (eti === prec) continue;
      prec = eti;
      let p: any;
      try { p = parseRoman(eti); } catch { continue; }
      if (!p || p.secondaryTarget != null || p.degree == null || p.degree < 0 || p.degree > 6) continue;
      const ns = (ev.notes as any[]).filter((n: any) => n && !n.isRest && Number.isFinite(n.midi));
      if (!ns.length) continue;
      const basso = ns.reduce((lo: any, n: any) => (n.midi < lo.midi ? n : lo), ns[0]).midi;
      passi.push({ deg: p.degree, inv: p.inversion ?? 0, basso: ((basso % 12) + 12) % 12 });
    }

    for (let i = 0; i < passi.length; i++) {
      const g = GRADO[((passi[i].basso - tp) % 12 + 12) % 12];
      if (g == null) continue;
      const passo = (a: number, b: number) => ((b - a + 18) % 12) - 6;
      const avanti = i + 1 < passi.length ? passo(passi[i].basso, passi[i + 1].basso) : null;
      const indietro = i > 0 ? passo(passi[i].basso, passi[i - 1].basso) : null;
      const perGr = (x: number | null) => x != null && Math.abs(x) >= 1 && Math.abs(x) <= 2;
      if (!perGr(avanti) && !perGr(indietro)) continue;
      const sale = perGr(avanti) ? (avanti as number) > 0 : (indietro as number) < 0;
      const attesa = armoniaDellaRegola(g, sale);
      if (!attesa) continue;
      esaminati++;
      perGrado[g][1]++;
      const ok = attesa.grado === passi[i].deg && attesa.rivolto === passi[i].inv;
      if (ok) { coincide++; perGrado[g][0]++; }
      else {
        const k = `${g + 1}° grado`;
        if (!invece[k]) invece[k] = {};
        const scritto = NOMI[passi[i].deg] + (RIV[passi[i].inv] || '');
        invece[k][scritto] = (invece[k][scritto] || 0) + 1;
      }
    }
  }

  const pc = (a: number, b: number) => b ? (100 * a / b).toFixed(0) + '%' : '—';
  console.log(`\n${esaminati} armonie d'autore su basso che cammina per grado`);
  console.log(`coincidono con la regola dell'ottava: ${coincide}  (${pc(coincide, esaminati)})\n`);
  console.log('per grado del basso:');
  for (let g = 0; g < 7; g++) {
    const att = armoniaDellaRegola(g, true);
    const nome = att ? NOMI[att.grado] + (RIV[att.rivolto] || '') : '—';
    const alt = Object.entries(invece[`${g + 1}° grado`] || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
    console.log(`   ${g + 1}°  la regola vuole ${nome.padEnd(6)} ${pc(perGrado[g][0], perGrado[g][1]).padStart(5)} su ${String(perGrado[g][1]).padStart(4)}`
      + (alt.length ? `   invece: ${alt.map(([k, v]) => `${k} ${v}`).join('  ')}` : ''));
  }
  console.log('');
}

main();
