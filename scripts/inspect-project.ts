/**
 * Ispettore di un progetto .htp — diagnostica strutturale, non musicale.
 *
 * Uso:  npx tsx scripts/inspect-project.ts "percorso/del/file.htp" [--measure N]
 *
 * Con `--measure N` (numero di battuta come si vede a schermo, da 1) elenca TUTTE le note
 * di quella battuta con il contenitore di appartenenza: è il modo diretto per vedere se
 * una pausa è finita sul SATB invece che sulla traccia.
 *
 * Risponde alle domande che servono quando "una nota finisce dove non dovrebbe" o
 * "la traccia non si seleziona":
 *  · dove VIVE ogni nota (SATB o quale traccia ACC);
 *  · id DUPLICATI (dentro un contenitore e fra contenitori) — un id ripetuto rompe
 *    selezione ed editing, perché le ricerche per id trovano l'altra nota;
 *  · misure TROPPO PIENE o TROPPO VUOTE rispetto al tempo in chiave, per voce/rigo
 *    (è così che una misura "diventa di 5/4");
 *  · buchi (gap) non coperti da pause;
 *  · campi mancanti/incoerenti (measureIndex, startTick, durata dichiarata vs reale).
 */
import { readFileSync } from 'node:fs';

const TPQ = 960;

type AnyNote = Record<string, any>;

const DURATION_BEATS: Record<string, number> = {
    whole: 4, half: 2, quarter: 1, eighth: 0.5,
    sixteenth: 0.25, 'thirty-second': 0.125, 'sixty-fourth': 0.0625,
};

function labelTicks(n: AnyNote): number {
    const base = DURATION_BEATS[String(n.duration)] ?? 1;
    let beats = base * (n.isDotted ? 1.5 : 1);
    if (n.isTriplet) beats *= 2 / 3;
    if (n.isDuplet) beats *= 3 / 2;
    return Math.round(beats * TPQ);
}

function main() {
    const file = process.argv[2];
    if (!file) {
        console.error('Uso: npx tsx scripts/inspect-project.ts <file.htp>');
        process.exit(1);
    }
    const proj = JSON.parse(readFileSync(file, 'utf8'));

    const ts = proj.timeSignature || { numerator: 4, denominator: 4 };
    const tsChanges: AnyNote[] = Array.isArray(proj.timeSignatureChanges) ? proj.timeSignatureChanges : [];
    const tsAt = (mi: number) => {
        let cur = ts;
        for (const c of [...tsChanges].sort((a, b) => (a.measureIndex ?? 0) - (b.measureIndex ?? 0))) {
            if ((c.measureIndex ?? 0) <= mi) cur = c; else break;
        }
        return cur;
    };
    const ticksPerMeasure = (mi: number) => {
        const t = tsAt(mi);
        return Math.round(TPQ * t.numerator * (4 / t.denominator));
    };

    const satb: AnyNote[] = Array.isArray(proj.notes) ? proj.notes : [];
    const tracks: AnyNote[] = Array.isArray(proj.accompanimentTracks) ? proj.accompanimentTracks : [];

    console.log(`file: ${file}`);
    console.log(`tempo: ${ts.numerator}/${ts.denominator}  cambi: ${tsChanges.length ? JSON.stringify(tsChanges) : 'nessuno'}`);
    console.log(`tonalità: ${proj.keySignatureRoot}${proj.isMinorMode ? ' (minore)' : ''}   staffSystemMode: ${proj.staffSystemMode}   bpm: ${proj.bpm}`);
    console.log(`SATB: ${satb.length} note   tracce ACC: ${tracks.length}`);
    for (const t of tracks) {
        console.log(`  · "${t.name}" id=${t.id} staffMode=${t.staffMode} voiced=${!!t.voiced} clef=${t.clef ?? '-'} drum=${!!t.isDrum} visible=${t.visible} muted=${t.muted} group=${t.groupId ?? '-'} note=${(t.notes || []).length}`);
    }

    // ── id duplicati (dentro e fra i contenitori) ──────────────────────────────
    const owner = new Map<string, string[]>();
    const add = (n: AnyNote, where: string) => {
        const k = String(n.id);
        if (!owner.has(k)) owner.set(k, []);
        owner.get(k)!.push(where);
    };
    satb.forEach(n => add(n, 'SATB'));
    tracks.forEach((t, i) => (t.notes || []).forEach((n: AnyNote) => add(n, `ACC#${i} "${t.name}"`)));
    const dups = [...owner.entries()].filter(([, w]) => w.length > 1);
    console.log(`\n=== id DUPLICATI: ${dups.length}`);
    for (const [id, where] of dups.slice(0, 20)) console.log(`  ${id} → ${where.join(' + ')}`);
    if (dups.length > 20) console.log(`  … e altri ${dups.length - 20}`);

    // ── riempimento delle misure, per contenitore e per (voce, chiave) ─────────
    const checkFill = (label: string, notes: AnyNote[]) => {
        type Key = string;
        const byStream = new Map<Key, Map<number, AnyNote[]>>();
        for (const n of notes) {
            const k = `v${n.voice ?? 0}/${n.clef ?? 'treble'}`;
            const mi = Number(n.measureIndex ?? 0);
            if (!byStream.has(k)) byStream.set(k, new Map());
            const m = byStream.get(k)!;
            if (!m.has(mi)) m.set(mi, []);
            m.get(mi)!.push(n);
        }
        const problems: string[] = [];
        for (const [k, byMeasure] of byStream) {
            for (const [mi, ns] of byMeasure) {
                const cap = ticksPerMeasure(mi);
                // Le note di un ACCORDO (stesso attacco) non sommano: conto per attacco.
                const byOnset = new Map<number, AnyNote[]>();
                for (const n of ns) {
                    const st = Number(n.startTick ?? 0);
                    if (!byOnset.has(st)) byOnset.set(st, []);
                    byOnset.get(st)!.push(n);
                }
                const onsets = [...byOnset.keys()].sort((a, b) => a - b);
                let sum = 0;
                for (const st of onsets) {
                    sum += Math.max(...byOnset.get(st)!.map(n => Number(n.durationTicks ?? labelTicks(n))));
                }
                if (sum !== cap) {
                    problems.push(`    mis.${mi + 1} ${k}: ${(sum / TPQ).toFixed(3)} movimenti su ${(cap / TPQ).toFixed(3)} (${sum > cap ? 'TROPPO PIENA' : 'incompleta'}) — ${ns.length} note`);
                }
                // etichetta di durata ≠ durata reale (slitta il playback)
                for (const n of ns) {
                    const lt = labelTicks(n);
                    const dt = Number(n.durationTicks ?? lt);
                    if (Math.abs(lt - dt) > 2) {
                        problems.push(`    mis.${mi + 1} ${k}: label "${n.duration}${n.isDotted ? '.' : ''}"=${lt}t ma durationTicks=${dt}t (id ${n.id})`);
                    }
                }
            }
        }
        console.log(`\n=== ${label}: misure irregolari: ${problems.length}`);
        problems.slice(0, 40).forEach(p => console.log(p));
        if (problems.length > 40) console.log(`    … e altre ${problems.length - 40}`);
    };

    // ── dump di una singola battuta (--measure N, 1-based come a schermo) ─────
    const mArgIdx = process.argv.indexOf('--measure');
    if (mArgIdx !== -1) {
        const mi = Math.max(0, Math.trunc(Number(process.argv[mArgIdx + 1] ?? 1)) - 1);
        const cap = ticksPerMeasure(mi);
        console.log(`\n=== BATTUTA ${mi + 1} (capienza ${(cap / TPQ).toFixed(3)} movimenti, ${tsAt(mi).numerator}/${tsAt(mi).denominator})`);
        const dump = (label: string, notes: AnyNote[]) => {
            const ns = notes.filter(n => Number(n.measureIndex ?? -1) === mi)
                .sort((a, b) => Number(a.startTick ?? 0) - Number(b.startTick ?? 0) || Number(a.voice ?? 0) - Number(b.voice ?? 0));
            if (ns.length === 0) return;
            console.log(`  ${label}: ${ns.length} note`);
            for (const n of ns) {
                const kind = n.isRest ? 'PAUSA' : `${n.pitch}${n.accidental && n.accidental !== 'natural' ? `(${n.accidental})` : ''}${n.octave}`;
                console.log(`    v${n.voice ?? 0} ${String(n.clef ?? '').padEnd(7)} ${String(kind).padEnd(12)} ${n.duration}${n.isDotted ? '.' : ''}${n.isTriplet ? ' (3)' : ''} start=${n.startTick} dur=${n.durationTicks} beat=${n.beat} id=${n.id}`);
            }
        };
        dump('SATB', satb);
        tracks.forEach((t, i) => dump(`ACC#${i} "${t.name}"`, t.notes || []));
        return;
    }

    checkFill('SATB', satb);
    tracks.forEach((t, i) => checkFill(`ACC#${i} "${t.name}"`, t.notes || []));

    // ── campi mancanti ────────────────────────────────────────────────────────
    const bad = (notes: AnyNote[], label: string) => {
        const missing = notes.filter(n => !Number.isFinite(n.startTick) || !Number.isFinite(n.measureIndex) || !n.duration);
        if (missing.length) {
            console.log(`\n=== ${label}: ${missing.length} note con campi mancanti (startTick/measureIndex/duration)`);
            missing.slice(0, 10).forEach(n => console.log(`    ${JSON.stringify(n).slice(0, 200)}`));
        }
    };
    bad(satb, 'SATB');
    tracks.forEach((t, i) => bad(t.notes || [], `ACC#${i} "${t.name}"`));
}

main();
