import { comeSiScrive, comeSuona, radiceScritta, trasposizioneDaId } from '../src/utils/transposingInstruments';

const SIGLA = (c: { lettera: string; alterazione: number; octave: number }) =>
    c.lettera + (c.alterazione > 0 ? '#'.repeat(c.alterazione) : c.alterazione < 0 ? 'b'.repeat(-c.alterazione) : '') + c.octave;

const nota = (lettera: string, alt: number, octave: number) => ({
    lettera, octave,
    midi: (octave + 1) * 12 + ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as any)[lettera] + alt,
});

const casi: Array<[string, string, Array<[string, number, number]>]> = [
    ['Tromba/clarinetto in Si♭', 'bb', [['C', 0, 4], ['B', -1, 3], ['A', -1, 3], ['F', 1, 4]]],
    ['Corno in Fa', 'f', [['C', 0, 4], ['F', 0, 3], ['E', -1, 4]]],
    ['Sax contralto in Mi♭', 'eb_alto', [['C', 0, 4], ['E', -1, 4]]],
    ['Clarinetto in La', 'a', [['C', 0, 4], ['A', 0, 3]]],
    ['Sax tenore in Si♭', 'bb_tenore', [['C', 0, 4]]],
];

for (const [titolo, id, note] of casi) {
    const t = trasposizioneDaId(id);
    const righe = note.map(([l, a, o]) => {
        const suona = nota(l, a, o);
        const scritto = comeSiScrive(suona, t);
        const ritorno = comeSuona({ lettera: scritto.lettera, octave: scritto.octave, midi: scritto.midi }, t);
        const ok = ritorno.midi === suona.midi && ritorno.lettera === l;
        return `${SIGLA({ lettera: l, alterazione: a, octave: o })} suona → si scrive ${SIGLA(scritto)}${ok ? '' : '   ← ANDATA/RITORNO ROTTO'}`;
    });
    console.log(`${titolo}  (${t.semitoni} semitoni, ${t.gradi} gradi)`);
    for (const r of righe) console.log('   ' + r);
    console.log();
}

console.log('ARMATURE (quella che legge lo strumento)');
for (const [id, nome] of [['bb', 'Si♭'], ['f', 'Fa'], ['eb_alto', 'Mi♭']] as Array<[string, string]>) {
    const t = trasposizioneDaId(id);
    const righe = ['C', 'F', 'Bb', 'Eb', 'D'].map(r => {
        return `${r} → ${radiceScritta(r, t)}`;
    });
    console.log(`   strumento in ${nome}:  ${righe.join('   ')}`);
}
