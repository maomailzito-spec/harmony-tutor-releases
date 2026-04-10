import * as fs from 'fs';
import * as path from 'path';
import { applyHarmonyRules, getKeySignature } from './src/utils/musicTheory';

const snapDir = './scripts/fixtures';
const testDir = './tests';
const snapFiles = fs.readdirSync(snapDir).filter(f => f.startsWith('snap-'));

interface Diff { file: string; labelChanges: number; totalLabels: number; changes: string[] }
const diffs: Diff[] = [];

for (const sf of snapFiles) {
  try {
    const snap = JSON.parse(fs.readFileSync(path.join(snapDir, sf), 'utf-8'));
    const htpName = snap.name;
    // Find .htp file
    const htpCandidates = fs.readdirSync(testDir).filter(f => f.endsWith('.htp'));
    const htpFile = htpCandidates.find(f => {
      const base = f.replace('.htp', '');
      return base === htpName || sf.includes(base.toLowerCase().replace(/\s+/g, '-'));
    });
    if (!htpFile) continue;
    const htpPath = path.join(testDir, htpFile);
    
    const proj = JSON.parse(fs.readFileSync(htpPath, 'utf-8'));
    const notes = proj.notes || [];
    if (notes.length === 0) continue;
    const tonic = snap.keyTonic || snap.keySignatureRoot || proj.keySignatureRoot || 'C';
    const isMinor = snap.isMinorMode !== undefined ? Boolean(snap.isMinorMode) : Boolean(proj.isMinorMode);
    const ts = snap.timeSignature || proj.timeSignature || { numerator: 4, denominator: 4 };
    const keySig = getKeySignature(tonic, isMinor ? 'Minor' : 'Major');
    const contexts = snap.analysisContexts || proj.analysisContexts || [];
    const ornOverrides = proj.ornamentOverrides || [];
    
    const res = applyHarmonyRules(notes as any, keySig as any, tonic, isMinor, contexts, ts as any, undefined, ornOverrides);
    const analyzed: any[] = (res as any).analyzedNotes || notes;
    const violations: any[] = (res as any).violations || [];
    
    // Old expects
    const expects: { absBeat: number; roman: string }[] = snap.expects || [];
    if (expects.length === 0) continue;
    
    // Build new label map (from violations with ruleId matching roman analysis)
    // Actually, the snap comparison is done via labels at absBeats.
    // We need to replicate what the regression script does...
    // For simplicity, just count ornament flag differences
    const oldOrnCount = expects.filter(e => {
      const r = e.roman || '';
      return r === 'P' || r === 'v' || r === 's' || r === 'App' || r === 'Ant' || r === 'S';
    }).length;
    
    const newOrn = analyzed.filter((n: any) => 
      n.isPassing || n.isNeighbor || n.isEscape || n.isAppoggiatura || n.isAnticipation || n.isSuspension
    );
    
    // Count how many notes changed ornament status
    const ornBefore = new Set<string>();
    const ornAfter = new Set<string>();
    for (const n of analyzed) {
      const key = `${n.measureIndex}:${n.beat}:${n.voice}`;
      if (n.isPassing || n.isNeighbor || n.isEscape || n.isAppoggiatura) {
        ornAfter.add(key);
      }
    }
    
    // Approximate: difference = abs(newOrn.length - oldOrnCount)
    // Better: just count newly flagged ornaments
    const added = newOrn.length;
    if (added > 0) {
      const changes = newOrn.slice(0, 5).map((n: any) => {
        const type = n.isPassing ? 'P' : n.isNeighbor ? 'N' : n.isEscape ? 'E' : n.isAppoggiatura ? 'App' : '?';
        return `m${n.measureIndex} b${n.beat} v${n.voice} ${n.pitch}${n.octave} [${type}]`;
      });
      diffs.push({ file: htpFile, labelChanges: added, totalLabels: notes.length, changes });
    }
  } catch (e) {
    // skip
  }
}

diffs.sort((a, b) => b.labelChanges - a.labelChanges);
console.log('Files ranked by number of ornamental flags (most changes = most visible difference):');
console.log('');
for (const d of diffs.slice(0, 15)) {
  console.log(`${d.file}: ${d.labelChanges} ornaments / ${d.totalLabels} notes`);
  for (const c of d.changes) console.log(`    ${c}`);
}
