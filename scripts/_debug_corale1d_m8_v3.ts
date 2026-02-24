/**
 * Debug script v3: Replicate useHarmonyLabels hook's lastStructural logic
 * to find exactly what suppresses V/V label at m8 b4 in Corale 1D Bach.
 *
 * Runs via: npx tsx scripts/_debug_corale1d_m8_v3.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  getActiveNotesTimeline,
  getRomanAnalysis,
  identifyChordCandidates,
  computeFiguredBassFromNotes,
  FIGURED_BASS_UI_OPTIONS,
} from '../src/utils/musicTheory';
import {
  filterTimelineForHarmonyLabels,
  structuralNotes,
} from '../src/utils/harmonyLabelPipeline';

// ─── Load score ───
const jsonPath = path.resolve(__dirname, 'Corale 1D Bach.json');
const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const notes: any[] = raw.notes || [];
const ts = raw.timeSignature || { numerator: 4, denominator: 4 };
const currentTonic = String(raw.tonic || raw.key || 'C');
const isMinorMode = !!raw.isMinor;
const beatsPerMeasure = ts.numerator * (4 / ts.denominator); // 4 for 4/4

console.log(`Tonic: ${currentTonic} | Minor: ${isMinorMode} | BPM: ${beatsPerMeasure}`);

// ─── Apply harmony rules (same as the hook calls applyHarmonyRules in the component) ───
// The hook receives `analyzedNotes` which is the output of applyHarmonyRules.
// For this debug we use the raw notes with harmony flags already applied.
// If the notes already have isPassing/isNeighbor flags, use them as-is.

const analyzedNotes = notes; // Already analyzed in saved JSON

// ─── Build timeline ───
const rawTimeline = getActiveNotesTimeline(analyzedNotes, ts, []);
const timelineForLabels = filterTimelineForHarmonyLabels(rawTimeline, ts, 0);

console.log(`\nRaw timeline events: ${rawTimeline.length}`);
console.log(`Filtered timeline events: ${timelineForLabels.length}`);

// ─── isStrongPulseInMeasure ───
function isStrongPulseInMeasure(inMeasureBeats0: number): boolean {
  const beat0 = Math.round(inMeasureBeats0 * 1e6) / 1e6;
  if (beat0 === 0) return true;
  if (ts.numerator >= 4 && beat0 === 2) return true;
  // compound meter checks skipped (4/4 is not compound)
  return false;
}

// ─── signatureFromNotes (same as hook) ───
function signatureFromNotes(notesArr: any[]): string {
  const pcs = new Set<number>();
  for (const n of (notesArr || [])) {
    if (!n || n.isRest) continue;
    const ni = typeof n.noteIndex === 'number' ? Number(n.noteIndex) : NaN;
    const mi = typeof n.midi === 'number' ? Number(n.midi) : NaN;
    const pc = Number.isFinite(ni) ? (((ni % 12) + 12) % 12) : Number.isFinite(mi) ? (((mi % 12) + 12) % 12) : null;
    if (pc == null) continue;
    pcs.add(pc);
  }
  return [...pcs].sort((a, b) => a - b).join('-');
}

// ─── isNonChordToneAtLabelEvent (simplified version matching hook logic) ───
function isNonChordToneAtLabelEvent(n: any, absBeat: number): boolean {
  if (!n) return true;
  if (n.isRest) return true;
  // User ornament override
  if (n.ornamentOverride && n.ornamentOverride !== 'structural') return true;

  const v = (n?.voice ?? 1) as number;
  if (v === 4) {
    const isBassOrnFlag = !!(n.isPassing || n.isEscape || n.isNeighbor || n.isAnticipation || n.isAppoggiatura);
    if (!isBassOrnFlag) return false; // Keep structural bass
    // Bass ornament: check duration and weak beat
    const durMap: any = { whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25 };
    let dur = durMap[n.duration || 'quarter'] || 1;
    if (n.isDotted) dur *= 1.5;
    if (n.isTriplet) dur *= 2 / 3;
    const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
    const weak = !isStrongPulseInMeasure(inMeasure);
    if (weak && dur <= 1.01) return true; // Remove short weak-beat bass ornament
    return false;
  }

  // Non-bass voices
  const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
  const isStrongBeat = isStrongPulseInMeasure(inMeasure);
  const hasNctFlag = !!(n.isAnticipation || n.isAppoggiatura || (n.isNeighbor && isStrongBeat));
  // If no NCT flag for anticipation/appoggiatura/neighbor, check passing/escape
  if (!hasNctFlag) {
    if (n.isPassing || n.isEscape) return true; // Passing/escape are NCTs
    // If no NCT flag at all: structural
    return false;
  }
  // hasNctFlag is true - the hook has rescue logic for chord candidates
  // For simplicity, we'll treat as NCT (the detailed rescue rarely changes things)
  return true; // NCT
}

// ─── Replicate the hook's lastStructural logic ───
const lastStructural = new Map<number, any>(); // voice -> last structural note
let prevSig = '';
let prevRoman = '';

console.log('\n=== Processing timeline events (lastStructural trace) ===');

for (const event of timelineForLabels) {
  const absBeat = Number(event.absBeat);
  const fullNotes = (event.notes || []).filter((n: any) => n && !n.isRest);
  
  // Check if this is m8 range (absBeat 28-32) or near beat 31
  const isM8 = absBeat >= 28 && absBeat <= 32;
  const isTarget = Math.abs(absBeat - 31) < 0.1;
  
  // Update lastStructural (same as hook L1210-1248)
  for (const n of fullNotes) {
    const v = (n.voice ?? 1) as number;
    
    // isNonChordToneAtLabelEvent check
    if (isNonChordToneAtLabelEvent(n, absBeat)) {
      if (isM8) {
        console.log(`  [m8] absBeat=${absBeat.toFixed(2)} voice=${v}: ${n.pitch}${n.octave} → NCT (skipped from lastStructural)`);
      }
      continue;
    }
    
    if (isM8) {
      const prev = lastStructural.get(v);
      const prevDesc = prev ? `${prev.pitch}${prev.octave}` : '(none)';
      console.log(`  [m8] absBeat=${absBeat.toFixed(2)} voice=${v}: ${n.pitch}${n.octave} → STRUCTURAL (was: ${prevDesc})`);
    }
    lastStructural.set(v, n);
  }
  
  // Build harmonicNotes (same as hook L1252)
  const harmonicNotes = Array.from(lastStructural.values()).filter((n: any) => {
    if (!n) return false;
    if (n.ornamentOverride && n.ornamentOverride !== 'structural') return false;
    return true;
  });
  
  // baseHarmonicNotes fallback chain (same as hook L1290)
  const baseHarmonicNotes = (harmonicNotes.length >= 2) ? harmonicNotes : fullNotes;
  
  const harmonicSig = signatureFromNotes(baseHarmonicNotes);
  const fullSig = signatureFromNotes(fullNotes);
  
  if (isTarget) {
    console.log(`\n  *** TARGET BEAT: absBeat=${absBeat.toFixed(2)} ***`);
    console.log(`  fullNotes: [${fullNotes.map((n: any) => `${n.pitch}${n.octave}(v${n.voice},midi${n.midi})`).join(', ')}]`);
    console.log(`  harmonicNotes (from lastStructural): [${harmonicNotes.map((n: any) => `${n.pitch}${n.octave}(v${n.voice},midi${n.midi})`).join(', ')}]`);
    console.log(`  baseHarmonicNotes: [${baseHarmonicNotes.map((n: any) => `${n.pitch}${n.octave}(v${n.voice})`).join(', ')}]`);
    console.log(`  harmonicSig: "${harmonicSig}" | prevSig: "${prevSig}" | fullSig: "${fullSig}"`);
    console.log(`  harmonicSig === prevSig ? ${harmonicSig === prevSig}`);
    
    // Check guard at L1370
    if (!harmonicSig || baseHarmonicNotes.length < 2) {
      console.log(`  → SUPPRESSED at L1370: !harmonicSig (${!harmonicSig}) || len<2 (${baseHarmonicNotes.length})`);
    }
    
    // Check shouldSuppressAsCompletion
    // (simplified - mainly checks same bass + same PCs minus bass)
    
    // Check same-harmony suppression at L1490
    const hasHiddenChange = !!(fullSig && prevSig && fullSig !== prevSig);
    console.log(`  hasHiddenChange: ${hasHiddenChange} (fullSig="${fullSig}" !== prevSig="${prevSig}")`);
    
    if (!hasHiddenChange && prevSig === harmonicSig) {
      console.log(`  → WOULD BE SUPPRESSED at L1490: prevSig === harmonicSig`);
    } else {
      console.log(`  → NOT suppressed at L1490`);
    }
    
    // Compute roman
    const analysisNotes = harmonicNotes; // simplified
    const r = getRomanAnalysis(analysisNotes as any, currentTonic, isMinorMode);
    console.log(`  getRomanAnalysis(harmonicNotes) → roman: "${r?.roman || ''}" figures: ${JSON.stringify(r?.figures || [])}`);
    
    const rFull = getRomanAnalysis(fullNotes as any, currentTonic, isMinorMode);
    console.log(`  getRomanAnalysis(fullNotes) → roman: "${rFull?.roman || ''}" figures: ${JSON.stringify(rFull?.figures || [])}`);
    
    const rStruct = getRomanAnalysis(structuralNotes(fullNotes) as any, currentTonic, isMinorMode);
    console.log(`  getRomanAnalysis(structuralNotes) → roman: "${rStruct?.roman || ''}" figures: ${JSON.stringify(rStruct?.figures || [])}`);
  }
  
  // Update tracking variables
  if (harmonicSig && baseHarmonicNotes.length >= 2) {
    // Compute roman for tracking
    const r = getRomanAnalysis(harmonicNotes as any, currentTonic, isMinorMode);
    if (isM8) {
      console.log(`  [m8] absBeat=${absBeat.toFixed(2)}: sig="${harmonicSig}" roman="${r?.roman || ''}" prevSig="${prevSig}" → ${prevSig === harmonicSig ? 'SAME (suppress)' : 'DIFF (show)'}`);
    }
    prevSig = harmonicSig;
    prevRoman = r?.roman || '';
  }
}

console.log('\n=== Done ===');
