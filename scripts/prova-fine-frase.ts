/**
 * L'inganno vuole una fine di frase; un I→ii a metà no.
 * Due casi costruiti a mano, con gli stessi due accordi in posizioni metriche diverse.
 */
import { evaluateCadentialPatterns, type ChordEvent } from '../src/utils/cadentialPatterns';

const PC: Record<string, number> = { C:0, 'C#':1, D:2, 'D#':3, E:4, F:5, 'F#':6, G:7, 'G#':8, A:9, 'A#':10, B:11 };
const acc = (nome: string, qualita: string, basso: string, misura: number, mov: number, absBeat: number, note: string[]): ChordEvent =>
  ({ rootPc: PC[nome], quality: qualita, bassPc: PC[basso], absBeat, measureIndex: misura, beat: mov,
     notePcs: note.map(n => PC[n]) });

const mostra = (titolo: string, evts: ChordEvent[], tonicaCasa: string) => {
  const m = evaluateCadentialPatterns(evts, PC[tonicaCasa], false, { minConfidence: 70 });
  console.log(`\n${titolo}  (casa: ${tonicaCasa} maggiore)`);
  if (!m.length) { console.log('   nessun modello agganciato'); return; }
  for (const x of m) {
    const t = Object.keys(PC).find(k => PC[k] === x.targetTonicPc);
    console.log(`   ${x.formulaId.padEnd(12)} → tonica ${t}${x.targetIsMinor ? 'm' : ''}` +
                `  fiducia ${x.confidence}  inganno=${!!x.deceptive}  fine frase=${x.atPhraseEnd}`);
  }
};

// CASO 1 — il caso segnalato: in MI, E → F♯m a METÀ misura (mov. 1 e 3), poi il V.
mostra('CASO 1 · I → ii a metà frase, poi il V (cadenza sospesa)', [
  acc('E',  'Major', 'G#', 19, 1, 76, ['E','G#','B']),
  acc('F#', 'Minor', 'F#', 19, 3, 78, ['F#','A','C#']),
  acc('B',  'Major', 'B',  20, 1, 80, ['B','D#','F#']),
], 'E');

// CASO 2 — un inganno VERO: il V sull'ultimo movimento, il vi sul battere dopo la stanghetta.
mostra('CASO 2 · V → vi attraverso la stanghetta (inganno vero)', [
  acc('G',  'Major', 'G', 7, 3, 30, ['G','B','D']),
  acc('A',  'Minor', 'A', 8, 1, 32, ['A','C','E']),
], 'C');

// CASO 3 — controprova: senza misura/movimento (chi non li passa) tutto resta come prima.
mostra('CASO 3 · gli stessi accordi del caso 1, ma senza misura', [
  { rootPc: PC['E'],  quality: 'Major', bassPc: PC['G#'], absBeat: 76, notePcs: [PC['E'],PC['G#'],PC['B']] },
  { rootPc: PC['F#'], quality: 'Minor', bassPc: PC['F#'], absBeat: 78, notePcs: [PC['F#'],PC['A'],PC['C#']] },
], 'E');

// CASO 4 — la stessa musica, ma dicendo al riconoscitore che casa è MI♭ (la tonalità
// d'IMPIANTO del brano) invece di MI (il contesto dichiarato lì). È ciò che il condotto
// fa oggi: passa `currentTonic`, cioè la tonalità del brano, non quella in vigore lì.
mostra('CASO 4 · stessa musica, ma «casa» = la tonalità d\'impianto del brano', [
  acc('E',  'Major', 'G#', 19, 1, 76, ['E','G#','B']),
  acc('F#', 'Minor', 'F#', 19, 3, 78, ['F#','A','C#']),
  acc('B',  'Major', 'B',  20, 1, 80, ['B','D#','F#']),
], 'D#');   // Mi♭ = D#

// CASO 5 — come il 4 (casa = Mi♭, cioè l'errore di prospettiva) ma SENZA misura, così la
// nuova condizione di fine frase non può intervenire: è il comportamento di prima.
mostra('CASO 5 · casa sbagliata E senza fine frase = il difetto segnalato', [
  { rootPc: PC['E'],  quality: 'Major', bassPc: PC['G#'], absBeat: 76, notePcs: [PC['E'],PC['G#'],PC['B']] },
  { rootPc: PC['F#'], quality: 'Minor', bassPc: PC['F#'], absBeat: 78, notePcs: [PC['F#'],PC['A'],PC['C#']] },
  { rootPc: PC['B'],  quality: 'Major', bassPc: PC['B'],  absBeat: 80, notePcs: [PC['B'],PC['D#'],PC['F#']] },
], 'D#');
