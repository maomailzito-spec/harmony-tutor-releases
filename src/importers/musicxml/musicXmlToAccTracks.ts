/**
 * Da parti MusicXML a tracce di ACCOMPAGNAMENTO.
 *
 * Serve all'import "aggiungi al progetto": invece di rimappare il file sulle 4 voci del
 * corale (che azzera il progetto aperto), ogni parte diventa una traccia ACC, esattamente
 * come fa l'import MIDI. Le note arrivano già incise dal file (durate, punti, legature,
 * pause reali): qui non si quantizza né si normalizza nulla, si sistemano solo le VOCI e
 * si confezionano le tracce.
 */
import type { AccompanimentTrack, ClefType, KeySignature, StaffNote } from '../../types';
import type { MusicXMLPart } from './importMusicXML';
import { transposeMelody } from '../../utils/melodicTransforms';

function newTrackId(i: number): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `acc-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;
}

function newGroupId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `grp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Fusione di più parti in un unico grand staff: le voci vanno rinumerate, altrimenti due
 * parti diverse finirebbero entrambe in voce 1 e si sovrapporrebbero. Per ogni rigo
 * (chiave di violino / di basso) raccolgo le coppie (parte, voce) presenti e le rimappo
 * sulle voci di quel rigo — acuto 1-2, grave 3-4, la convenzione del "grand staff a voci":
 * 4 parti vocali → S,A nell'acuto e T,B nel grave (la chiave le ha già separate); un
 * pianoforte solo conserva le proprie due voci per rigo. Oltre la seconda si confluisce
 * nella seconda (come nell'import MIDI, che ammette 2 voci per rigo).
 */
function mergeParts(parts: MusicXMLPart[]): StaffNote[] {
    if (parts.length === 1) return parts[0].notes;

    const staffOf = (n: StaffNote): 'bass' | 'treble' => (n.clef === 'bass' ? 'bass' : 'treble');
    const slots = new Map<string, 1 | 2 | 3 | 4>();
    for (const staff of ['treble', 'bass'] as const) {
        const seen: string[] = [];
        parts.forEach((p, pi) => {
            for (const n of p.notes) {
                if (staffOf(n) !== staff) continue;
                const key = `${staff}|${pi}|${n.voice ?? 1}`;
                if (!seen.includes(key)) seen.push(key);
            }
        });
        const offset = staff === 'bass' ? 2 : 0;
        seen.forEach((key, idx) => slots.set(key, (offset + (idx === 0 ? 1 : 2)) as 1 | 2 | 3 | 4));
    }

    const merged = parts.flatMap((p, pi) => p.notes.map(n => {
        const v = slots.get(`${staffOf(n)}|${pi}|${n.voice ?? 1}`) ?? 1;
        return { ...n, voice: v } as StaffNote;
    }));
    merged.sort((a, b) => {
        const stA = Number((a as any).startTick ?? 0);
        const stB = Number((b as any).startTick ?? 0);
        if (stA !== stB) return stA - stB;
        if ((a.voice ?? 1) !== (b.voice ?? 1)) return (a.voice ?? 1) - (b.voice ?? 1);
        return (a.midi ?? 0) - (b.midi ?? 0);
    });
    return merged;
}

/**
 * STRUMENTO TRASPOSITORE → come si scrive e come suona.
 *
 * Il file dichiara `<transpose>`, cioè quanto va spostata l'altezza SCRITTA per ottenere
 * quella suonata. La chitarra vale un'ottava sotto: senza leggerlo il brano entrava
 * un'ottava sopra, dove nessuna chitarra arriva.
 *
 * Le ottave tonde diventano `octaveTranspose` della traccia — il meccanismo che c'è già,
 * quello della chiave di violino con l'8 sotto: la nota resta scritta dov'è e il suono
 * scende. Il resto (un clarinetto in Si♭ vale −2 semitoni) il programma non lo sa
 * rappresentare, quindi si trascrive: le note entrano in SUONI REALI, con la lettera
 * giusta e non solo l'altezza, che è ciò che `transposeMelody` in modo reale garantisce.
 *
 * Su grand staff `octaveTranspose` non esiste: lì l'ottava si trascrive come il resto.
 */
function applicaTraspozione(
    p: MusicXMLPart,
    notes: StaffNote[],
    grand: boolean,
    key: KeySignature,
): { notes: StaffNote[]; octaveTranspose: number } {
    const ottave = Number((p as any).transposeOctave) || 0;
    const resto = Number((p as any).transposeChromaticRest) || 0;
    if (ottave === 0 && resto === 0) return { notes, octaveTranspose: 0 };

    const daTrascrivere = resto + (grand ? ottave * 12 : 0);
    const trascritte = daTrascrivere !== 0
        ? transposeMelody(notes, key, { mode: 'real', amount: daTrascrivere })
        : notes;
    return { notes: trascritte, octaveTranspose: grand ? 0 : ottave };
}

/**
 * @param mode 'separate' = una traccia per parte (una parte pianistica a due righi resta
 *             comunque un grand staff); 'grandstaff' = tutte le parti fuse in una traccia
 *             sola su grand staff.
 * @param fallbackName nome per la traccia fusa quando non c'è quello di una parte sola
 *             (di norma il titolo del brano).
 * @param key  armatura del file: serve a trascrivere con la GRAFIA giusta le parti di
 *             strumenti traspositori non a ottave tonde.
 */
export function musicXmlPartsToAccTracks(
    parts: MusicXMLPart[],
    mode: 'separate' | 'grandstaff',
    fallbackName?: string,
    key: KeySignature = { type: 'sharp', count: 0 },
): AccompanimentTrack[] {
    const withNotes = parts.filter(p => p.notes.length > 0);
    if (withNotes.length === 0) return [];

    const base = {
        muted: false,
        visible: true,
        volume: 1,
    };
    // Strumento dichiarato dal file, quando c'è: 0 (pianoforte) solo come ripiego.
    const instrOf = (p?: MusicXMLPart | null): number =>
        (typeof p?.instrumentId === 'number' && p.instrumentId >= 0 && p.instrumentId <= 127) ? p.instrumentId : 0;

    if (mode === 'grandstaff' || withNotes.length === 1) {
        const single = withNotes.length === 1 ? withNotes[0] : null;
        // Una parte sola sta su grand staff solo se nel file ha DUE righi: un violoncello
        // (rigo unico in chiave di basso) deve restare un rigo singolo in chiave di basso.
        const grand = single ? single.hasSecondStaff : true;
        const clef: ClefType = single ? single.clef : 'treble';
        // Fondendo PIÙ parti la traspozione non può essere della traccia — ce n'è una
        // sola per tutte, e due strumenti traspositori diversi non ci starebbero: si
        // trascrive parte per parte, prima di fondere.
        const tr = single
            ? applicaTraspozione(single, single.notes, grand, key)
            : { notes: mergeParts(withNotes.map(p => ({ ...p, notes: applicaTraspozione(p, p.notes, true, key).notes }))), octaveTranspose: 0 };
        return [{
            id: newTrackId(0),
            name: (single?.name || '').trim() || (fallbackName || '').trim() || 'Importata',
            // Fondendo più parti il timbro è per forza uno solo: quello della prima.
            instrumentId: instrOf(single ?? withNotes[0]),
            notes: tr.notes,
            staffMode: grand ? 'grandstaff' : 'treble_only',
            // Il MusicXML porta le VOCI vere: su due righi conviene il "grand staff a voci"
            // (1-2 acuto, 3-4 grave), che incide ogni voce col suo gambo invece di fondere
            // tutto in un blocco. Su rigo singolo l'opzione non esiste.
            ...(grand ? { voiced: true } : { clef }),
            ...(tr.octaveTranspose !== 0 ? { octaveTranspose: tr.octaveTranspose } : {}),
            ...base,
        }];
    }

    // Più parti su righi distinti: condividono un groupId così l'analisi armonica ACC le
    // legge come un tutt'uno (stessa scelta dell'import MIDI multi-traccia).
    const groupId = newGroupId();
    return withNotes.map((p, i) => {
        const grand = p.hasSecondStaff;
        // CHIAVE TRASPOSITRICE (il tenore dei corali: violino con l'8 sotto). Il file
        // porta l'altezza SUONATA; il programma scrive l'altezza LETTA e traspone per il
        // suono. Quindi le note vanno alzate di un'ottava e la traccia riceve la sua
        // chiave 8vb: senza, il tenore compariva un'ottava più in basso di come lo scrive
        // chi ha esportato il file — un Sol di seconda riga finiva sotto il rigo con due
        // tagli addizionali, mentre il suono era giusto.
        const ott = Number((p as any).clefOctaveChange) || 0;
        const note = (ott === 0 || grand)
            ? p.notes
            : p.notes.map(n => (n.isRest ? n : ({
                ...n,
                midi: Number(n.midi ?? 60) - ott * 12,
                octave: Number(n.octave ?? 4) - ott,
                ...(Number.isFinite(Number((n as any).position)) ? { position: Number((n as any).position) - ott * 7 } : {}),
            } as StaffNote)));
        // …e SOPRA a questo lo strumento traspositore, che è un'altra cosa (vedi
        // applicaTraspozione). Le due si sommano: una chiave 8vb su uno strumento che
        // già traspone resta leggibile perché l'ottava è una sola grandezza.
        const tr = applicaTraspozione(p, note, grand, key);
        return {
            id: newTrackId(i),
            name: p.name.trim() || `Parte ${i + 1}`,
            instrumentId: instrOf(p),
            notes: tr.notes,
            staffMode: grand ? 'grandstaff' : 'treble_only',
            ...(grand ? { voiced: true } : { clef: p.clef }),
            ...((ott !== 0 || tr.octaveTranspose !== 0) && !grand
                ? { octaveTranspose: ott + tr.octaveTranspose }
                : {}),
            groupId,
            ...base,
        } as AccompanimentTrack;
    });
}
