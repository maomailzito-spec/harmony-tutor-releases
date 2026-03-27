# 4 Rendering Bugs — Working Notes (14 feb 2026)

## Workspace
`/Users/Erminio/Desktop/harmony-tutor-locale`
Build: `npm run build`

## Files
- `src/components/GrandStaffEditor.tsx` — 8,271 lines (main component)
- `src/hooks/useEditorZoom.ts` — 199 lines
- `src/hooks/useHarmonyLabels.ts` — 3,233 lines
- `docs/_session-memo-2026-02-14.md` — session memo from Phase 2

## 4 BUGS TO FIX

### Bug 1: Bass-Tenor collision on seconds (lower staff)
- When bass (voice 4) and tenor (voice 3) are a 2nd apart, noteheads overlap
- **NO existing `setXShift` logic** in GrandStaffEditor.tsx
- Comment at L7267-7268: "No dynamic collision detection" — refers to figured bass label positioning, NOT note collision
- Need to find where VexFlow StaveNotes are created for voices 3 and 4
- FIX: Detect when voices 3+4 are a 2nd apart → apply `staveNote.setXShift()` on one voice
- SEARCH in VexFlow rendering: "StaveNote", "voice === 3", "voice === 4", "stemDirection"

### Bug 2: Note-Rest anti-collision
- Rest moves smoothly but then jumps abruptly when close to a note
- Need to find rest positioning logic
- SEARCH: "isRest" in VexFlow rendering section, "rest.*position", "ghost", "GhostNote"
- FIX: Smoother rest displacement logic (no abrupt jump)

### Bug 3: Unisons overlap instead of side-by-side 
- Two voices on same staff playing same pitch — noteheads stack on top of each other
- Should show side-by-side (standard engraving practice: x-offset)
- SEARCH: "same.*pitch", "unison" — NOT FOUND in current code
- FIX: Detect same pitch in same beat between two voices on same staff → apply setXShift

### Bug 4: Ties — select only 2nd note
- Currently both notes must be selected to create a tie
- Change to: select only the 2nd note, tie it to previous same-pitch note in same voice
- SEARCH: "tie", "tiedTo", "tiedFrom", "StaveTie", "legatura"
- FIX: Modify tie creation to find previous same-pitch note automatically

## KEY VexFlow METHODS
- `staveNote.setXShift(pixels)` — horizontal offset for collision avoidance
- `Vex.Flow.Stem.UP` (1) / `Vex.Flow.Stem.DOWN` (-1) 
- `StaveTie` — for rendering ties between notes
- `GhostNote` — invisible spacing note

## KEY CODE AREAS IN GrandStaffEditor.tsx
- layoutData useMemo: ~line 2291+ (note positioning computation)
- VexFlow rendering section: creates StaveNotes, configures voices, draws
- Tie handling: search for "tie" in the component
- Figured bass positioning: L7255-7280 (has collision offset comments but for labels, not notes)

## CRITICAL RENDERING SECTION FOUND (14 feb — MUST READ FIRST)

The VexFlow rendering is NOT done via explicit `new StaveNote()`. It appears to use a React component
wrapper or an adapter layer. The key rendering section is around **L6757-7000+** in GrandStaffEditor.tsx.

### Key rendering lines:
- **L6757**: `notesByMeasure = new Map<number, StaffNote[]>()` — groups notes by measure for rendering
- **L6766-6767**: Gets measure keys for layout
- **L6779**: `onsetGroups = new Map<number, StaffNote[]>()` — groups notes by onset (same beat)
- **L6911**: `notesByVoice = new Map<number, StaffNote[]>()` — separates notes by voice
- **L6987**: `key={vf-${systemIndex}-${vexflowNonce}}` — React key for VexFlow component
- **L600**: `.vf-notehead` CSS selector — VexFlow renders noteheads with this class
- **L134-141**: Overlay tuning comments for adapter connections with VexFlow noteheads
- **L575**: `vexflowNonce` useState — forces VexFlow re-render

### Most important read range for all 4 bugs:
```bash
# THE RENDERING SECTION — read this first!
sed -n '6750,6990p' src/components/GrandStaffEditor.tsx

# Voice separation and note positioning
sed -n '6900,6960p' src/components/GrandStaffEditor.tsx

# Onset groups (collision detection happens here?)
sed -n '6775,6830p' src/components/GrandStaffEditor.tsx
```

### Strategy for next session:
1. Read the full rendering section L6750-7000 to understand HOW notes are drawn
2. Find where stem directions are set (if at all)
3. Identify where collision detection/avoidance could be inserted
4. The VexFlow component at L6987 is likely a custom wrapper — find its definition

## RESEARCH FINDINGS (14 feb 2026)

### VexFlow Note Creation
- **NO `new StaveNote()` or `StaveNote(` found** in GrandStaffEditor.tsx!
- **NO `stemDirection`, `Stem.UP`, `Stem.DOWN`** found — stem direction not explicitly set
- **NO `setXShift` or `x_shift`** found — NO existing X-shift collision avoidance logic at all
- VexFlow notes may be created through EasyScore, Factory API, or via the layoutData useMemo
- Need to search for HOW notes are actually created — try: "Vex.Flow", "Factory", "EasyScore", "formatter", "Voice", "keys:", "duration:"

### Key Line Numbers Found
- **L72, L102**: Ghost note comments (cursor pitch mapping)
- **L331**: `ghostNote` useState — ghost note for cursor
- **L2705**: `tiedFromPrevNoteIds` useMemo — computes which notes are tied from previous
- **L6160**: Toggle tie (legatura) for selected notes — THE TIE TOGGLE LOGIC
- **L6691**: `tieFromPrev = tiedFromPrevNoteIds.has(n.id)` — used in rendering  
- **L7267-7268**: "No dynamic collision detection" comment (figured bass label positioning)

### Tie Logic (Bug 4)
- L2705: `tiedFromPrevNoteIds` useMemo — builds a Set of note IDs that are tied from previous note
- L6160: Tie toggle action — needs to be read in detail (around L6155-6200)
- L6691: Rendering check for tie — used in the VexFlow drawing section

### Rest Logic (Bug 2)
- Ghost note: L331
- isRest checks at: L1072, L1118, L1149, L1219, L1310, L2066, L2085, L2708, L2856, L2867, L3152, L3161
- Rest Y-position logic needs to be found in the VexFlow rendering section

### NEXT SEARCH COMMANDS
```bash
# Find how VexFlow notes are actually created
grep -n "Vex\.Flow\|Factory\|EasyScore\|formatter\|Voice\|keys:\|duration:" src/components/GrandStaffEditor.tsx | head -30

# Read tie toggle logic
sed -n '6150,6200p' src/components/GrandStaffEditor.tsx

# Read tiedFromPrevNoteIds
sed -n '2700,2730p' src/components/GrandStaffEditor.tsx

# Read VexFlow rendering section around L6680-6700
sed -n '6680,6710p' src/components/GrandStaffEditor.tsx

# Find layoutData useMemo where notes are positioned
sed -n '2291,2350p' src/components/GrandStaffEditor.tsx

# Search for how notes are drawn (SVG rendering)
grep -n "circle\|rect\|noteHead\|note_head\|drawNote\|renderNote" src/components/GrandStaffEditor.tsx | head -20
```

## TODO STATUS
- [1] Bass-Tenor collision — IN PROGRESS (need to find note creation)
- [2] Note-Rest anti-collision — NOT STARTED (key lines: L1149, L1219)
- [3] Unisons side-by-side — NOT STARTED (NO existing logic found)
- [4] Ties select only 2nd — NOT STARTED (key lines: L2705, L6160, L6691)

---

## BUG FIX: Accidentali sovrapposti soprano/alto (2026-03-27)

**Sintomo:** In C75 3 m8 b1 (Gm), G# soprano e F# alto hanno i diesis sovrapposti. Il fix era già stato implementato (stagger) ma regredito.

**Causa (3 livelli):**

1. **`byTimeKeyAll` raggruppa per onset+durata.** G# (eighth) e F# (half) avevano time key diversi → non raggruppati → stagger mai calcolato. **Fix:** creato `byOnsetKeyAll` (solo onset, ignora durata) e usato per il calcolo stagger e il conteggio `onsetAccCount` nel non-merged path.

2. **Dense-accidental cleanup scattava per 2+ accidentali** (`withAcc.length < 2`), mentre il commento e l'intenzione erano per 3+. Questo cancellava lo stagger appena calcolato. **Fix:** soglia da `< 2` a `< 3`.

3. **Stagger direction:** la nota più alta (soprano, position più basso numericamente) è sorted[0] e riceve stagger=0. La nota più bassa (alto) riceve stagger=8px. Questo è corretto: il diesis dell'alto si sposta a sinistra, evitando sovrapposizione col diesis del soprano sopra.

**File modificato:** `src/components/VexflowGrandStaff.tsx`
- L847-855: aggiunto `byOnsetKeyAll` (Map per onset senza durata)
- L1489: `byTimeKeyAll` → `byOnsetKeyAll` nel loop stagger
- L1522: guard `< 2` → `< 3` (dense-cleanup threshold)
- L1945: `getNoteTimeKey` → `getNoteOnsetKey` nel non-merged path
