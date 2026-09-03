/**
 * IL GENERATORE AZZECCA LE CADENZE?
 *
 * L'idea dell'utente: il generatore dovrebbe leggere la parte scritta con uno
 * sguardo piu' largo — individuare le cadenze possibili, e da li' risalire alle
 * sottodominanti, a cosa le precede, a come si apre una progressione — passando
 * in rassegna dei MODELLI e scegliendo quello che si adatta meglio.
 *
 * Prima di costruirlo, la domanda che dice se serve: gli ultimi accordi, che
 * sono la cadenza e sono il punto piu' vincolato di tutti, li sceglie come
 * l'autore? Qui si confrontano le ultime tre armonie.
 *
 *   npx tsx scripts/le-cadenze-le-azzecca.ts <file.htp> [altri…]
 */
import { readFileSync } from 'fs';
import {
  applyHarmonyRules, getActiveNotesTimeline, getKeySignature, getRomanAnalysis,
} from '../src/utils/musicTheory';
import { autoHarmonize, type SopranoConstraint } from '../src/engine/choralRealization';
import { giudicaCadenza } from '../src/engine/cadenze';

const REL_MIN: Record<string, string> = {
  C: 'A', G: 'E', D: 'B', A: 'F#', E: 'C#', B: 'G#', 'F#': 'D#',
  F: 'D', Bb: 'G', Eb: 'C', Ab: 'F', Db: 'Bb', Gb: 'Eb',
};

const nudo = (r: string) => String(r).replace(/\s+/g, '');
const strutturale = (n: any) => n && !n.isRest
  && !n.isPassing && !n.isNeighbor && !n.isAnticipation && !n.isAppoggiatura && !n.isEscape;

let uguali = 0, diverse = 0, ultimoUguale = 0, buoneA = 0, buoneG = 0;
for (const f of process.argv.slice(2)) {
  let d: any;
  try { d = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
  const minore = !!d.isMinorMode;
  const radice = d.keySignatureRoot || 'C';
  const tonica = minore ? (REL_MIN[radice] || radice) : radice;
  const ts = d.timeSignature || { numerator: 4, denominator: 4 };
  const bpm = ts.numerator * (4 / ts.denominator);

  const res: any = applyHarmonyRules(
    d.notes, getKeySignature(radice, 'Major') as any, tonica, minore,
    d.analysisContexts || [], ts, undefined,
    (d.ornamentOverrides || []).length ? d.ornamentOverrides : undefined,
    (d.harmonyOverrides || []).length ? d.harmonyOverrides : undefined);
  const linea = getActiveNotesTimeline(res.analyzedNotes || d.notes, ts, d.timeSignatureChanges || []);
  const autore: string[] = [];
  let prec = '';
  for (const ev of (linea || [])) {
    const st = (ev.notes as any[]).filter(strutturale);
    if (st.length < 2) continue;
    const ra = getRomanAnalysis(st as any, tonica, minore);
    if (!ra?.roman) continue;
    const g = nudo(ra.roman);
    if (g && g !== prec) { autore.push(g); prec = g; }
  }

  const sop = (res.analyzedNotes || d.notes)
    .filter((n: any) => n && !n.isRest && (Number(n.voice) || 1) === 1)
    .sort((a: any, b: any) => ((a.measureIndex ?? 0) - (b.measureIndex ?? 0)) || ((a.beat ?? 1) - (b.beat ?? 1)));
  const v: SopranoConstraint[] = sop.map((n: any) => ({
    midi: n.midi, measure: n.measureIndex ?? 0, beat: n.beat ?? 1, pitch: n.pitch }));
  const gen = autoHarmonize(v, tonica, minore, Number(process.env.RITMO || 0) || 0, bpm).map(c => nudo(c.roman));

  const cA = autore.slice(-3).join('–') || '—';
  const cG = gen.slice(-3).join('–') || '—';
  const ok = cA === cG;
  if (ok) uguali++; else diverse++;
  if (autore.length && gen.length && autore[autore.length - 1] === gen[gen.length - 1]) ultimoUguale++;
  // IL GIUDIZIO, che e' un'altra cosa dalla somiglianza: non «uguale
  // all'autore» ma «la formula c'e' ed e' completa».
  const gA = giudicaCadenza(autore), gG = giudicaCadenza(gen);
  if (gA.benFormata) buoneA++; if (gG.benFormata) buoneG++;
  console.log(`${(f.split('/').pop() || '').padEnd(26)}`
    + ` autore ${cA.padEnd(14)} ${(gA.specie + (gA.benFormata ? ' ✓' : ' ✗')).padEnd(13)}`
    + ` | generatore ${cG.padEnd(14)} ${(gG.specie + (gG.benFormata ? ' ✓' : ' ✗'))}`);
}
console.log(`\ncadenza finale (ultime tre armonie) uguale all'autore: ${uguali} su ${uguali + diverse}`);
console.log(`ultimo accordo uguale: ${ultimoUguale} su ${uguali + diverse}`);
console.log(`\nCADENZE BEN FORMATE   autori: ${buoneA} su ${uguali + diverse}   generatore: ${buoneG} su ${uguali + diverse}\n`);
