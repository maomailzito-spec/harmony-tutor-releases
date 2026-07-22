/**
 * Casi mirati per la cifratura del basso (basso figurato).
 * Esegui:  npx tsx scripts/fig-cases.ts
 *
 * Ogni caso: { key, minor, notes, expect }
 *   - key:    ROOT dell'armatura come RELATIVA MAGGIORE (es. 'C' per Do/Lam, 'Bb' per Sib/Solm, 'F' per Fa/Rem).
 *   - minor:  true/false (cambia solo l'etichetta; l'armatura è sempre quella della relativa maggiore).
 *   - notes:  dalla più grave (il BASSO) alla più acuta. Sintassi nota: LETTERA[accidente]OTTAVA
 *             LETTERA nuda = altezza DIATONICA dell'armatura (come sul rigo: "B4" in Fa = Si♭).
 *             accidenti:  #  ##/x  b  bb  n(bequadro)  — l'accidente è "scritto" SOLO se devia dall'armatura.
 *             es. "A3", "C#4" (Do♯ in Do = cromatico), "Bb3" (in Fa = diatonico), "Bn4" (Si♮ in Fa = cromatico)
 *   - expect: figure attese (ordine indifferente), es. ['5','♯3'].  Metti [] se non vuoi asserire.
 */
const CASES: { key: string; minor: boolean; notes: string[]; expect: string[] }[] = [
  // I tuoi 3 esempi
  { key: 'C',  minor: false, notes: ['A3', 'C#4', 'E4'],        expect: ['5', '♯3'] },   // La magg in Do → ♯3
  { key: 'Bb', minor: false, notes: ['G3', 'Bn3', 'D4', 'F4'],  expect: ['7', '5', '♮3'] }, // G7 in Sib → ♮3
  { key: 'Eb', minor: true,  notes: ['G3', 'Bn3', 'D4', 'F4'],  expect: ['7', '5', '♮3'] }, // G7 in Do min → ♮3
  // Controllo: accordo diatonico → nessun accidente spurio
  { key: 'C',  minor: false, notes: ['D3', 'F4', 'A4'],         expect: ['5'] },          // ii (Re min) diatonico → solo 5
  { key: 'F',  minor: false, notes: ['C4', 'E4', 'G4', 'Bb4'],  expect: ['7', '5'] },     // V7 di Fa: Bb DIATONICO (in armatura) → nessun accidente scritto → 7 pulito (come l'app)
  // V7 in minore (relativa magg. C → La minore): sensibile G#
  { key: 'C',  minor: true,  notes: ['E3', 'G#3', 'B3', 'D4'],  expect: ['7', '5', '♯3'] }, // V7 di La min → ♯3
  // (a) accidente RIDONDANTE: bequadro forzato su 7a già naturale d'armatura (E7 in Do) → 7, non ♭7
  { key: 'C',  minor: false, notes: ['E3', 'G#3', 'B3', 'D4!'], expect: ['7', '5', '♯3'] }, // "D4!" = ♮ ridondante → NON deve dare ♭7
  // (b) esito CROMATICO va comunque marcato (non spogliato): F♮ in Sol è cromatico anche col ♮ forzato
  { key: 'G',  minor: false, notes: ['G3', 'B3', 'D4', 'Fn4!'], expect: [] }, // G7 con F♮ (cromatico in Sol) → la 7a resta marcata
];

// ---- motore ----
import { getKeySignature, computeFiguredBassFromNotes, FIGURED_BASS_UI_OPTIONS } from '../src/utils/musicTheory';
const NAT: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACC: Record<string, { off: number; name: string }> = {
  '#': { off: 1, name: 'sharp' }, '##': { off: 2, name: 'double-sharp' }, x: { off: 2, name: 'double-sharp' },
  b: { off: -1, name: 'flat' }, bb: { off: -2, name: 'double-flat' }, n: { off: 0, name: 'natural' },
};
const SH_ORD = ['F', 'C', 'G', 'D', 'A', 'E', 'B']; const FL_ORD = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
const NAME_FOR: Record<number, string> = { 1: 'sharp', 2: 'double-sharp', [-1]: 'flat', [-2]: 'double-flat', 0: 'natural' };
function armAcc(ks: { type: string; count: number }, letter: string): number {
  if (!ks.count) return 0;
  return ks.type === 'sharp' ? (SH_ORD.slice(0, ks.count).includes(letter) ? 1 : 0)
                             : (FL_ORD.slice(0, ks.count).includes(letter) ? -1 : 0);
}
function parseNote(s: string, i: number, ks: { type: string; count: number }) {
  const forced = s.endsWith('!'); if (forced) s = s.slice(0, -1); // "!" = accidente SCRITTO forzato (anche se ridondante)
  const m = s.match(/^([A-G])(##|x|bb|#|b|n)?(-?\d)$/);
  if (!m) throw new Error(`nota non valida: "${s}"`);
  const letter = m[1]; const accSym = m[2]; const octave = Number(m[3]);
  const off = accSym ? ACC[accSym].off : armAcc(ks, letter); // niente simbolo = altezza diatonica d'armatura
  const pc = ((NAT[letter] + off) % 12 + 12) % 12;
  const midi = (octave + 1) * 12 + pc;
  // L'accidente SCRITTO esiste solo se l'altezza devia dall'armatura (come fa l'editor reale) — o se forzato con "!".
  const explicitAccidental = forced ? NAME_FOR[off] : (off === armAcc(ks, letter) ? null : NAME_FOR[off]);
  return { id: `n${i}`, pitch: letter, octave, midi, noteIndex: pc, isRest: false,
           explicitAccidental, duration: 'quarter', voice: 1, clef: 'treble' };
}
const norm = (a: string[]) => a.slice().sort().join('·');
let pass = 0, fail = 0;
for (const c of CASES) {
  const ks = getKeySignature(c.key, 'Major'); // armatura = relativa maggiore, sempre 'Major'
  const notes = c.notes.map((s, i) => parseNote(s, i, ks));
  const got = computeFiguredBassFromNotes(notes as any, { ...FIGURED_BASS_UI_OPTIONS, keySignature: ks }).figures;
  const ok = c.expect.length === 0 || norm(got) === norm(c.expect);
  if (c.expect.length === 0) { console.log(`·    ${c.key}${c.minor ? 'm' : ''}  [${c.notes.join(' ')}]  → ${JSON.stringify(got)}`); }
  else if (ok) { pass++; console.log(`PASS ${c.key}${c.minor ? 'm' : ''}  [${c.notes.join(' ')}]  → ${JSON.stringify(got)}`); }
  else { fail++; console.log(`FAIL ${c.key}${c.minor ? 'm' : ''}  [${c.notes.join(' ')}]  atteso ${JSON.stringify(c.expect)}  ottenuto ${JSON.stringify(got)}`); }
}
console.log(`\n${pass} PASS, ${fail} FAIL`);
