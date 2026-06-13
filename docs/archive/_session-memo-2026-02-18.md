# Session Memo — 18 Feb 2026 — Ornament Override Label Filtering

## BUG APERTO (PRIORITÀ ASSOLUTA)
**Problema:** Quando l'utente marca una nota come ornamento (⌥V per neighbor, ⌥P per passing, ecc.), il label Roman numeral sotto quella nota NON scompare. Il label continua a includere la nota ornamentale nell'analisi dell'accordo.

**Esempio concreto:** In Gm, accordo Eb-C-Ab-C. L'utente marca Ab come "neighbor" (⌥V). Il sistema dovrebbe analizzare solo Eb-C-C = "i" (Cm). Invece continua a mostrare "iv6" (Ab-C-Eb) includendo l'Ab nell'analisi.

## ROOT CAUSE IDENTIFICATA (debug log confermato)
Gli ID nota nell'`ornamentOverrides[]` (dalla selezione utente, es. `"midi-299-65760-67"`) NON corrispondono agli ID nota nella timeline dell'analisi (es. `"midi-193-36000-67"`). Sono oggetti diversi con ID diversi creati da `getActiveNotesTimeline()`.

### Tentativo di fix: Composite Key `${midi}-${measureIndex}-${beat}`
Implementato matching per chiave composita `${midi}-${measureIndex}-${beat}` oltre che per noteId. **MA NON FUNZIONA** — "ogni singola nota viene etichettata". Probabilmente il composite key funziona per il matching ma il filtro produce un risultato ≤ 2 note → scatta il fallback di `structuralNotes()` che ritorna TUTTE le note.

### Il VERO problema potrebbe essere:
1. **Fallback guard in `structuralNotes()`**: `return filtered.length >= 2 ? filtered : notes` — se dopo il filtro restano <2 note, ritorna TUTTE le note (inclusa quella ornamentale). Per un accordo di 4 note dove 1 è marcata, restano 3 → dovrebbe andare. MA per beats con solo 2 note, filtrarne 1 lascia 1 → fallback → la include di nuovo.
2. **Il composite key include TUTTE le note auto-detected come passing/neighbor** — questo potrebbe filtrare troppe note → fallback → ritorna tutte. Nell'ornOv il debug mostrava MOLTI entries (sia manuali che auto-detected). Se l'ornOverrideRecord contiene anche le auto-detected, potrebbe filtrare TUTTE le note di un accordo.
3. **Il messaggio "ogni singola nota viene etichettata"** suggerisce che TUTTE le note vengono etichettate, il che significa che `getRomanAnalysis` returning null non impedisce l'etichettatura — c'è un fallback che mostra un label anyway.

## COSA È STATO COMPLETATO IN QUESTA SESSIONE (tutto build ✓)

### Funzionalità completate:
1. **Ornament Override Infrastructure**: types.ts (OrnamentType, OrnamentOverride), musicTheory.ts (early tag L3660, late full override ~L10100), GrandStaffEditor.tsx (state, handlers, shortcuts), grandStaffProjectIOAdapter.ts (save/load), ModulationContextMenu.tsx (UI section)
2. **Keyboard shortcuts**: ⌥P (passing/P), ⌥V (neighbor/v), ⌥A (appoggiatura/a), ⌥N (anticipation/ant), ⌥S (escape/s), ⌥R (suspension/r)
3. **Cross-duration seconds displacement + mixed-stem fix** (VexflowGrandStaff.tsx L413 getNoteOnsetKey)
4. **Warning connections R-08, EXC-S02, R-10-6** in musicTheory.ts
5. **Stats regenerated** (854 bigrams, 518 trigrams) + statistical correction toggle (PreferencesModal.tsx)
6. **Ornament shortcuts in Help → Scorciatoie** (electron/main.js)
7. **MIDI import FF 59 key sig** (midiParser.ts + useGrandStaffMidi.ts) + smart enharmonic spelling (musicTheory.ts)
8. **Beam highlight fix** some→every (VexflowGrandStaff.tsx L2262/L2313)
9. **Tie direction backward-first** (GrandStaffEditor.tsx L6325)
10. **notesForRomanAt filter** in musicTheory.ts L6178 (no guard)
11. **Early override → TAG-ONLY** (musicTheory.ts ~L3660)

### Tentativi di fix per il label filtering (tutti implementati, NESSUNO funziona):
12. **harmonyLabelPipeline.ts** — exported `structuralNotes(notes, overrideMap?)` + wrapped 5 pipeline calls
13. **useHarmonyLabels.ts** — ornamentOverrides in interface + ornOverrideMap + ornOverrideRecord + ALL 12 getRomanAnalysis calls with `{ ornamentOverrides: ornOverrideRecord }` + flag propagation (analyzedNotes→positionedNotes) + analyzedNotes in useMemo deps
14. **computeHarmonyLabelsBySystem.ts** — ornamentOverrideMap in opts + callback builds ornOvRec
15. **GrandStaffEditor.tsx L2876** — passes ornamentOverrides to useHarmonyLabels
16. **getRomanAnalysis (musicTheory.ts ~L2472)** — internal filtering by opts.ornamentOverrides Record w/ composite key
17. **identifyChordCandidates (musicTheory.ts L1727)** — internal filtering by ornamentOverrides Record w/ composite key
18. **Composite key matching** `${midi}-${measureIndex}-${beat}` in ornOverrideMap, ornOverrideRecord, getRomanAnalysis, identifyChordCandidates, structuralNotes

## FILES MODIFICATI (15)
1. `src/types.ts` — OrnamentType, OrnamentOverride
2. `src/utils/musicTheory.ts` — getRomanAnalysis (internal filter + composite key), identifyChordCandidates (internal filter), early tag L3660, late override ~L10100, notesForRomanAt L6178, smart enharmonic, warning connections
3. `src/components/GrandStaffEditor.tsx` — ornament state/handlers/shortcuts ⌥P/A/V/R/S/N, tie backward-first L6325, passes ornamentOverrides to hook
4. `src/controllers/grandStaffProjectIOAdapter.ts` — save/load ornament overrides
5. `src/components/ModulationContextMenu.tsx` — ornament section + shortcut labels
6. `src/components/VexflowGrandStaff.tsx` — getNoteOnsetKey L413, mixed-stem, beam some→every L2262/L2313
7. `scripts/extract-progression-stats.ts` — ornamentOverrides + noise filter
8. `src/data/progressionStats.json` — regenerated (854 bigrams, 518 trigrams)
9. `src/components/PreferencesModal.tsx` — statistical correction toggle
10. `electron/main.js` — ornament shortcuts in Scorciatoie dialog
11. `src/utils/midiParser.ts` — FF 59 key sig parsing
12. `src/hooks/useGrandStaffMidi.ts` — MIDI key sig → project key
13. `src/utils/harmonyLabelPipeline.ts` — exported structuralNotes(notes, overrideMap?) + composite key
14. `src/hooks/useHarmonyLabels.ts` — complete ornament override threading
15. `src/utils/computeHarmonyLabelsBySystem.ts` — ornamentOverrideMap + callback

## ARCHITETTURA ORNAMENT OVERRIDE (stato corrente)

### Flusso dei dati:
```
GrandStaffEditor (ornamentOverrides state)
  ├→ applyHarmonyRules() [early tag L3660 + late override L10100]
  │   → analyzedNotes (con ornamentOverride, isPassing, ornamentMark)
  │
  └→ useHarmonyLabels({ ornamentOverrides })
      ├→ ornOverrideMap (Map) — keyed by noteId + composite ${midi}-${mi}-${beat}
      ├→ ornOverrideRecord (Record) — same keys
      ├→ flag propagation (analyzedNotes → positionedNotes by ID)
      ├→ 12x getRomanAnalysis(..., { ornamentOverrides: ornOverrideRecord })
      │   └→ internal filter: check n.id + composite key
      ├→ structuralNotes(notes, ornOverrideMap)
      │   └→ check n.id + composite key + n.isPassing/isNeighbor flags
      └→ computeHarmonyLabelsBySystem callback
          └→ same filtering
```

### Tipi:
```typescript
export type OrnamentType = 'passing' | 'neighbor' | 'appoggiatura' | 'anticipation' | 'escape' | 'suspension' | 'structural';
export interface OrnamentOverride { noteId: string; type: OrnamentType; }
```

### structuralNotes (harmonyLabelPipeline.ts):
```typescript
export function structuralNotes(notes: any[], overrideMap?: Map<string, string>): any[] {
    if (!notes || notes.length === 0) return notes;
    const filtered = notes.filter((n: any) => {
        if (!n) return true;
        // Direct ID check
        if (overrideMap && n.id) {
            const ov = overrideMap.get(n.id);
            if (ov && ov !== 'structural') return false;
        }
        // Composite key check
        if (overrideMap) {
            const midi = Number(n.midi);
            if (Number.isFinite(midi)) {
                const ov2 = overrideMap.get(`${midi}-${n.measureIndex ?? -1}-${n.beat ?? -1}`);
                if (ov2 && ov2 !== 'structural') return false;
            }
        }
        if (n.ornamentOverride && n.ornamentOverride !== 'structural') return false;
        if (n.isPassing || n.isNeighbor || n.isAppoggiatura || n.isAnticipation || n.isEscape) return false;
        return true;
    });
    return filtered.length >= 2 ? filtered : notes;  // ← GUARD: <2 notes → fallback to ALL
}
```

## STATO CODICE: TENERE TUTTE LE MODIFICHE
Tutte le 18 modifiche vanno mantenute. Nessuna causa regressioni (build ✓).
Il wiring è corretto, il matching per composite key funziona.
Il problema residuo è che il punto di filtro non intercetta dove il label viene effettivamente generato per il display.
La prossima sessione deve trovare il PUNTO ESATTO dove il label text è prodotto e aggiungere lì il filtro.

## PROSSIMI PASSI DA PROVARE

### 1. Debug più mirato
Aggiungere console.log nel punto ESATTO dove il label viene generato per capire da dove arriva. Il label potrebbe venire da:
- La funzione `computeStructuralSnapshotForHarmonyLabelEvent` (useHarmonyLabels ~L928-1083) che costruisce `analysisNotesForNaming` — potrebbe includere note ornamentali nello snapshot PRIMA di chiamare getRomanAnalysis
- Una cache o stato precedente che non si aggiorna
- Il `getActiveNotesTimeline` che duplica/clona note, perdendo le composite keys

### 2. Approccio radicalmente diverso
Invece di filtrare alla fine, **NON generare l'event nella timeline** per le note ornamentali. Modificare `getActiveNotesTimeline()` per escludere note il cui ID è in ornamentOverrides. MA: l'ID non matcha (come visto dal debug).

### 3. L'approccio più semplice possibile
**Dopo che il label è generato**, nella fase di rendering/display, controllare se il beat del label corrisponde a un beat dove l'unica nota non-ornamentale è <2 → nascondere il label. Oppure: se il label cambia rispetto al precedente SOLO a causa di una nota marcata come ornamentale → mantenere il label precedente.

### 4. Eliminare il fallback guard
Cambiare `structuralNotes()` da `filtered.length >= 2 ? filtered : notes` a `return filtered` — se restano 0 o 1 nota, `getRomanAnalysis` ritorna null → nessun label. MA questo potrebbe causare label mancanti per note auto-detected come passing dove il fallback è necessario.

## ORNAMENT MARKS TABLE
| Tipo | Mark | Shortcut |
|------|------|----------|
| passing | P | ⌥P |
| neighbor | v | ⌥V |
| appoggiatura | a | ⌥A |
| anticipation | ant | ⌥N |
| escape | s | ⌥S |
| suspension | r | ⌥R |

## CODE LOCATIONS CHIAVE
- **musicTheory.ts L2462**: getRomanAnalysis function with internal ornamentOverrides filter
- **musicTheory.ts L1727**: identifyChordCandidates with internal filter
- **musicTheory.ts ~L3660**: early tag-only override (ornamentOverride property)
- **musicTheory.ts L6178**: notesForRomanAt (internal Roman filter)
- **musicTheory.ts ~L10100**: late full override (isPassing, ornamentMark, etc.)
- **harmonyLabelPipeline.ts**: structuralNotes() exported + 5 pipeline calls wrapped
- **useHarmonyLabels.ts L70-83**: ornOverrideMap + ornOverrideRecord with composite keys
- **useHarmonyLabels.ts ~L84-100**: flag propagation analyzedNotes→positionedNotes
- **useHarmonyLabels.ts ~L293, L367, L1198, L1200, L1279, L1310, L1311, L1550, L1573, L1885, L2056, L2706**: ALL 12 getRomanAnalysis calls with { ornamentOverrides }
- **useHarmonyLabels.ts ~L1918**: useMemo deps include ornOverrideMap, ornOverrideRecord
- **useHarmonyLabels.ts ~L928-1083**: computeStructuralSnapshotForHarmonyLabelEvent (SUSPECT — may include ornamental notes in snapshot)
- **computeHarmonyLabelsBySystem.ts L137**: callback with ornOvRec
- **GrandStaffEditor.tsx L282**: ornamentOverrides state
- **GrandStaffEditor.tsx L2876**: passes ornamentOverrides to useHarmonyLabels
