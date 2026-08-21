import { conMemoriaDellAccordo, accordoConLeNoteRecuperate } from '../src/utils/chordMemory';

/** Accordo di partenza: Do3 Mi3 Sol3 Do4, con la grafia scelta dall'utente. */
const accordo = [
    { id: 'n1', midi: 48, pitch: 'C', octave: 3 },
    { id: 'n2', midi: 52, pitch: 'E', octave: 3 },
    { id: 'n3', midi: 55, pitch: 'G', octave: 3 },
    { id: 'n4', midi: 60, pitch: 'C', octave: 4 },
];

/** Finto pattern: suona solo le note agli indici dati, come farebbe applyAccPattern. */
const applica = (base: any[], indici: number[]) => {
    const suonate = indici.map(i => ({ ...base[i], id: `e${Math.random().toString(36).slice(2, 6)}`, startTick: i * 120 }));
    return conMemoriaDellAccordo(suonate, base);
};

const mostra = (etichetta: string, note: any[]) => {
    const suonano = [...new Set(note.map(n => n.midi))].sort((a, b) => a - b);
    const messeDaParte = [...new Set((note[0]?.chordDropped ?? []).map((d: any) => d.midi))];
    console.log(`${etichetta.padEnd(34)} suonano: ${suonano.join(' ').padEnd(14)} messe da parte: ${messeDaParte.join(' ') || '—'}`);
};

console.log('accordo di partenza:', accordo.map(n => n.midi).join(' '), '\n');

// Onda stretta: tocca solo le tre note gravi.
let scritte = applica(accordo, [0, 1, 2, 1]);
mostra('ondulato (4 posti)', scritte);

// Il pattern dopo riparte dall'accordo INTERO, non da cio' che suonava.
let ricostruito = accordoConLeNoteRecuperate(scritte);
console.log('  accordo ricostruito:'.padEnd(36), ricostruito.map(n => n.midi).join(' '),
    ricostruito.length === 4 ? '  ← integro' : '  ← PERSA UNA NOTA');
console.log('  grafia della nota recuperata:'.padEnd(36), `${ricostruito[3].pitch}${ricostruito[3].octave}`, '\n');

scritte = applica(ricostruito, [0, 1, 2, 3]);
mostra('→ arpeggio ascendente', scritte);
ricostruito = accordoConLeNoteRecuperate(scritte);
console.log('  accordo ricostruito:'.padEnd(36), ricostruito.map(n => n.midi).join(' '), '\n');

scritte = applica(ricostruito, [3, 2, 1, 0]);
mostra('→ arpeggio discendente', scritte);
console.log();

// Catena: due figure di fila che scartano note DIVERSE.
scritte = applica(accordo, [0, 1, 2, 1]);          // mette da parte il 60
scritte = applica(accordoConLeNoteRecuperate(scritte), [1, 2, 3, 2]); // ora scarta il 48
mostra('ondulato → figura senza il basso', scritte);
console.log('  accordo ricostruito:'.padEnd(36), accordoConLeNoteRecuperate(scritte).map(n => n.midi).join(' '),
    '  ← ereditata anche la nota messa da parte prima');
