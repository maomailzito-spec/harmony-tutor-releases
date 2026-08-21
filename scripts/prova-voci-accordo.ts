import { vociDeterminate, vociInUso, type VoiceNum } from '../src/utils/voiceFromChord';

const NOME: Record<number, string> = { 1: 'S', 2: 'A', 3: 'T', 4: 'B' };

/** Righi del grand staff: normale (S,A sopra — T,B sotto) e parti strette (S,A,T sopra). */
const RIGHI = (strette: boolean, partCount = 4) => {
    const m = new Map<string, VoiceNum[]>();
    for (const v of vociInUso(partCount)) {
        const r = strette ? (v === 4 ? 'bass' : 'treble') : (v <= 2 ? 'treble' : 'bass');
        const a = m.get(r); if (a) a.push(v); else m.set(r, [v]);
    }
    for (const a of m.values()) a.sort((x, y) => x - y);
    return m;
};

const n = (id: string, midi: number, rigo: string) => ({ id, midi, rigo });
const p = (id: string, voice: number, rigo: string) => ({ id, isRest: true, voice, rigo });

const casi: Array<[string, any[], Map<string, VoiceNum[]>]> = [
    ['SOLO IL TENORE sul rigo di basso (una nota: indecidibile)', [n('t', 52, 'bass')], RIGHI(false)],
    ['tenore + basso, scritti in quest ordine', [n('t', 52, 'bass'), n('b', 41, 'bass')], RIGHI(false)],
    ['basso + tenore, ordine inverso', [n('b', 41, 'bass'), n('t', 52, 'bass')], RIGHI(false)],
    ['tenore basso sul rigo giu, soprano solo su quello su', [n('t', 52, 'bass'), n('b', 41, 'bass'), n('s', 72, 'treble')], RIGHI(false)],
    ['accordo intero', [n('s', 72, 'treble'), n('a', 67, 'treble'), n('t', 52, 'bass'), n('b', 41, 'bass')], RIGHI(false)],
    ['una nota sul rigo giu + pausa di tenore: determinata', [n('b', 41, 'bass'), p('r', 3, 'bass')], RIGHI(false)],
    ['PARTI STRETTE: tre note sul rigo su, una giu', [n('x', 72, 'treble'), n('y', 69, 'treble'), n('z', 65, 'treble'), n('b', 41, 'bass')], RIGHI(true)],
    ['PARTI STRETTE: solo il basso (rigo con una voce sola)', [n('b', 41, 'bass')], RIGHI(true)],
    ['tre parti (1-2-4): due note sul rigo su', [n('x', 72, 'treble'), n('y', 64, 'treble')], RIGHI(false, 3)],
];

for (const [titolo, els, righi] of casi) {
    const r = vociDeterminate(els, righi);
    const riga = els.filter((e: any) => !e.isRest)
        .sort((a: any, b: any) => b.midi - a.midi)
        .map((e: any) => `${e.id}(${e.midi},${e.rigo})→${r.voci.has(e.id) ? NOME[r.voci.get(e.id)!] : 'neutra'}`)
        .join('  ');
    const pause = els.filter((e: any) => e.isRest).map((e: any) => `${e.id}→${NOME[e.voice]}`).join(' ');
    console.log(`${titolo}\n   ${riga}${pause ? '   [pause: ' + pause + ']' : ''}\n`);
}
