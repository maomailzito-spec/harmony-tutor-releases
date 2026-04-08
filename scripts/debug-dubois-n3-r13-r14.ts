import fs from 'node:fs';

import {
  applyHarmonyRules,
  getKeySignature,
} from '../src/utils/musicTheory';

type AnyObj = Record<string, any>;

function beatsPerMeasure(ts: AnyObj): number {
  return Number(ts?.numerator) * (4 / Number(ts?.denominator));
}

function absBeatOfNote(n: AnyObj, bpm: number): number {
  const mi = Number(n?.measureIndex ?? 0);
  const beat = Number(n?.beat ?? 1);
  return mi * bpm + (beat - 1);
}

function mod12(x: number): number {
  const m = x % 12;
  return m < 0 ? m + 12 : m;
}

function isP5OrP8(intMod12: number): boolean {
  return intMod12 === 7 || intMod12 === 0;
}

function accToOffset(acc: any): number {
  const a = String(acc ?? '').toLowerCase();
  if (a === 'sharp' || a === '#') return 1;
  if (a === 'flat' || a === 'b') return -1;
  if (a === 'double-sharp' || a === 'doublesharp' || a === 'x') return 2;
  if (a === 'double-flat' || a === 'doubleflat' || a === 'bb') return -2;
  return 0;
}

function spelledMidi(n: AnyObj): number | null {
  try {
    const pitchRaw = String(n?.pitch ?? '').trim();
    const octave = Number(n?.octave);
    if (!pitchRaw || !Number.isFinite(octave)) return null;

    const letter = pitchRaw[0]?.toUpperCase();
    const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    if (base[letter] == null) return null;

    const accFromPitch = pitchRaw.includes('#') ? 1 : pitchRaw.includes('b') ? -1 : 0;
    const accField = (n?.explicitAccidental ?? n?.accidental ?? null);
    const acc = accField != null ? accToOffset(accField) : accFromPitch;

    const midi = 12 * (octave + 1) + base[letter] + acc;
    return Number.isFinite(midi) ? midi : null;
  } catch {
    return null;
  }
}

function effMidi(n: AnyObj): number | null {
  const sp = spelledMidi(n);
  if (sp != null) return sp;
  const m = Number(n?.midi);
  return Number.isFinite(m) ? m : null;
}

function main(): void {
  const file = './tests/Dubois n3 p12.htp';
  const proj = JSON.parse(fs.readFileSync(file, 'utf8')) as AnyObj;
  const ts = proj.timeSignature;
  const bpm = beatsPerMeasure(ts);

  const tonic = String(proj.keySignatureRoot || 'C');
  const isMinor = !!proj.isMinorMode;
  const ks = getKeySignature(tonic, isMinor ? 'Minor' : 'Major');

  const res: any = applyHarmonyRules(
    proj.notes || [],
    ks as any,
    tonic,
    isMinor,
    proj.analysisContexts || [],
    ts,
  );

  const analyzed = (res.analyzedNotes || proj.notes || []) as AnyObj[];
  const byId = new Map<string, AnyObj>();
  for (const n of analyzed) {
    if (n?.id) byId.set(String(n.id), n);
  }

  const viol = (res.violations || []) as AnyObj[];
  const picked = viol.filter((v) => v && (v.ruleId === 'R-13' || v.ruleId === 'R-14'));

  const items = picked
    .map((v) => {
      const ids = Array.isArray(v.noteIds) ? (v.noteIds as any[]).map(String) : [];
      const notes = ids.map((id) => byId.get(id)).filter(Boolean) as AnyObj[];
      const abs = notes.length ? Math.min(...notes.map((n) => absBeatOfNote(n, bpm))) : Number.NaN;
      const mi0 = Number.isFinite(abs) ? Math.floor(abs / bpm) : null;
      const beat = Number.isFinite(abs) ? (abs - (mi0 as number) * bpm + 1) : null;

      // For R-14, compute whether the *arrival* outer-voices interval is P5/P8.
      let arrivalOuter: AnyObj | null = null;
      try {
        if (v.ruleId === 'R-14') {
          const sopB = notes.find((n) => Number(n?.voice) === 1 && Math.abs(Number(n?.beat) - Number(beat)) < 1.01);
          const basB = notes.find((n) => Number(n?.voice) === 4 && Math.abs(Number(n?.beat) - Number(beat)) < 1.01);
          if (sopB && basB) {
            const s = effMidi(sopB);
            const b = effMidi(basB);
            if (s != null && b != null) {
              const int = mod12(Math.abs(s - b));
              arrivalOuter = { intMod12: int, isP5orP8: isP5OrP8(int) };
            }
          }
        }
      } catch {
        // ignore
      }

      const voicePairs = [] as AnyObj[];
      // noteIds are stored as [aVoice1,bVoice1,aVoice2,bVoice2,...] for these rules.
      for (let i = 0; i + 1 < notes.length; i += 2) {
        const a = notes[i];
        const b = notes[i + 1];
        if (!a || !b) continue;
        const ma = effMidi(a);
        const mb = effMidi(b);
        voicePairs.push({
          voice: a.voice,
          a: `${a.pitch}${a.octave}`,
          b: `${b.pitch}${b.octave}`,
          d: ma != null && mb != null ? Math.sign(mb - ma) : null,
          aMidi: ma,
          bMidi: mb,
        });
      }

      return {
        ruleId: v.ruleId,
        severity: v.severity,
        absBeat: Number.isFinite(abs) ? Math.round(abs * 1000) / 1000 : null,
        uiMeasure: mi0 != null ? (mi0 + 1) : null,
        beat,
        description: v.description,
        arrivalOuter,
        voicePairs,
      };
    })
    .sort((a, b) => (a.absBeat ?? 0) - (b.absBeat ?? 0));

  const byMeasure: Record<string, AnyObj[]> = {};
  for (const it of items) {
    const k = String(it.uiMeasure ?? 'null');
    byMeasure[k] = byMeasure[k] || [];
    byMeasure[k].push(it);
  }

  console.log(
    JSON.stringify(
      {
        meta: {
          file,
          tonic,
          isMinor,
          ts,
          totalViolations: viol.length,
          r13: items.filter((x) => x.ruleId === 'R-13').length,
          r14: items.filter((x) => x.ruleId === 'R-14').length,
        },
        byMeasure,
      },
      null,
      2,
    ),
  );
}

main();
