import type { AccidentalType, ClefType, KeySignature, StaffNote, TimeSignature } from '../types';

/**
 * Regola d'incisione degli ACCIDENTI DI MISURA: un'alterazione scritta prima nella stessa
 * misura, sulla stessa lettera e ottava e sullo stesso pentagramma, vale fino alla stanghetta
 * anche per le note che la seguono senza segno. Quando si crea o si sposta una nota, quindi,
 * l'ALTEZZA REALE non è quella dell'armatura ma quella portata dall'alterazione in corso.
 *
 * Estratta dal percorso di inserimento col mouse per essere usata anche dallo spostamento
 * delle note col trascinamento: la stessa nota, comunque ci arrivi, deve suonare uguale.
 *
 * Modifica `props` sul posto (noteIndex, midi, accidental) e lo restituisce.
 */
export function applyMeasureAccidentalCarry<T extends Record<string, any>>(
    props: T,
    args: {
        /** Note già presenti (stesso soggetto: SATB oppure la traccia di accompagnamento). */
        notes: StaffNote[];
        measureIndex: number;
        /** Tick della nota che si sta scrivendo: valgono solo le alterazioni PRIMA di questo. */
        beforeTick: number;
        clef: ClefType;
        keySignature: KeySignature;
        timeSignature: TimeSignature;
        ticksPerQuarter: number;
        /** Chiave di ripiego per note che non la dichiarano (nel SATB dipende dalla voce). */
        clefForVoice: (voice: any) => ClefType;
        /** Nota da ignorare nel confronto (quella che si sta spostando). */
        excludeId?: string;
    },
): T {
    try {
        const { notes, measureIndex, beforeTick, clef, keySignature, timeSignature, ticksPerQuarter, clefForVoice, excludeId } = args;

        const DIATONIC_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
        const normalizeAcc = (a: any): AccidentalType | null => {
            if (!a) return null;
            if (a === 'sharp' || a === '#' || a === '♯') return 'sharp';
            if (a === 'flat' || a === 'b' || a === '♭') return 'flat';
            if (a === 'natural' || a === 'n' || a === '♮') return 'natural';
            if (a === 'double-sharp' || a === '##' || a === '𝄪') return 'double-sharp';
            if (a === 'double-flat' || a === 'bb' || a === '𝄫') return 'double-flat';
            return null;
        };
        const pitchLetterOf = (pitch: any): string => {
            try {
                const s = String(pitch || '').trim();
                const m = /[A-Ga-g]/.exec(s);
                return (m ? m[0] : 'C').toUpperCase();
            } catch {
                return 'C';
            }
        };
        const keySigDefaultAccForLetter = (letter: string): AccidentalType => {
            const l = String(letter || '').toUpperCase();
            if (!l) return 'natural';
            if (keySignature.type === 'sharp' && keySignature.count > 0) {
                const sharpOrder = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
                return sharpOrder.slice(0, keySignature.count).includes(l) ? 'sharp' : 'natural';
            }
            if (keySignature.type === 'flat' && keySignature.count > 0) {
                const flatOrder = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
                return flatOrder.slice(0, keySignature.count).includes(l) ? 'flat' : 'natural';
            }
            return 'natural';
        };
        const accidentalFromPcForLetter = (pc: number, letter: string): AccidentalType => {
            const l = String(letter || '').toUpperCase();
            const base = DIATONIC_PC[l];
            if (base == null) return 'natural';
            const raw = (((Number(pc) % 12) + 12) % 12);
            const d = ((raw - base + 18) % 12) - 6;
            if (d === 1) return 'sharp';
            if (d === -1) return 'flat';
            if (d === 2) return 'double-sharp';
            if (d === -2) return 'double-flat';
            return 'natural';
        };
        const accOffset = (acc: AccidentalType): number => {
            switch (acc) {
                case 'sharp': return 1;
                case 'flat': return -1;
                case 'double-sharp': return 2;
                case 'double-flat': return -2;
                default: return 0;
            }
        };
        const startTickOf = (n: any): number => {
            const st = Number(n?.startTick);
            if (Number.isFinite(st)) return st;
            const m = Number(n?.measureIndex);
            const b = Number(n?.beat);
            const beatsPerMeasureLocal = timeSignature.numerator * (4 / timeSignature.denominator);
            if (Number.isFinite(m) && Number.isFinite(b)) {
                const absBeat = (m * beatsPerMeasureLocal) + (b - 1);
                return Math.round(absBeat * ticksPerQuarter);
            }
            return 0;
        };

        const letter = pitchLetterOf((props as any)?.pitch);
        const octave = Number((props as any)?.octave);
        const basePc = DIATONIC_PC[letter];
        // Skip measure accidental carry when applyAutoLeadingToneInMinor
        // (or applyActiveAccidental) already set an explicit accidental —
        // the carry logic would blindly overwrite the midi/noteIndex back
        // to the key-signature default.
        if (letter && Number.isFinite(octave) && basePc != null && !(props as any).explicitAccidental) {
            const relevant = (notes || [])
                .filter((n: any) => n && !n.isRest)
                .filter((n: any) => !excludeId || n.id !== excludeId)
                .filter((n: any) => Number(n.measureIndex) === Number(measureIndex))
                .filter((n: any) => {
                    const c = ((n as any).clefOverride || n.clef || clefForVoice(n.voice)) as ClefType;
                    return c === clef;
                })
                .filter((n: any) => startTickOf(n) < Number(beforeTick) - 1e-6)
                .slice()
                .sort((a: any, b: any) => startTickOf(a) - startTickOf(b) || Number(a.voice ?? 1) - Number(b.voice ?? 1));

            let stateAcc: AccidentalType = keySigDefaultAccForLetter(letter);
            for (const n of relevant) {
                const l2 = pitchLetterOf(n.pitch);
                const o2 = Number(n.octave);
                if (l2 !== letter || o2 !== octave) continue;
                const userAcc = normalizeAcc((n as any).userAccidental);
                const explicitAcc = normalizeAcc((n as any).explicitAccidental);
                const autoAcc = normalizeAcc((n as any).accidental);
                const derived = Number.isFinite(Number(n.noteIndex))
                    ? accidentalFromPcForLetter(Number(n.noteIndex), l2)
                    : 'natural';
                stateAcc = userAcc ?? explicitAcc ?? autoAcc ?? derived;
            }

            // Apply the carried accidental to the new note's pitch (without forcing glyph rendering).
            const desiredPcRaw = basePc + accOffset(stateAcc);
            // Avoid rare edge-cases like B# that would wrap across octaves in this data model.
            if (desiredPcRaw >= 0 && desiredPcRaw <= 11) {
                const desiredPc = desiredPcRaw;
                const desiredMidi = (octave + 1) * 12 + desiredPc;
                (props as any).noteIndex = desiredPc;
                (props as any).midi = desiredMidi;
                (props as any).accidental = stateAcc;
            }
        }
    } catch {
        // ignore
    }
    return props;
}
