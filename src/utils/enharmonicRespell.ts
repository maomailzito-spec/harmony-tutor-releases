import type { AccidentalType, StaffNote } from '../types';

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const ACC_TO_ALTER: Record<string, number> = {
    sharp: 1, flat: -1, natural: 0, 'double-sharp': 2, 'double-flat': -2,
    '#': 1, b: -1, '##': 2, bb: -2,
};
const ALTER_TO_ACC: Record<number, AccidentalType | null> = {
    0: 'natural', 1: 'sharp', [-1]: 'flat', 2: 'double-sharp', [-2]: 'double-flat',
};

/** Alterazione scritta della nota, con la priorità usata dal disegno: utente > esplicita > automatica. */
const writtenAlter = (n: any): number => {
    const s = n?.userAccidental ?? n?.explicitAccidental ?? n?.accidental ?? null;
    return s == null ? 0 : (ACC_TO_ALTER[String(s)] ?? 0);
};

/**
 * RISCRITTURA ENARMONICA di una nota: stesso suono, altra grafia (Re♯ → Mi♭).
 *
 * Si cercano le scritture della stessa altezza sulle lettere vicine e si sceglie quella
 * con MENO alterazioni, escludendo quella attuale; se le alternative pareggiano vince la
 * più semplice. L'ottava viene ricalcolata dal suono, non copiata: Si♯ e Do stanno sulla
 * stessa altezza ma su ottave scritte diverse, e sbagliare quel dettaglio sposterebbe la
 * nota di un'ottava sul pentagramma.
 *
 * Restituisce null quando non esiste un'alternativa scrivibile entro il doppio segno
 * (per esempio non si riscrive un Sol naturale, se non con grafie assurde).
 */
export function enharmonicRespell(note: StaffNote): { pitch: string; accidental: AccidentalType | null; octave: number; midi: number } | null {
    try {
        const letter = String((note as any)?.pitch || '').trim().charAt(0).toUpperCase();
        const octave = Number((note as any)?.octave);
        if (!LETTER_PC.hasOwnProperty(letter) || !Number.isFinite(octave)) return null;

        const alter = writtenAlter(note);
        // Altezza reale dalla GRAFIA (non da `midi`, che su note importate può divergere).
        const midi = (octave + 1) * 12 + LETTER_PC[letter] + alter;

        type Cand = { pitch: string; alter: number; octave: number };
        const cands: Cand[] = [];
        const li = LETTERS.indexOf(letter as typeof LETTERS[number]);
        for (const delta of [-1, 1]) {
            const targetLetter = LETTERS[(li + delta + 7) % 7];
            const base = LETTER_PC[targetLetter];
            // L'ottava scritta è quella che tiene l'alterazione entro il doppio segno.
            for (const oct of [octave - 1, octave, octave + 1]) {
                const a = midi - ((oct + 1) * 12 + base);
                if (a < -2 || a > 2) continue;
                cands.push({ pitch: targetLetter, alter: a, octave: oct });
                break;
            }
        }
        if (cands.length === 0) return null;

        cands.sort((x, y) => Math.abs(x.alter) - Math.abs(y.alter));
        const best = cands[0];
        if (Math.abs(best.alter) > 2) return null;
        // Non proporre una scrittura più complicata di quella che c'è già.
        if (Math.abs(best.alter) > Math.abs(alter) + 1) return null;

        return {
            pitch: best.pitch,
            accidental: ALTER_TO_ACC[best.alter] ?? null,
            octave: best.octave,
            midi,
        };
    } catch {
        return null;
    }
}
