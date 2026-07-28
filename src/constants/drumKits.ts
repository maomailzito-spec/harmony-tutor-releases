/**
 * I KIT DI PERCUSSIONI dell'app: quali pezzi esistono e su quale riga si incidono.
 *
 * Stanno qui, fuori dai componenti, perché servono in due momenti lontani fra loro:
 * al disegno/inserimento sul rigo e all'IMPORTAZIONE di un MIDI, che deve scegliere il
 * kit giusto guardando i pezzi che il file usa. Un file pop-rock suonato col kit
 * orchestrale — sette pezzi, senza charleston né tom — suona sbagliato.
 */
export type DrumPiece = { midi: number; label: string; line: string };
// Nomi degli elementi in INGLESE (terminologia batteria standard, uguale in IT/EN → niente
// divergenza tra le versioni). Usati sia nel modulo 🥁 sia nei fader del mixer batteria.
export const DRUM_PALETTE_ORCH: DrumPiece[] = [
  { midi: 36, label: 'Bass Drum',  line: 'f/4' },
  { midi: 38, label: 'Snare',      line: 'c/5' },
  { midi: 42, label: 'Gong',       line: 'd/4' },
  { midi: 49, label: 'Crash',      line: 'a/5' },
  { midi: 51, label: 'Sus. Cym.',  line: 'g/5' },
  { midi: 53, label: 'Tambourine', line: 'e/5' },
  { midi: 56, label: 'Cowbell',    line: 'f/5' },
];
// Kit ROCK (Salamander) — set GM standard. Ordine mappa: dal basso (kick) all'alto (piatti).
export const DRUM_PALETTE_ROCK: DrumPiece[] = [
  { midi: 36, label: 'Kick',      line: 'f/4' },
  { midi: 38, label: 'Snare',     line: 'c/5' },
  { midi: 37, label: 'Rimshot',   line: 'c/5' },
  { midi: 45, label: 'Low Tom',   line: 'a/4' },
  { midi: 50, label: 'High Tom',  line: 'e/5' },
  { midi: 44, label: 'HH Pedal',  line: 'd/4' },
  { midi: 42, label: 'HH Closed', line: 'g/5' },
  { midi: 46, label: 'HH Open',   line: 'g/5' },
  { midi: 51, label: 'Ride',      line: 'f/5' },
  { midi: 53, label: 'Ride Bell', line: 'f/5' },
  { midi: 49, label: 'Crash',     line: 'a/5' },
  { midi: 52, label: 'China',     line: 'b/5' },
  { midi: 55, label: 'Splash',    line: 'c/6' },
  { midi: 56, label: 'Cowbell',   line: 'd/5' },
];

/**
 * Quale kit suonare per queste percussioni.
 *
 * Contare le sovrapposizioni non funziona: il set ORCHESTRALE è un sottoinsieme di quello
 * ROCK, quindi si finisce quasi sempre in parità — e per giunta lo stesso numero GM vuol
 * dire cose diverse nei due kit (42 è il charleston nel rock, il gong nell'orchestra).
 * Si guardano invece i segni inequivocabili di un KIT da batteria: charleston, tom,
 * rimshot, china, splash. Se ce n'è anche uno solo, è un kit; altrimenti — grancassa,
 * rullante, piatti, tamburello e poco altro — è percussione d'orchestra.
 *
 * Nei file MIDI il numero 42 è il charleston per convenzione GM: chi importa una batteria
 * lo usa in quel senso, e leggerlo come gong darebbe il suono sbagliato al primo colpo.
 */
const DRUM_KIT_SIGNS = new Set<number>([
    37,             // rimshot / sidestick
    41, 43, 45, 47, 48, 50, // tom
    42, 44, 46,     // charleston (chiuso, a pedale, aperto)
    52, 55, 57,     // china, splash, crash 2
]);

export function bestDrumKitFor(midiPieces: Iterable<number>): 'orchestral' | 'rock' {
    for (const m of midiPieces) if (DRUM_KIT_SIGNS.has(Number(m))) return 'rock';
    return 'orchestral';
}
