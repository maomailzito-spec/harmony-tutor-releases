/**
 * QUANDO GLI AUTORI METTONO LA SETTIMA.
 *
 * `shouldUseSeventh` decide a mano, con regole scritte a occhio — «la dominante
 * la prende sempre», «il settimo grado pure» — e il risultato e' che il
 * generatore scrive settime sul 39,3% degli accordi contro l'11,1% degli
 * autori. Ogni settima in eccesso poi DEVE risolvere, e quando non ci riesce
 * chiede un'eccezione: da qui le licenze usate quattro volte piu' del dovuto.
 *
 * Prima di riscrivere quelle regole, si guarda cosa fa il repertorio: dato il
 * grado, cosa lo segue e se sta sul battere, quanto spesso porta la settima.
 *
 *   npx tsx scripts/quando-la-settima.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  applyHarmonyRules, getActiveNotesTimeline, getKeySignature, getRomanAnalysis,
} from '../src/utils/musicTheory';
import { parseRoman } from '../src/engine/choralRealization';

const REL: Record<string, string> = {
  C: 'A', G: 'E', D: 'B', A: 'F#', E: 'C#', B: 'G#', 'F#': 'D#',
  F: 'D', Bb: 'G', Eb: 'C', Ab: 'F', Db: 'Bb', Gb: 'Eb',
};
const DAUTORE = /dubois|pedron|delachi|delamont|schinelli|bach|cantata|corale/i;
const strut = (n: any) => n && !n.isRest
  && !n.isPassing && !n.isNeighbor && !n.isAnticipation && !n.isAppoggiatura && !n.isEscape;
const NOMI = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];

function main() {
  const dir = path.resolve(__dirname, '..', 'tests');
  const files = fs.readdirSync(dir).filter(f => /\.(json|htp)$/.test(f) && DAUTORE.test(f)).sort();

  /** conti[grado][gradoDopo] = [con settima, in tutto] */
  const perSeguito: number[][][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 8 }, () => [0, 0]));
  const perGrado: number[][] = Array.from({ length: 7 }, () => [0, 0]);
  const perPosizione: Record<string, number[]> = { forte: [0, 0], debole: [0, 0] };
  let tot = 0, conSettima = 0;

  for (const nome of files) {
    let d: any;
    try { d = JSON.parse(fs.readFileSync(path.join(dir, nome), 'utf8')); } catch { continue; }
    if (!Array.isArray(d.notes) || d.notes.length < 8) continue;
    const minore = !!d.isMinorMode;
    const radice = d.keySignatureRoot || 'C';
    const tonica = minore ? (REL[radice] || radice) : radice;
    const ts = d.timeSignature || { numerator: 4, denominator: 4 };
    const bpm = ts.numerator * (4 / ts.denominator);
    let res: any;
    try {
      res = applyHarmonyRules(d.notes, getKeySignature(radice, 'Major') as any, tonica, minore,
        d.analysisContexts || [], ts, undefined, undefined, undefined);
    } catch { continue; }
    const linea = getActiveNotesTimeline(res.analyzedNotes || d.notes, ts, d.timeSignatureChanges || []);

    const passi: { deg: number; sett: boolean; forte: boolean }[] = [];
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
      // Solo i gradi diatonici di casa: le tonicizzazioni hanno regole loro.
      if (!p || p.secondaryTarget != null || p.degree == null || p.degree < 0 || p.degree > 6) continue;
      const ab = ev.absBeat ?? 0;
      const dentro = ab % bpm;
      const forte = Math.abs(dentro - Math.round(dentro)) < 0.01
        && (Math.round(dentro) === 0 || (bpm >= 4 && Math.round(dentro) === 2));
      passi.push({ deg: p.degree, sett: !!p.hasSeventh, forte });
    }

    for (let i = 0; i < passi.length; i++) {
      const { deg, sett, forte } = passi[i];
      tot++; if (sett) conSettima++;
      perGrado[deg][1]++; if (sett) perGrado[deg][0]++;
      const chiave = forte ? 'forte' : 'debole';
      perPosizione[chiave][1]++; if (sett) perPosizione[chiave][0]++;
      const dopo = i + 1 < passi.length ? passi[i + 1].deg : 7;   // 7 = fine
      perSeguito[deg][dopo][1]++; if (sett) perSeguito[deg][dopo][0]++;
    }
  }

  const pc = (a: number, b: number) => b ? (100 * a / b).toFixed(0) + '%' : '—';
  console.log(`\n${tot} accordi diatonici d'autore · ${conSettima} con la settima (${pc(conSettima, tot)})\n`);
  console.log('PER GRADO');
  for (let g = 0; g < 7; g++) {
    console.log(`   ${NOMI[g].padEnd(5)} ${pc(perGrado[g][0], perGrado[g][1]).padStart(4)}   su ${perGrado[g][1]}`);
  }
  console.log('\nPER POSIZIONE');
  for (const k of ['forte', 'debole']) {
    console.log(`   ${k.padEnd(7)} ${pc(perPosizione[k][0], perPosizione[k][1]).padStart(4)}   su ${perPosizione[k][1]}`);
  }
  console.log('\nPER GRADO E PER CIO\' CHE SEGUE  (solo i casi con almeno 15 osservazioni)');
  for (let g = 0; g < 7; g++) {
    const righe: string[] = [];
    for (let n = 0; n < 8; n++) {
      const [c, t] = perSeguito[g][n];
      if (t < 15) continue;
      righe.push(`→${n === 7 ? 'fine' : NOMI[n]} ${pc(c, t)} (${t})`);
    }
    if (righe.length) console.log(`   ${NOMI[g].padEnd(5)} ${righe.join('   ')}`);
  }
  console.log('');
}

main();
