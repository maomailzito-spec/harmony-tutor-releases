/**
 * Migration script: corregge lo spelling delle note in un file .htp/.json.
 *
 * Problema risolto: alcuni file vecchi del corpus hanno note salvate con
 * `pitch+accidental` inconsistente col `midi`. Esempio: pitch="C",
 * explicitAccidental=null, midi=61 (= C#). Il vecchio motore PC-based
 * "mascherava" il problema; il refactor spelling-first lo espone.
 *
 * Strategia di respell (key-aware):
 *   1. Se pitch+accidental del json è già coerente con midi → no change.
 *   2. Altrimenti deriva spelling preferito dal midi + key signature:
 *      - sharp-side key (default per E/A/B/F#/C# maj/min, G/D maj, etc.)
 *        → preferisce C#, D#, F#, G#, A# (e B# / E# se cross-letter)
 *      - flat-side key (F maj, Bb/Eb/Ab/Db/Gb maj, D/G/C/F min)
 *        → preferisce Db, Eb, Gb, Ab, Bb (e Cb / Fb se cross-letter)
 *   3. Aggiorna `pitch`, `explicitAccidental`, e potenzialmente `octave`
 *      (per gestire enarmonici cross-octave come B#3 ≡ C4).
 *
 * USAGE:
 *   tsx scripts/respell-notes-file.ts <file.htp> [--dry-run] [--no-backup]
 *
 * --dry-run    Mostra il diff senza scrivere il file.
 * --no-backup  Non crea file .bak (default crea file.bak).
 */
import fs from 'node:fs';
import path from 'node:path';

// ── Spelling tables ────────────────────────────────────────────────────────

const LETTER_TO_NATURAL_PC: Record<string, number> = {
    C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

// Sharp-side preferred spelling per PC (within-letter; no cross-letter B#/E#/etc.)
const SHARP_SIDE_SPELLING: Array<{ pitch: string; acc: string | null }> = [
    { pitch: 'C', acc: null },     // pc 0
    { pitch: 'C', acc: 'sharp' },  // pc 1
    { pitch: 'D', acc: null },     // pc 2
    { pitch: 'D', acc: 'sharp' },  // pc 3
    { pitch: 'E', acc: null },     // pc 4
    { pitch: 'F', acc: null },     // pc 5
    { pitch: 'F', acc: 'sharp' },  // pc 6
    { pitch: 'G', acc: null },     // pc 7
    { pitch: 'G', acc: 'sharp' },  // pc 8
    { pitch: 'A', acc: null },     // pc 9
    { pitch: 'A', acc: 'sharp' },  // pc 10
    { pitch: 'B', acc: null },     // pc 11
];

const FLAT_SIDE_SPELLING: Array<{ pitch: string; acc: string | null }> = [
    { pitch: 'C', acc: null },     // pc 0
    { pitch: 'D', acc: 'flat' },   // pc 1
    { pitch: 'D', acc: null },     // pc 2
    { pitch: 'E', acc: 'flat' },   // pc 3
    { pitch: 'E', acc: null },     // pc 4
    { pitch: 'F', acc: null },     // pc 5
    { pitch: 'G', acc: 'flat' },   // pc 6
    { pitch: 'G', acc: null },     // pc 7
    { pitch: 'A', acc: 'flat' },   // pc 8
    { pitch: 'A', acc: null },     // pc 9
    { pitch: 'B', acc: 'flat' },   // pc 10
    { pitch: 'B', acc: null },     // pc 11
];

function preferFlats(keyTonic: string, isMinor: boolean): boolean {
    const t = keyTonic.trim();
    if (t.includes('b')) return true;
    if (t.includes('#')) return false;
    if (isMinor) return ['D', 'G', 'C', 'F'].includes(t);
    return t === 'F';
}

function accidentalToSemis(acc: string | null | undefined): number {
    if (acc == null) return 0;
    const s = String(acc).trim();
    if (s === 'sharp' || s === '#' || s === '♯') return 1;
    if (s === 'flat' || s === 'b' || s === '♭') return -1;
    if (s === 'double-sharp' || s === '##' || s === 'dblsharp' || s === '𝄪' || s.toLowerCase() === 'x') return 2;
    if (s === 'double-flat' || s === 'bb' || s === 'dblflat' || s === '𝄫') return -2;
    return 0;
}

function isSpellingCoherent(note: any): boolean {
    const midi = Number(note.midi);
    if (!Number.isFinite(midi)) return true;
    const pitch = String(note.pitch || '').toUpperCase().charAt(0);
    const nat = LETTER_TO_NATURAL_PC[pitch];
    if (nat == null) return true;
    const acc = accidentalToSemis(note.userAccidental ?? note.explicitAccidental ?? note.accidental);
    const expectedPc = ((nat + acc) % 12 + 12) % 12;
    const actualPc = ((midi % 12) + 12) % 12;
    return expectedPc === actualPc;
}

function respellNote(note: any, keyTonic: string, isMinor: boolean): any {
    const midi = Number(note.midi);
    if (!Number.isFinite(midi)) return note;
    const pc = ((midi % 12) + 12) % 12;
    const table = preferFlats(keyTonic, isMinor) ? FLAT_SIDE_SPELLING : SHARP_SIDE_SPELLING;
    const choice = table[pc];

    // Octave: derive from midi minus accidental semitones.
    // The C-based midi formula: midi = (octave + 1) * 12 + naturalSemi + accSemi.
    // So octave = floor((midi - accSemi) / 12) - 1, but we need to handle
    // wrap (e.g. B#3 has midi=60 but octave should be 3 not 4).
    const accSemi = accidentalToSemis(choice.acc);
    const octave = Math.floor((midi - accSemi) / 12) - 1;

    return {
        ...note,
        pitch: choice.pitch,
        explicitAccidental: choice.acc,         // canonical: explicit, may be null
        accidental: choice.acc ?? undefined,    // legacy alias
        userAccidental: undefined,              // clear stale user override
        octave,
        // noteIndex = pc — keep coherent with midi
        noteIndex: pc,
    };
}

// ── Main ────────────────────────────────────────────────────────────────────

function processFile(filePath: string, opts: { dryRun: boolean; noBackup: boolean }) {
    const raw = fs.readFileSync(filePath, 'utf8');
    let data: any;
    try {
        data = JSON.parse(raw);
    } catch (e) {
        console.error(`✗ ${filePath}: not valid JSON (${(e as Error).message})`);
        return;
    }

    const keyTonic = String(data.keySignatureRoot || data.keyTonic || 'C').trim();
    const isMinor = !!data.isMinorMode;
    const notes = Array.isArray(data.notes) ? data.notes : [];

    let changeCount = 0;
    const changes: Array<{ before: string; after: string; midi: number; loc: string }> = [];

    for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        if (!n || n.isRest) continue;
        if (isSpellingCoherent(n)) continue;
        const before = formatNoteSummary(n);
        const respelled = respellNote(n, keyTonic, isMinor);
        const after = formatNoteSummary(respelled);
        if (before === after) continue;
        notes[i] = respelled;
        changeCount++;
        changes.push({
            before, after, midi: n.midi,
            loc: `m${(n.measureIndex ?? 0) + 1}b${n.beat ?? 1} v${n.voice ?? '?'}`,
        });
    }

    console.log(`\n${filePath}`);
    console.log(`  key: ${keyTonic} ${isMinor ? 'minor' : 'major'} (preferFlats=${preferFlats(keyTonic, isMinor)})`);
    console.log(`  notes total: ${notes.filter((n: any) => n && !n.isRest).length}, respelled: ${changeCount}`);

    if (changeCount > 0) {
        console.log(`  changes (first 20):`);
        for (const c of changes.slice(0, 20)) {
            console.log(`    ${c.loc}  midi=${c.midi}  ${c.before}  →  ${c.after}`);
        }
        if (changes.length > 20) console.log(`    … ${changes.length - 20} more`);
    }

    if (changeCount === 0 || opts.dryRun) {
        if (opts.dryRun && changeCount > 0) console.log(`  (dry-run — no file written)`);
        return;
    }

    if (!opts.noBackup) {
        const backupPath = filePath + '.bak';
        fs.writeFileSync(backupPath, raw);
        console.log(`  backup: ${backupPath}`);
    }
    data.notes = notes;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`  ✓ written ${filePath}`);
}

function formatNoteSummary(n: any): string {
    const pitch = n.pitch || '?';
    const acc = n.userAccidental ?? n.explicitAccidental ?? n.accidental;
    const accStr = acc == null ? '' : `(${acc})`;
    return `${pitch}${accStr}/oct${n.octave}`;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const noBackup = args.includes('--no-backup');
const files = args.filter(a => !a.startsWith('--'));

if (files.length === 0) {
    console.error('Usage: tsx scripts/respell-notes-file.ts <file.htp|.json> [...] [--dry-run] [--no-backup]');
    process.exit(1);
}

for (const f of files) {
    if (!fs.existsSync(f)) {
        console.error(`✗ ${f}: not found`);
        continue;
    }
    const stat = fs.statSync(f);
    if (stat.isDirectory()) {
        const entries = fs.readdirSync(f).filter(e => e.endsWith('.htp') || e.endsWith('.json'));
        for (const e of entries) processFile(path.join(f, e), { dryRun, noBackup });
    } else {
        processFile(f, { dryRun, noBackup });
    }
}
