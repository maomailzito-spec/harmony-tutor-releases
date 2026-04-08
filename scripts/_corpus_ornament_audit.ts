/**
 * Count ornaments across the corpus to detect undesired side effects.
 */
import * as fs from 'fs';
import * as path from 'path';
import { applyHarmonyRules, getKeySignature } from '../src/utils/musicTheory';

const dir = 'tests';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.htp') || f.endsWith('.json'));

let totalEsc = 0, totalPass = 0, totalNeigh = 0, totalApp = 0, totalAnt = 0;
let filesWithEsc = 0;
const escFiles: string[] = [];

for (const f of files) {
    try {
        const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (!d.notes?.length) continue;
        const ks = getKeySignature(d.keySignatureRoot || 'C', 'Major');
        const ts = d.timeSignature || { numerator: 4, denominator: 4 };
        const res = applyHarmonyRules(
            d.notes, ks, d.keySignatureRoot || 'C', !!d.isMinorMode,
            d.analysisContexts || [], ts, d.doubleBarlineMeasures || [],
            d.ornamentOverrides || []
        );
        const notes = (res as any).analyzedNotes || res;
        let fe = 0;
        for (const n of notes as any[]) {
            if (!n || n.isRest) continue;
            if (n.isEscape) { totalEsc++; fe++; }
            if (n.isPassing) totalPass++;
            if (n.isNeighbor) totalNeigh++;
            if (n.isAppoggiatura) totalApp++;
            if (n.isAnticipation) totalAnt++;
        }
        if (fe > 0) { filesWithEsc++; escFiles.push(`${f} (${fe})`); }
    } catch { /* skip */ }
}

console.log('=== ORNAMENT TOTALS ACROSS CORPUS ===');
console.log(`Passing:      ${totalPass}`);
console.log(`Neighbor:     ${totalNeigh}`);
console.log(`Appoggiatura: ${totalApp}`);
console.log(`Anticipation: ${totalAnt}`);
console.log(`Escape:       ${totalEsc} (in ${filesWithEsc} files)`);
console.log(`\nFiles with escape tones:`);
for (const e of escFiles) console.log('  ' + e);
