/**
 * QUANTO ALTALENANO GLI AUTORI.
 *
 * Il banco misura «altalene» e «retrocessioni» sulla progressione del
 * GENERATORE e su nessun'altra. Cosi' il numero non ha un termine di paragone:
 * 55 altalene e' tanto o e' quanto ne fa Bach? Senza saperlo si insegue un
 * fantasma. Qui si applica lo stesso metro alla progressione D'AUTORE,
 * ricavata dall'analisi del brano com'e' scritto.
 *
 *   npx tsx scripts/piattezza-degli-autori.ts <file.htp> [altri…]
 */
import { readFileSync } from 'fs';
import {
  applyHarmonyRules, getActiveNotesTimeline, getKeySignature, getRomanAnalysis,
} from '../src/utils/musicTheory';
import { bonusTransizione } from '../src/engine/corpusProgressione';

const RELATIVE_MINORI: Record<string, string> = {
  C: 'A', G: 'E', D: 'B', A: 'F#', E: 'C#', B: 'G#', 'F#': 'D#',
  F: 'D', Bb: 'G', Eb: 'C', Ab: 'F', Db: 'Bb', Gb: 'Eb',
};

const IDX_MAG: Record<string, number> = { I: 0, ii: 1, iii: 2, IV: 3, V: 4, vi: 5, 'vii°': 6, vii: 6 };
const IDX_MIN: Record<string, number> = { i: 0, 'ii°': 1, ii: 1, III: 2, iv: 3, V: 4, v: 4, VI: 5, VII: 6, 'vii°': 6 };

/** Lo stesso conto di `banco-corali.ts`, parola per parola. */
function piattezza(gradi: string[], minore: boolean) {
  const IDX = minore ? IDX_MIN : IDX_MAG;
  let altalena = 0;
  for (let i = 3; i < gradi.length; i++) {
    if (gradi[i] === gradi[i - 2] && gradi[i - 1] === gradi[i - 3]) altalena++;
  }
  let retro = 0;
  for (let i = 1; i < gradi.length; i++) {
    const a = IDX[gradi[i - 1]], b = IDX[gradi[i]];
    if (a == null || b == null || a === b) continue;
    if (bonusTransizione(minore, a, b) < -0.2) retro++;
  }
  return { altalena, retro, vocabolario: new Set(gradi).size, accordi: gradi.length };
}

const strutturale = (n: any) => n && !n.isRest
  && !n.isPassing && !n.isNeighbor && !n.isAnticipation && !n.isAppoggiatura && !n.isEscape;

let tA = 0, tR = 0, tN = 0;
for (const f of process.argv.slice(2)) {
  let d: any;
  try { d = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
  const minore = !!d.isMinorMode;
  const radice = d.keySignatureRoot || 'C';
  const tonica = minore ? (RELATIVE_MINORI[radice] || radice) : radice;
  const ts = d.timeSignature || { numerator: 4, denominator: 4 };

  const res: any = applyHarmonyRules(
    d.notes, getKeySignature(radice, 'Major') as any, tonica, minore,
    d.analysisContexts || [], ts, undefined,
    (d.ornamentOverrides || []).length ? d.ornamentOverrides : undefined,
    (d.harmonyOverrides || []).length ? d.harmonyOverrides : undefined,
  );
  const linea = getActiveNotesTimeline(res.analyzedNotes || d.notes, ts, d.timeSignatureChanges || []);

  const gradi: string[] = [];
  let prec = '';
  for (const ev of (linea || [])) {
    const st = (ev.notes as any[]).filter(strutturale);
    if (st.length < 2) continue;
    const ra = getRomanAnalysis(st as any, tonica, minore);
    if (!ra?.roman) continue;
    const g = String(ra.roman).replace(/\s+/g, '').replace(/[0-9]+$/, '');
    if (g && g !== prec) { gradi.push(g); prec = g; }
  }
  const p = piattezza(gradi, minore);
  tA += p.altalena; tR += p.retro; tN += p.accordi;
  console.log(`${(f.split('/').pop() || '').padEnd(30)} ${String(p.accordi).padStart(4)} accordi   ${String(p.altalena).padStart(3)} altalene   ${String(p.retro).padStart(3)} retrocessioni   ${p.vocabolario} gradi`);
}
console.log(`\nAUTORI, in tutto: ${tN} accordi   ${tA} altalene   ${tR} retrocessioni\n`);
