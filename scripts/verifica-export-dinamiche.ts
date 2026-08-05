/**
 * Banco di prova: le dinamiche escono davvero nel MIDI e nel MusicXML?
 * Si esegue con:  npx tsx scripts/verifica-export-dinamiche.ts
 */
import { buildMidiFile } from '../src/utils/midiWriter';
import { exportMusicXML } from '../src/exporters/exportMusicXML';
import { velocityAtAbsBeat, type DynamicMark } from '../src/utils/dynamics';
import { TICKS_PER_QUARTER as TPQ } from '../src/constants';

let falliti = 0;
const ok = (cond: boolean, msg: string) => {
    console.log(`${cond ? '  ok  ' : '  NO  '} ${msg}`);
    if (!cond) falliti++;
};

// ── Brano di prova: 4 misure di 4/4, una semiminima per movimento al soprano ──
const notes: any[] = [];
for (let m = 0; m < 4; m++) {
    for (let b = 0; b < 4; b++) {
        notes.push({
            id: `n${m}-${b}`, pitch: 'C', octave: 5, midi: 72, voice: 1, clef: 'treble',
            duration: 'quarter', measureIndex: m, beat: b + 1,
            startTick: (m * 4 + b) * TPQ, durationTicks: TPQ, isRest: false,
        });
        notes.push({
            id: `b${m}-${b}`, pitch: 'C', octave: 3, midi: 48, voice: 4, clef: 'bass',
            duration: 'quarter', measureIndex: m, beat: b + 1,
            startTick: (m * 4 + b) * TPQ, durationTicks: TPQ, isRest: false,
        });
    }
}

// pp all'inizio · forcella di crescendo dalla 2ª alla 3ª misura · ff alla 3ª · sf sull'ultima
const dynamics: DynamicMark[] = [
    { kind: 'level', absBeat: 0, level: 'pp' },
    { kind: 'hairpin', fromAbsBeat: 4, toAbsBeat: 8, direction: 'cresc' },
    { kind: 'level', absBeat: 8, level: 'ff' },
    { kind: 'accent', absBeat: 14, label: 'sf' },
];

const progetto = {
    notes,
    timeSignature: { numerator: 4, denominator: 4 } as any,
    bpm: 90,
    midiType: 1 as const,
};

// ── 1. MIDI ───────────────────────────────────────────────────────────────
console.log('\nMIDI');

/** Rilegge i note-on di un file MIDI: [tick, canale, altezza, velocity]. */
function leggiNoteOn(bytes: Uint8Array): Array<{ tick: number; ch: number; midi: number; vel: number }> {
    const out: Array<{ tick: number; ch: number; midi: number; vel: number }> = [];
    let p = 14; // salta MThd
    while (p < bytes.length - 8) {
        const tag = String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
        const len = (bytes[p + 4] << 24) | (bytes[p + 5] << 16) | (bytes[p + 6] << 8) | bytes[p + 7];
        const start = p + 8, end = start + len;
        if (tag !== 'MTrk') break;
        let i = start, tick = 0, running = 0;
        while (i < end) {
            let delta = 0;
            for (;;) { const b = bytes[i++]; delta = (delta << 7) | (b & 0x7f); if (!(b & 0x80)) break; }
            tick += delta;
            let status = bytes[i];
            if (status & 0x80) { i++; running = status; } else { status = running; }
            if (status === 0xff) { const t = bytes[i++]; let l = 0; for (;;) { const b = bytes[i++]; l = (l << 7) | (b & 0x7f); if (!(b & 0x80)) break; } i += l; void t; continue; }
            const hi = status & 0xf0, ch = status & 0x0f;
            if (hi === 0x90) { const n = bytes[i++], v = bytes[i++]; if (v > 0) out.push({ tick, ch, midi: n, vel: v }); }
            else if (hi === 0x80) { i += 2; }
            else if (hi === 0xa0 || hi === 0xb0 || hi === 0xe0) { i += 2; }
            else if (hi === 0xc0 || hi === 0xd0) { i += 1; }
            else break;
        }
        p = end;
    }
    return out;
}

const conSegni = leggiNoteOn(buildMidiFile({ ...progetto, dynamics }));
const senzaSegni = leggiNoteOn(buildMidiFile({ ...progetto }));

ok(senzaSegni.length === notes.length, `senza segni: ${senzaSegni.length}/${notes.length} note-on`);
ok(senzaSegni.every(n => n.vel === 88), 'senza segni: tutte a 88 (il default storico, invariato)');
ok(conSegni.length === notes.length, `con segni: ${conSegni.length}/${notes.length} note-on`);

// Ogni note-on deve portare ESATTAMENTE la velocity che si sente in esecuzione.
const attesoPerTick = (tickMidi: number) => velocityAtAbsBeat(dynamics, tickMidi / 480);
const sbagliate = conSegni.filter(n => n.vel !== attesoPerTick(n.tick));
ok(sbagliate.length === 0, `con segni: ${conSegni.length - sbagliate.length}/${conSegni.length} velocity uguali all'esecuzione`);

const velAl = (beat: number) => conSegni.find(n => n.tick === beat * 480)!.vel;
ok(velAl(0) === 33, `pp all'inizio → velocity ${velAl(0)} (attesa 33)`);
ok(velAl(8) === 112, `ff alla 3ª misura → velocity ${velAl(8)} (attesa 112)`);
const salita = [velAl(4), velAl(5), velAl(6), velAl(7), velAl(8)];
ok(salita.every((v, i) => i === 0 || v > salita[i - 1]), `la forcella sale davvero: ${salita.join(' → ')}`);
ok(velAl(14) > velAl(13), `sf sull'ultima misura: ${velAl(13)} → ${velAl(14)}`);
// Le due voci devono ricevere lo stesso segno (le dinamiche valgono per tutte).
const sop = conSegni.filter(n => n.midi === 72), bas = conSegni.filter(n => n.midi === 48);
ok(sop.every((n, i) => n.vel === bas[i].vel), 'soprano e basso ricevono la stessa dinamica');

// ── 2. MusicXML ───────────────────────────────────────────────────────────
console.log('\nMusicXML');
const xml = exportMusicXML({
    notes,
    title: 'Prova dinamiche',
    keySignature: { type: 'sharp', count: 0 } as any,
    timeSignature: { numerator: 4, denominator: 4 } as any,
    dynamics,
});
const xmlSenza = exportMusicXML({
    notes,
    title: 'Prova dinamiche',
    keySignature: { type: 'sharp', count: 0 } as any,
    timeSignature: { numerator: 4, denominator: 4 } as any,
});

ok(xml.includes('<dynamics><pp/></dynamics>'), 'c\'è il pp');
ok(xml.includes('<dynamics><ff/></dynamics>'), 'c\'è il ff');
ok(xml.includes('<dynamics><sf/></dynamics>'), 'c\'è il sf');
ok(xml.includes('<wedge type="crescendo"/>'), 'c\'è l\'apertura della forcella');
ok(xml.includes('<wedge type="stop"/>'), 'c\'è la chiusura della forcella');
ok(xml.includes('<sound dynamics="37"/>'), 'il pp porta con sé il livello sonoro (33/90 → 37%)');
ok(!xmlSenza.includes('<dynamics>') && !xmlSenza.includes('<wedge'), 'senza segni il file resta come prima');

// La contabilità delle durate dentro ogni battuta: la corsia delle dinamiche non deve
// far sballare le posizioni (posizione mai negativa, e ogni voce riparte da zero).
function contabilita(x: string): { errori: string[] } {
    const errori: string[] = [];
    const misure = x.split('<measure ').slice(1);
    misure.forEach((mis, idx) => {
        let pos = 0, max = 0;
        const re = /<(forward|backup|note)>([\s\S]*?)<\/\1>/g;
        let mm: RegExpExecArray | null;
        while ((mm = re.exec(mis))) {
            const dur = Number((mm[2].match(/<duration>(\d+)<\/duration>/) || [])[1] || 0);
            const isAccordo = mm[1] === 'note' && /<chord\/>/.test(mm[2]);
            if (mm[1] === 'backup') pos -= dur;
            else if (!isAccordo) pos += dur;
            if (pos < -1e-6) errori.push(`misura ${idx + 1}: posizione negativa (${pos})`);
            max = Math.max(max, pos);
        }
        if (max !== 4 * TPQ) errori.push(`misura ${idx + 1}: la battuta arriva a ${max} invece di ${4 * TPQ}`);
    });
    return { errori };
}
const cont = contabilita(xml);
ok(cont.errori.length === 0, `contabilità delle battute: ${cont.errori.length ? cont.errori.join(' · ') : 'tutte piene e nessuna posizione negativa'}`);

// Il segno deve stare nella battuta giusta: il ff è all'inizio della 3ª.
const misura3 = xml.split('<measure number="3">')[1]?.split('</measure>')[0] || '';
ok(misura3.includes('<dynamics><ff/></dynamics>'), 'il ff sta nella 3ª battuta');
const misura2 = xml.split('<measure number="2">')[1]?.split('</measure>')[0] || '';
ok(misura2.includes('<wedge type="crescendo"/>'), 'la forcella si apre nella 2ª battuta');

console.log(falliti === 0 ? '\nTUTTO A POSTO\n' : `\n${falliti} CONTROLLI FALLITI\n`);
process.exit(falliti === 0 ? 0 : 1);
