import fs from 'node:fs';

import {
  applyHarmonyRules,
  getActiveNotesTimeline,
  getKeySignature,
  getRomanAnalysis,
} from '../src/utils/musicTheory';

const approxEq = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

const mod12 = (n: number) => ((n % 12) + 12) % 12;

const pcOf = (n: any): number | null => {
  if (!n || n.isRest) return null;
  if (Number.isFinite(n.midi)) return mod12(n.midi);
  if (typeof n.noteIndex === 'number' && Number.isFinite(n.noteIndex)) return mod12(n.noteIndex);
  return null;
};

const pcSetFromNotes = (notes: any[]): Set<number> => {
  const s = new Set<number>();
  for (const n of notes || []) {
    const pc = pcOf(n);
    if (pc == null) continue;
    s.add(pc);
  }
  return s;
};

const signatureFromNotes = (notes: any[]): string => {
  const pcs = [...pcSetFromNotes(notes)].sort((a, b) => a - b);
  return pcs.join('-');
};

const inferDiatonicTriadFromRoman = (roman: string, tonic: string, isMinor: boolean) => {
  const r = String(roman || '').trim();
  if (!r) return null;

  const noteNameToChromaticIndex: Record<string, number> = {
    C: 0,
    'C#': 1,
    Db: 1,
    D: 2,
    'D#': 3,
    Eb: 3,
    E: 4,
    F: 5,
    'F#': 6,
    Gb: 6,
    G: 7,
    'G#': 8,
    Ab: 8,
    A: 9,
    'A#': 10,
    Bb: 10,
    B: 11,
  };

  const tIdx = noteNameToChromaticIndex[String(tonic ?? '')];
  if (tIdx == null) return null;

  const scaleIntervals = isMinor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const romanMaj = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
  const romanMin = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];
  const romans = isMinor ? romanMin : romanMaj;

  const degree = romans.indexOf(r);
  if (degree < 0) return null;

  const rootPc = mod12(tIdx + scaleIntervals[degree]);
  const isDim = r.includes('°');
  const isMinTriad = !isDim && r === r.toLowerCase();
  const thirdInt = isMinTriad || isDim ? 3 : 4;
  const fifthInt = isDim ? 6 : 7;

  return {
    root: rootPc,
    third: mod12(rootPc + thirdInt),
    fifth: mod12(rootPc + fifthInt),
  };
};

const isSubset = (a: Set<number>, b: Set<number>) => {
  for (const x of a) if (!b.has(x)) return false;
  return true;
};

const main = () => {
  const fixturePath = process.argv[2] || './scripts/fixtures/appoggiature.json';
  const fx = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const beatsPerMeasure = fx.timeSignature.numerator * (4 / fx.timeSignature.denominator);

  const tonic = fx.keyTonic || fx.keySignatureRoot;
  const mode = fx.isMinorMode ? 'Minor' : 'Major';

  const keySignature = getKeySignature(fx.keySignatureRoot, mode);
  const res = applyHarmonyRules(
    fx.notes,
    keySignature,
    tonic,
    fx.isMinorMode,
    fx.analysisContexts || [],
    fx.timeSignature,
  );

  const timeline = getActiveNotesTimeline(res.analyzedNotes, fx.timeSignature);

  // Same idea as GrandStaffEditor: only onset events + note-off-only on strong beats.
  const timelineForLabels = (timeline || []).filter((ev: any, idx: number) => {
    if (!ev) return false;
    if (idx === 0) return true;

    const prev = timeline[idx - 1] as any;
    const prevIds = new Set<string>((prev?.notes || []).map((n: any) => String(n?.id ?? '')));
    const curNotes = (ev?.notes || []) as any[];

    const hasOnset = curNotes.some((n) => {
      const id = String(n?.id ?? '');
      return id && !prevIds.has(id);
    });
    if (hasOnset) return true;

    try {
      const curIds = new Set<string>(curNotes.map((n) => String(n?.id ?? '')).filter(Boolean));
      const removed = Array.from(prevIds).some((id) => id && !curIds.has(id));
      if (!removed) return false;

      const absBeat = Number(ev?.absBeat);
      if (!Number.isFinite(absBeat)) return false;
      const inMeasure = absBeat - Math.floor(absBeat / beatsPerMeasure) * beatsPerMeasure;
      const nearInt = (x: number) => Math.abs(x - Math.round(x)) < 1e-6;
      if (!nearInt(inMeasure)) return false;
      const beat0 = Math.round(inMeasure);
      const isStrong = beat0 === 0 || (fx.timeSignature.numerator >= 4 && beat0 === 2);
      return isStrong;
    } catch {
      return false;
    }
  });

  const lastStructuralByVoice = new Map<number, any>();
  let lastSig = '';
  let lastRoman = '';

  const out: Array<{ absBeat: number; roman: string; figures: string[]; sig: string; bassPc: number | null }> = [];

  for (const event of timelineForLabels) {
    const fullNotes = event.notes || [];

    const voiceSet = new Set<number>();
    for (const n of fullNotes) {
      if (!n || n.isRest) continue;
      voiceSet.add((n?.voice ?? 1) as number);
    }

    for (const v of Array.from(lastStructuralByVoice.keys())) {
      if (!voiceSet.has(v)) lastStructuralByVoice.delete(v);
    }

    const isNonChordToneAtLabelEvent = (n: any) => {
      if (!n || n.isRest) return true;
      const v = (n?.voice ?? 1) as number;
      if (v === 4) return false;
      return !!(n.isPassing || n.isNeighbor || n.isAnticipation || n.isAppoggiatura || n.isEscape);
    };

    for (const n of fullNotes) {
      if (!n || n.isRest) continue;
      const v = (n?.voice ?? 1) as number;
      if (isNonChordToneAtLabelEvent(n)) continue;
      lastStructuralByVoice.set(v, n);
    }

    const harmonicNotes = Array.from(lastStructuralByVoice.values()).filter(Boolean);
    const harmonicSig = signatureFromNotes(harmonicNotes);
    if (!harmonicSig || harmonicNotes.length < 2) continue;

    const bassNote = harmonicNotes
      .filter((n: any) => n && !n.isRest && Number.isFinite(n.midi))
      .slice()
      .sort((a: any, b: any) => (a.midi ?? 0) - (b.midi ?? 0))[0];
    const bassPc = bassNote && Number.isFinite(bassNote.midi) ? mod12(bassNote.midi) : null;

    if (lastSig === harmonicSig) {
      continue;
    }

    // Baseline roman from engine.
    let roman = '';
    let figures: string[] = [];
    const ra = getRomanAnalysis(harmonicNotes as any, tonic, fx.isMinorMode);
    if (ra?.roman) {
      roman = ra.roman;
      figures = ra.figures || [];
    }

    // Apply the same shell-continuation rule we added in GrandStaffEditor.
    if (roman && lastRoman && bassPc != null) {
      const pcs = pcSetFromNotes(harmonicNotes);
      if (!String(roman).includes('/') && pcs.size > 0 && pcs.size <= 2) {
        const prevTriad = inferDiatonicTriadFromRoman(lastRoman, tonic, fx.isMinorMode);
        if (prevTriad) {
          const triadSet = new Set<number>([prevTriad.root, prevTriad.third, prevTriad.fifth]);
          if (isSubset(pcs, triadSet) && triadSet.has(bassPc)) {
            roman = lastRoman;
            if (bassPc === prevTriad.root) figures = ['5'];
            else if (bassPc === prevTriad.third) figures = ['6'];
            else if (bassPc === prevTriad.fifth) figures = ['6', '4'];
          }
        }
      }
    }

    out.push({ absBeat: event.absBeat, roman, figures, sig: harmonicSig, bassPc });
    lastSig = harmonicSig;
    if (roman) lastRoman = roman;
  }

  const pick = (abs: number) => out.find((x) => approxEq(x.absBeat, abs));
  for (const abs of [0, 2, 3, 3.5]) {
    const v = pick(abs);
    console.log(abs, v ? `${v.roman} [${v.figures.join('/')}] sig=${v.sig} bassPc=${v.bassPc}` : '(no label)');
  }

  console.log('\nAll label events:');
  for (const row of out) {
    const beat = (row.absBeat % beatsPerMeasure) + 1;
    console.log(
      `${row.absBeat.toFixed(2)} (beat ${beat.toFixed(2)})  ${row.roman}${row.figures.length ? row.figures.join('/') : ''}  sig=${row.sig}`,
    );
  }
};

main();
