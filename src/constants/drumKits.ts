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
 * Quale kit sa suonare meglio questi pezzi. Si conta quanti PEZZI DISTINTI del file
 * ciascun kit conosce: un pop-rock (charleston, tom, ride) è coperto dal kit rock e non
 * da quello orchestrale, e viceversa per tamburello e gong. A parità vince l'orchestrale,
 * che è il ripiego storico dell'app.
 */
export function bestDrumKitFor(midiPieces: Iterable<number>): 'orchestral' | 'rock' {
    const pieces = new Set<number>();
    for (const m of midiPieces) pieces.add(Number(m));
    const covers = (palette: DrumPiece[]) => {
        const set = new Set(palette.map(p => p.midi));
        let n = 0;
        for (const p of pieces) if (set.has(p)) n++;
        return n;
    };
    return covers(DRUM_PALETTE_ROCK) > covers(DRUM_PALETTE_ORCH) ? 'rock' : 'orchestral';
}
