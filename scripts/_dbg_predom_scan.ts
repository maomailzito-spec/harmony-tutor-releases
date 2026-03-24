import { applyHarmonyRules } from '../src/utils/musicTheory';
import fs from 'node:fs';
import path from 'node:path';

const testDir = 'tests';
const files = fs.readdirSync(testDir).filter(f => f.endsWith('.htp'));

let hitCount = 0;
for (const file of files) {
    try {
        const data = JSON.parse(fs.readFileSync(path.join(testDir, file), 'utf-8'));
        const ts = data.timeSignature || { numerator: 4, denominator: 4 };
        const result = applyHarmonyRules(
            data.notes || [],
            data.keySignatureRoot || 'C',
            data.keySignatureRoot || 'C',
            Boolean(data.isMinorMode),
            data.analysisContexts || [],
            ts,
            data.doubleBarlineMeasures,
            data.ornamentOverrides,
            data.harmonyOverrides,
        );
        const ov = (result as any).autoHarmonyLabelOverrides || [];
        if (ov.length > 0) {
            hitCount++;
            console.log(`\n${file}: ${ov.length} override(s)`);
            for (const o of ov) {
                console.log(`  ab=${o.absBeat} roman=${o.roman} fig=${JSON.stringify(o.figures)}`);
            }
        }
    } catch (e: any) {
        // skip broken files
    }
}
console.log(`\n=== Total: ${hitCount} files with overrides out of ${files.length} ===`);
