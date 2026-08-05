/**
 * Banco di prova dei CAMBI D'ARMATURA a metà brano.
 * Si esegue con:  npx tsx scripts/verifica-armature.ts
 */
import { keyAtMeasure, keyChangeAtMeasure, normalizeKeyChanges } from '../src/utils/keySignatureChanges';

let falliti = 0;
const ok = (cond: boolean, msg: string) => {
    console.log(`${cond ? '  ok  ' : '  NO  '} ${msg}`);
    if (!cond) falliti++;
};

const base = { root: 'C', isMinor: false };
const cambi = [
    { measureIndex: 8, root: 'D', isMinor: false },
    { measureIndex: 16, root: 'Bb', isMinor: false },
];

console.log("\nQual è l'armatura QUI");
ok(keyAtMeasure(base, cambi, 0).root === 'C', "prima del primo cambio vale quella d'impianto");
ok(keyAtMeasure(base, cambi, 7).root === 'C', "fino alla battuta prima resta la vecchia");
ok(keyAtMeasure(base, cambi, 8).root === 'D', 'dalla battuta del cambio vale la nuova');
ok(keyAtMeasure(base, cambi, 12).root === 'D', 'e continua a valere');
ok(keyAtMeasure(base, cambi, 20).root === 'Bb', 'il secondo cambio prende il posto del primo');
ok(keyAtMeasure(base, [], 5).root === 'C', "senza cambi vale sempre quella d'impianto");

console.log('\nChe cosa si disegna');
const c8 = keyChangeAtMeasure(base, cambi, 8);
ok(!!c8 && c8.nuova === 'D' && c8.daAnnullare === 'C', `alla battuta 8: nuova ${c8?.nuova}, si annulla ${c8?.daAnnullare}`);
const c16 = keyChangeAtMeasure(base, cambi, 16);
ok(!!c16 && c16.nuova === 'Bb' && c16.daAnnullare === 'D',
   `alla 16 si annullano i diesis della 8, non l'armatura d'impianto (${c16?.daAnnullare})`);
ok(keyChangeAtMeasure(base, cambi, 9) === null, 'dove non cambia niente non si disegna niente');
ok(keyChangeAtMeasure(base, [{ measureIndex: 4, root: 'C', isMinor: false }], 4) === null,
   "un «cambio» verso la stessa armatura non è un cambio e non si disegna");

console.log('\nRipulitura');
const doppi = normalizeKeyChanges([
    { measureIndex: 8, root: 'D' }, { measureIndex: 8, root: 'A' }, { measureIndex: 2, root: 'F' },
] as any);
ok(doppi.length === 2 && doppi[0].measureIndex === 2, 'i cambi escono in ordine di battuta');
ok(doppi[1].root === 'A', "due cambi sulla stessa battuta: vince l'ultimo scritto");
ok(normalizeKeyChanges([{ measureIndex: -3, root: 'D' }, { measureIndex: 1 } as any]).length === 0,
   'battute impossibili e cambi senza tonalità si scartano');

// Il minore ha la stessa armatura del suo relativo maggiore: si scrive col maggiore.
console.log('\nMinore');
const inMinore = keyAtMeasure({ root: 'C', isMinor: false }, [{ measureIndex: 4, root: 'F', isMinor: true }], 4);
ok(inMinore.root === 'F' && inMinore.isMinor, 'un Re minore si scrive armatura di Fa + minore');

// ── Nel file: MusicXML e MIDI ─────────────────────────────────────────────
console.log('\nEsportazione');
import { exportMusicXML } from '../src/exporters/exportMusicXML';
import { buildMidiFile } from '../src/utils/midiWriter';
import { TICKS_PER_QUARTER as TPQ } from '../src/constants';

const note: any[] = [];
for (let m = 0; m < 3; m++) for (let b = 0; b < 4; b++) note.push({
    id: `n${m}${b}`, pitch: 'C', octave: 5, midi: 72, voice: 1, clef: 'treble',
    duration: 'quarter', measureIndex: m, beat: b + 1, startTick: (m * 4 + b) * TPQ, durationTicks: TPQ,
});
const xml = exportMusicXML({
    notes: note, title: 'x', keySignature: { type: 'sharp', count: 0 } as any,
    timeSignature: { numerator: 4, denominator: 4 } as any,
    keySignatureRoot: 'C',
    keySignatureChanges: [{ measureIndex: 1, root: 'Ab', isMinor: false }],
});
const misura = (n: number) => xml.split(`<measure number="${n}">`)[1].split('</measure>')[0];
ok(/<fifths>0<\/fifths>/.test(misura(1)), "la prima battuta dichiara l'armatura d'impianto");
ok(/<key>[\s\S]*<fifths>-4<\/fifths>/.test(misura(2)), 'la battuta del cambio dichiara la nuova (La bemolle = −4)');
ok(!/<key>/.test(misura(3)), 'le battute dopo non ridichiarano niente');

const senza = exportMusicXML({
    notes: note, title: 'x', keySignature: { type: 'sharp', count: 0 } as any,
    timeSignature: { numerator: 4, denominator: 4 } as any, keySignatureRoot: 'C',
});
ok((senza.match(/<key>/g) || []).length === 1, 'senza cambi il file dichiara una sola armatura');

console.log('\nMIDI');
const leggiArmature = (bytes: Uint8Array): Array<{ sf: number; minore: number }> => {
    const out: Array<{ sf: number; minore: number }> = [];
    for (let i = 0; i < bytes.length - 4; i++) {
        if (bytes[i] === 0xff && bytes[i + 1] === 0x59 && bytes[i + 2] === 0x02) {
            const sf = bytes[i + 3] > 127 ? bytes[i + 3] - 256 : bytes[i + 3];
            out.push({ sf, minore: bytes[i + 4] });
        }
    }
    return out;
};
const midi = buildMidiFile({
    notes: note, timeSignature: { numerator: 4, denominator: 4 } as any, bpm: 90, midiType: 1,
    keySignatures: [{ measureIndex: 0, fifths: 0, isMinor: false }, { measureIndex: 1, fifths: -4, isMinor: false }],
});
const armature = leggiArmature(midi);
ok(armature.length === 2, `il file MIDI dichiara ${armature.length} armature`);
ok(armature[0].sf === 0 && armature[1].sf === -4, `d'impianto ${armature[0]?.sf}, poi ${armature[1]?.sf} (La bemolle)`);
ok(leggiArmature(buildMidiFile({ notes: note, timeSignature: { numerator: 4, denominator: 4 } as any, bpm: 90, midiType: 1 })).length === 0,
   'senza armature dichiarate il file resta com era');

console.log(falliti === 0 ? '\nTUTTO A POSTO\n' : `\n${falliti} CONTROLLI FALLITI\n`);
process.exit(falliti === 0 ? 0 : 1);
