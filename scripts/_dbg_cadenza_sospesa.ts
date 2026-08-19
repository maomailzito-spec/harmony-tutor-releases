/**
 * Perché, alla misura 20, l'analisi legge l'accordo di Mi come V6 invece che I6.
 * Il brano è in Mi♭ con cambi d'armatura; dalla misura 19 (indice 18) è in MI maggiore,
 * e il passaggio finisce su una CADENZA SOSPESA (si ferma sul V, senza risolvere).
 */
import { readFileSync } from 'fs';
import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';

const F = '/Users/Erminio/Desktop/Bassi Dubois /Capitolo 4 - Cadenze/Esercizi sulle cadenze p45.htp';
const proj = JSON.parse(readFileSync(F, 'utf8'));
const notes = proj.notes || [];
const ts = proj.timeSignature || { numerator: 4, denominator: 4 };
const tonic = String(proj.keySignatureRoot || 'C');
const isMinor = Boolean(proj.isMinorMode);
const contexts = proj.analysisContexts || [];

console.log(`Brano: ${tonic} ${isMinor ? 'minore' : 'maggiore'} · contesti dichiarati: ${contexts.length}`);
for (const c of contexts) console.log(`   contesto: movimento ${c.absBeat} → ${c.newTonic}${c.newIsMinor ? ' min' : ' maj'}`);

const keySig = getKeySignature(tonic, isMinor ? 'Minor' : 'Major') as any;
const res: any = applyHarmonyRules(notes as any, keySig, tonic, isMinor, contexts as any, ts as any,
                                   proj.doubleBarlineMeasures || [], proj.ornamentOverrides || [], proj.harmonyOverrides || []);
const inferred = res.inferredAnalysisContexts || [];
console.log(`\nCONTESTI INFERITI dal motore: ${inferred.length}`);
for (const c of inferred) {
  const mis = Math.floor(Number(c.absBeat) / 4) + 1;
  console.log(`   movimento ${c.absBeat} (≈ misura ${mis}) → ${c.newTonic}${c.newIsMinor ? ' min' : ' maj'}  score=${(c as any).score ?? '—'}`);
}

const analyzed = res.analyzedNotes || notes;
console.log('\nETICHETTE dalle misure 19 a 21:');
for (const mi of [18, 19, 20]) {
  const qui = analyzed.filter((n: any) => n && !n.isRest && n.measureIndex === mi);
  const perTempo = new Map<number, any[]>();
  for (const n of qui) {
    const b = Number(n.beat);
    if (!perTempo.has(b)) perTempo.set(b, []);
    perTempo.get(b)!.push(n);
  }
  for (const b of [...perTempo.keys()].sort((x, y) => x - y)) {
    const g = perTempo.get(b)!;
    const basso = g.slice().sort((a: any, c: any) => (a.midi ?? 0) - (c.midi ?? 0))[0];
    const conRoman = g.find((n: any) => n.roman) || basso;
    console.log(`   misura ${mi + 1} mov.${b}: basso ${basso?.pitch}${basso?.accidental === 'sharp' ? '#' : basso?.accidental === 'flat' ? 'b' : ''}` +
                `  roman=${JSON.stringify(conRoman?.roman)}  sigla=${JSON.stringify(conRoman?.chordLabel)}  tonica letta=${JSON.stringify(conRoman?.tonicAtBeat)}`);
  }
}
