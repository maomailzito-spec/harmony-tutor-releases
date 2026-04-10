import * as fs from 'fs';
import * as path from 'path';
import { applyHarmonyRules, getKeySignature } from './src/utils/musicTheory';

const snapDir = './scripts/fixtures';
const testDir = './tests';
const files = fs.readdirSync(snapDir).filter(f => f.startsWith('snap-'));

interface Diff { file: string; added: number; removed: number; total: number; noteCount: number; }
const diffs: Diff[] = [];

for (const snapFile of files) {
  try {
    const snap = JSON.parse(fs.readFileSync(path.join(snapDir, snapFile), 'utf-8'));
    const htpName = snap.source;
    if (!htpName) continue;
    const htpPath = path.join(testDir, htpName);
    if (!fs.existsSync(htpPath)) continue;

    const proj = JSON.parse(fs.readFileSync(htpPath, 'utf-8'));
    const notes = proj.notes || [];
    const tonic = proj.keySignatureRoot || 'C';
    const isMinor = Boolean(proj.isMinorMode);
    const ts = proj.timeSignature || { top: 4, bottom: 4 };
    const keySig = getKeySignature(tonic, isMinor ? 'Minor' : 'Major');
    const contexts = proj.analysisContexts || [];
    const ornOverrides = proj.ornamentOverrides || [];
    const res = applyHarmonyRules(notes as any, keySig as any, tonic, isMinor, contexts, ts as any, undefined, ornOverrides);
    const analyzed: any[] = (res as any).analyzedNotes || notes;

    // Compare labels
    const oldLabels: Record<string, string> = {};
    for (const lbl of (snap.labels || [])) {
      oldLabels[`${lbl.measure}:${lbl.beat}`] = lbl.roman || '';
    }

    // Count new ornaments vs old
    const oldOrnIds = new Set((snap.ornaments || []).map((o: any) => o.noteId));
    const newOrnIds = new Set(
      analyzed
        .filter((n: any) => n.isPassing || n.isNeighbor || n.isEscape || n.isAppoggiatura)
        .map((n: any) => n.id)
    );
    const added = [...newOrnIds].filter(id => !oldOrnIds.has(id)).length;
    const removed = [...oldOrnIds].filter(id => !newOrnIds.has(id)).length;
    const total = added + removed;
    if (total > 0) diffs.push({ file: htpName, added, removed, total, noteCount: notes.length });
  } catch (e) {
    // skip
  }
}

diffs.sort((a, b) => b.total - a.total);
console.log('Top 15 files with most ornament changes:');
for (const d of diffs.slice(0, 15)) {
  console.log(`  ${d.file}: +${d.added} new ornaments, -${d.removed} lost (${d.total} total, ${d.noteCount} notes)`);
}
console.log(`\nTotal files with changes: ${diffs.length}/${files.length}`);
