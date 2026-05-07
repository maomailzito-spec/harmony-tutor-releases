# Audit Architetturale — Fase 1

Data audit: 2026-05-07
Scope: `src/components/GrandStaffEditor.tsx`, `src/utils/musicTheory.ts`, `src/hooks/useHarmonyLabels.ts`, `src/utils/harmonyLabelPipeline.ts`, `src/utils/cadentialPatterns.ts`, `src/utils/sequenceDetector.ts`, `src/utils/parseChordSymbol.ts`, `src/types.ts`, `src/utils/chromaticModulationDetector.ts`, `src/engine/choralRealization.ts`, `src/utils/harmonyPostRules.ts`, `src/utils/computeHarmonyLabelsBySystem.ts`.

Legenda rischio: **🔴 alto** (causa bug ricorrenti / dati corrotti), **🟡 medio** (debt strutturale, propaga errori), **🟢 basso** (cosmetico / cleanup).

---

## 1. Duplicazioni di logica

### D1. `ALL_NOTE_SPELLINGS` definito due volte 🔴
- [src/constants.ts:51](src/constants.ts#L51) — definizione attiva (importata da 7+ file)
- [src/data/constants.ts:44](src/data/constants.ts#L44) — definizione **identica**, **mai importata** (`grep -r "data/constants"` → 0 risultati)

Entrambe omettono `E#` (pc 5), `Cb` (pc 11), `Fb` (pc 4), `B#` (pc 0). È la sorgente n°1 di errori di spelling: `pc 5 → ['F']` significa che E# non può mai uscire dal lookup. La copia in `data/` è dead code (verificato — nessun import).

### D2. Tre tabelle separate `NOTE_TO_PC` 🟡
- [src/utils/cadentialPatterns.ts:507-511](src/utils/cadentialPatterns.ts#L507) — `NOTE_TO_PC: Record<string, number>`
- [src/utils/parseChordSymbol.ts:49](src/utils/parseChordSymbol.ts#L49) — `NOTE_TO_PC` (duplicato, locale)
- [src/utils/musicTheory.ts:139-144](src/utils/musicTheory.ts#L139) — `noteNameToIndex` derivato da `ALL_NOTE_SPELLINGS`

Le prime due sono identiche; `noteNameToIndex` è derivata ma equivalente. Stesso dato, tre fonti di verità.

### D3. Funzioni di conversione MIDI ↔ nome nota sparse 🟡
- `noteNameToPc` definita in [cadentialPatterns.ts:514](src/utils/cadentialPatterns.ts#L514) — 6 call sites
- `pcToNoteName` definita in [cadentialPatterns.ts:491](src/utils/cadentialPatterns.ts#L491) — 1 call site
- `noteNameToChromaticIndex` definita inline in [useHarmonyLabels.ts:35](src/hooks/useHarmonyLabels.ts#L35) e [computeHarmonyLabelsBySystem.ts](src/utils/computeHarmonyLabelsBySystem.ts) — 15+ call sites
- `pitchClassOf(note)` in musicTheory.ts — 80+ call sites (è la più usata)
- `midiToNoteIndex(midi)` in [choralRealization.ts:215](src/engine/choralRealization.ts#L215)

Quattro nomi diversi per la stessa operazione semantica (pc → o ← qualcosa). Convergono tutti su `mod12`, ma la semantica di "nome nota" varia: alcune ritornano sharp-only, altre la prima dell'array `ALL_NOTE_SPELLINGS`.

### D4. Reverse mapping accidentale (enum/glyph → simbolo) duplicato 🟡
Centralizzato avanti (`accidentalToAlteration` in [musicTheory.ts:446](src/utils/musicTheory.ts#L446) accetta tutti i formati). Ma il mapping inverso è inline in:
- [HarmonyLabelExplainModal.tsx:60](src/components/HarmonyLabelExplainModal.tsx#L60)
- [parseChordSymbol.ts:480-483](src/utils/parseChordSymbol.ts#L480) (helper `accToStr` dentro `buildMeasureAccidentals`)
- [useHarmonyLabels.ts:1031](src/hooks/useHarmonyLabels.ts#L1031)
- [parseChordSymbol.ts:236](src/utils/parseChordSymbol.ts#L236) (`accSemi = acc === '#' ? 1 : ...`)
- [choralRealization.ts:1880](src/engine/choralRealization.ts#L1880) (stessa formula)

5 implementazioni della stessa tabella `{'#': 1, 'b': -1, '##': 2, 'bb': -2}`.

### D5. Calcolo ottava da MIDI: due forme incompatibili 🔴
Forma "naïve" (raw MIDI): `Math.floor(midi / 12) - 1`
- [musicTheory.ts:1109](src/utils/musicTheory.ts#L1109)
- [GrandStaffEditor.tsx:3350](src/components/GrandStaffEditor.tsx#L3350)
- [ChordVisualizer.tsx:405](src/components/ChordVisualizer.tsx#L405), [IntervalsVisualizer.tsx:162](src/components/IntervalsVisualizer.tsx#L162), [ScalesVisualizer.tsx:638](src/components/ScalesVisualizer.tsx#L638)

Forma corretta (sottrae l'accidentale): `naturalMidi = midi - accSemi; Math.floor(naturalMidi/12) - 1`
- [parseChordSymbol.ts:236-237](src/utils/parseChordSymbol.ts#L236) (`notePropsFromTone`, fixato di recente)
- [choralRealization.ts:1879-1881](src/engine/choralRealization.ts#L1879) (`voicingToStaffNotes`, fixato di recente)

Stessa operazione semantica, due risultati: per `Cb5` (midi 71) la prima forma dà ottava 4, la seconda 5. Solo la seconda è coerente con la lettera. Il fatto che siano due fix indipendenti recenti per lo **stesso bug** in posti diversi dimostra che la duplicazione è la causa.

### D6. `ornamentOverride` filtering check ripetuto 🟡
Pattern `n.ornamentOverride && n.ornamentOverride !== 'structural'` ripetuto in 10+ posti:
- [musicTheory.ts:5291, 7266, 7707, 10117](src/utils/musicTheory.ts) (dentro `applyHarmonyRules`, dopo che il campo è settato → safe)
- [harmonyLabelPipeline.ts:27, 304, 367](src/utils/harmonyLabelPipeline.ts) (pipeline, dopo map check → safe)
- [useHarmonyLabels.ts:368, 1731, 1743, 2175, 2313, 2349](src/hooks/useHarmonyLabels.ts) (post-`applyHarmonyRules`, ma vedi C1 — alcuni sono fragili)
- [GrandStaffEditor.tsx:8932-8938](src/components/GrandStaffEditor.tsx#L8932) (UI rendering)

La funzione `structuralNotes` ([harmonyLabelPipeline.ts:9](src/utils/harmonyLabelPipeline.ts#L9)) incapsula correttamente il pattern (id+composite+field). Gli altri call sites lo replicano inline.

### D7. Logica filtro ornamentale duplicata fra `getRomanAnalysis` e snapshot 🟢
- [musicTheory.ts:2899](src/utils/musicTheory.ts#L2899) — filtro in `getRomanAnalysis`
- [musicTheory.ts:1464](src/utils/musicTheory.ts#L1464) — stesso filtro in `getRomanAnalysisDebugSnapshot`

Due copie tenute in sync manualmente (rischio drift in futuro).

---

## 2. Conflitti / incoerenze

### C1. Timeline events vs assunzione "harmonic event" del cadential detector 🔴
- [getActiveNotesTimeline](src/utils/musicTheory.ts#L6) genera **un evento per ogni scan-point** (onset O offset di QUALSIASI nota in QUALSIASI voce)
- [evaluateCadentialPatterns](src/utils/cadentialPatterns.ts#L367) assume che ogni evento sia un cambio armonico reale (sliding window contigua)

Mismatch parzialmente corretto in [useHarmonyLabels.ts:381-404](src/hooks/useHarmonyLabels.ts#L381) (dedup + subset check). Ma:
- **Nessun commento esplicita il contratto** fra le due funzioni
- [sequenceDetector.ts:355](src/utils/sequenceDetector.ts#L355) — `detectVoiceLeadingSequences` opera su tick onset/offset di tutte le note, **senza filtro ornamenti**: stessa fragilità potenziale
- [chromaticModulationDetector.ts:71](src/utils/chromaticModulationDetector.ts#L71) — opera per misura, immune

### C2. Due funzioni "pitchClass" con fallback diversi 🟡
- [pitchClassOf](src/utils/musicTheory.ts#L1361) — usa MIDI come fallback se manca lo spelling
- [pitchClassForRoman](src/utils/musicTheory.ts#L2808) — usa key signature come fallback

Caller diversi → risultati diversi per la stessa nota in contesti diversi. Non documentato.

### C3. `.noteIndex` come pitch class settato durante chord identification 🔴
- [identifyChordCandidates](src/utils/musicTheory.ts#L1956): `pcToNote.set(pc, { ...n, noteIndex: pc })` — sovrascrive `noteIndex` con la pc
- [calculateRomanNumeral:2454-2455](src/utils/musicTheory.ts#L2454) preferisce `.noteIndex` se presente
- Ma `noteIndex` è una pc (0-11), mentre la lettera+accidentale resta sulla nota originale → due fonti di verità sullo stesso oggetto

Conseguenza pratica: una nota spelled "C#" ha `letter='C'`, `accidental='sharp'`, ma `noteIndex=1`. Successivi lookup possono ridurla a Db.

### C4. `enharmonic cost filter` come post-process vs spelling-first 🟡
La filosofia stabilita è "spelling-first" ma c'è un re-rank post-hoc per costi enarmonici (vedi commento nello SPEC). Convive con la dual representation (C3) — il re-rank può rimettere a posto solo ciò che il pipeline ha già perso. Se la nota arriva con `noteIndex=1` invece di `letter='C'+sharp`, il filtro non può recuperare l'intento originario.

### C5. Difference fra `inferredAnalysisContexts` (old-style) e `pushInferred` (new-style) 🟡
- [applyHarmonyRules](src/utils/musicTheory.ts) produce `inferredAnalysisContexts` come parte del result, **senza campo `source`** ([musicTheory.ts:9086-9091](src/utils/musicTheory.ts#L9086) e altri push)
- [useHarmonyLabels:311](src/hooks/useHarmonyLabels.ts#L311) ne aggiunge altri via `pushInferred` con `source: 'inferred'`

Convivono in `_effectiveCtxs` ma hanno trattamento diverso nei filtri (es. il filtro suppression cerca `source === 'inferred'` e non li trova). Bug latente.

### C6. `analysis.cadentialPatterns` subordinato a `analysis.enableInferredContexts` 🟢
[useHarmonyLabels.ts:341-342](src/hooks/useHarmonyLabels.ts#L341): `_cadEnabled2 = _inferCtxEnabled && cadentialPatternsEnabled`

UX confusing: l'utente che attiva solo "Pattern cadenzali" non vede effetti se "Inferisci contesti" è OFF. I due toggle suggeriscono indipendenza ma non lo sono.

---

## 3. Funzioni eliminabili / accorpabili

### F1. `/src/data/constants.ts` — file morto 🔴
Mai importato. Contiene `ALL_NOTE_SPELLINGS`, `NOTE_NAMES_BY_INDEX`, `INTERVALS`. **Eliminabile interamente.** Rischio nullo, beneficio: rimuove ambiguità su quale sia la fonte.

### F2. `calculateRomanFromChordInfo` come wrapper "via nome" — non eliminabile 🟢
[musicTheory.ts:2022](src/utils/musicTheory.ts#L2022) — non è zero-value: converte `keySignatureRoot: string` in indice e delega a `calculateRomanNumeral`. Usato in 6 file. **Accorpabile** se si standardizza l'API a `string` o `index`, ma non è dead code.

### F3. `buildScaleDegreeNotesPublic` 🟢
[parseChordSymbol.ts:533](src/utils/parseChordSymbol.ts#L533) — riferito solo come tipo di ritorno in [parseChordSymbol.ts:508](src/utils/parseChordSymbol.ts#L508), nessun caller esterno. Accorpabile alla privata `buildScaleDegreeNotes`.

### F4. `ticksToBeats` / `beatsToTicks` 🟢
[musicTheory.ts:180, 185](src/utils/musicTheory.ts#L180) — wrapper aritmetici banali (`x / TICKS_PER_QUARTER`). Inlinable, ma utili per leggibilità. Lasciare.

### F5. `noteNameToChromaticIndex` inline in due file 🟡
[useHarmonyLabels.ts:35](src/hooks/useHarmonyLabels.ts#L35) e [computeHarmonyLabelsBySystem.ts](src/utils/computeHarmonyLabelsBySystem.ts) — definizione inline duplicata. Spostare in `musicTheory.ts` o (meglio) collassare con `noteNameToPc` / `noteNameToIndex`.

---

## 4. Fragilità architetturali

### A1. ornamentOverrides salvato separato dalle note (già morso 1 volta) 🔴
Storage: `OrnamentOverride[]` con `noteId` reference, NON merged dentro le note. Note caricate da file hanno `n.ornamentOverride === undefined`.

`applyHarmonyRules` setta il campo sulle proprie note (`analyzedNotes`) — ma `timelineForLabels` usa `layoutData.positionedNotes` (un grafo separato). Risultato: filtri che controllano solo `n.ornamentOverride` senza `ornOverrideMap` falliscono silenziosamente sulle note timeline.

Pattern documentato in `structuralNotes` (id+composite+field) ma replicato manualmente altrove (vedi D6). Vulnerabilità ricorrente — il bug A°/Eb di Life on Mars era esattamente questo.

### A2. Sequence detector non filtra ornamenti 🟡
[sequenceDetector.ts:355](src/utils/sequenceDetector.ts#L355) opera su `notes` raw via `startTick/endTick`, senza consultare `ornamentOverrides`. Una nota di passaggio sulle voci esterne può creare slot boundaries spuri e rompere il matching della sequenza.

Non è esploso (ancora) probabilmente perché le sequenze a 2-misure sono rare con ornamenti pesanti, ma è la stessa classe di bug di A1.

### A3. `_effectiveCtxs` mescola contesti manuali, old-inferred (no source), new-inferred (source) 🟡
Vedi C5. I filtri post-hoc (es. soppression manuale) controllano `source === 'inferred'` e bypassano i contesti old-inferred prodotti da `applyHarmonyRules`. Workaround possibile: taggare anche quelli con `source: 'inferred'` (provato in una sessione precedente, rifiutato per regressioni). La fragilità resta.

### A4. preferenze lette via `localStorage.getItem` dentro `useMemo` 🟡
~~Già morso in passato~~ **(ora corretto)**: `enableInferredContexts` e `cadentialPatternsEnabled` ora passati come prop. Ma altre preferenze potrebbero avere lo stesso pattern. Da verificare:
```
grep -n "localStorage.getItem" src/hooks/useHarmonyLabels.ts src/utils/computeHarmonyLabelsBySystem.ts
```
Se la `useMemo` legge una preferenza ma non la dichiara nei deps, il toggle UI è muto.

### A5. `pickPreferredBassNote` + `bassPc` calcolati separatamente 🟢
[useHarmonyLabels.ts:388](src/hooks/useHarmonyLabels.ts#L388): bass calcolato come `Math.min(...notesForCad.map(midi))`. Diverso da [musicTheory.ts:1961](src/utils/musicTheory.ts#L1961) che usa `pickPreferredBassNote` (logica più ricca: prefer voce 4, ignora rest, etc.). Possibile divergenza in casi-limite (note in voce 4 più alta del soprano).

---

## 5. Rappresentazione note (focus per Fase 2)

### Stato attuale
La nota base è `StaffNote` ([types.ts](src/types.ts)) che porta:
- `pitch: string` (lettera, es. "C")
- `accidental: AccidentalType` (enum: 'sharp'|'flat'|'natural'|null)
- `octave: number`
- `midi: number` (computed)
- `noteIndex: number` (pitch class 0-11)

**Ridondanza**: `pitch + accidental + octave` determinano `midi` e `noteIndex`. Avere tutti e cinque i campi crea rischio di incoerenza (nota spelled C# ma midi=1 erroneo).

### Conversioni MIDI → nome nel codice (16 sedi totali)

**Convertono PERDENDO lo spelling** (cattivo per spelling-first):
1. [identifyChordCandidates:1956](src/utils/musicTheory.ts#L1956) — `noteIndex: pc` (riduce a pc, perde lettera)
2. [calculateRomanNumeral:2455](src/utils/musicTheory.ts#L2455) — preferisce `.noteIndex` (pc) sopra la lettera
3. [getChordSymbol](src/utils/musicTheory.ts) — root reconstructed via pc-lookup, non da `root.letter`
4. [pitchClassOf](src/utils/musicTheory.ts#L1361) — fallback a `mod12(midi)` se manca spelling
5. Le 5 sedi di calcolo ottava raw (D5 sopra)
6. Score-based pc disambiguation in `findStandardCandidates`

**Mantengono lo spelling** (modello da seguire):
1. [parseChordSymbol.ts:notePropsFromTone:232+](src/utils/parseChordSymbol.ts#L232) — usa `tone.letter`, `tone.accidental`
2. [choralRealization.ts:voicingToStaffNotes:1874+](src/engine/choralRealization.ts#L1874) — usa `tonePick.letter/accidental`
3. [buildScaleDegreeNotes](src/utils/parseChordSymbol.ts#L287) — costruisce per terze sovrapposte, preserva intento

### Punti dove `SpelledPitch` farebbe pulizia (impatto-Fase-2)
- **`identifyChordCandidates`** — invece di `noteIndex: pc` dovrebbe portare `root: SpelledPitch`. Il candidate carries letter+accidental, non solo pc.
- **`calculateRomanNumeral`** — derivare il grado dalla relazione lettera-tonica (intervallo diatonico), non da `mod12(pc - tonicPc)`. La forma corretta: contare letter-steps, poi verificare alterazione.
- **`getChordSymbol`** — generare il simbolo da `root.letter + root.accidental + quality_suffix`, mai pc-lookup.
- **`computeFiguredBassFromIntervals`** — verificare che usi `BassInterval.number` (1-7 diatonici) e non semitone diff. Già OK secondo audit Phase 1 ([musicTheory.ts](src/utils/musicTheory.ts)), ma da confermare a Fase 2.
- **Octave calc** (D5) — applicare il pattern `naturalMidi` ai 5 siti residui. Banale ma necessario.
- **`ALL_NOTE_SPELLINGS`** — espandere per includere E#/Cb/Fb/B#. Senza questo nessun `SpelledPitch` può funzionare.

### Fattibilità tipo `SpelledPitch`
**Molto fattibile**: la struct esiste già implicitamente (`StaffNote.pitch + accidental + octave`). Mancano solo le utility:
- `toMidi(p: SpelledPitch): number`
- `toPc(p: SpelledPitch): number`
- `spellInterval(root: SpelledPitch, semitones: number, diatonicSteps: number): SpelledPitch`

L'introduzione del tipo NON richiede grossi refactor della UI o del playback (il MIDI resta derivato). I refactor sono concentrati nei 6 punti sopra (chord ID + roman + symbol + figured bass + octave calc + spellings).

**Stima impatto**: ~6 file toccati, ~300-500 LOC modificate. Regression suite (`npm run regress`) coprirà chord ID, roman, symbol — sufficiente confidence test.

---

## Sintesi rischio

| ID | Categoria | Rischio | Note |
|---|---|---|---|
| D1 | Duplicazione | 🔴 | `data/constants.ts` morto + spelling table difettosa |
| D5 | Duplicazione | 🔴 | Calcolo ottava in 2 forme incompatibili |
| C1 | Conflitto | 🔴 | Timeline ↔ cadential mismatch (parzialmente patchato) |
| C3 | Conflitto | 🔴 | Dual truth `noteIndex` (pc) vs `letter+accidental` |
| F1 | Eliminabile | 🔴 | `data/constants.ts` da cancellare |
| A1 | Fragilità | 🔴 | OrnamentOverride storage scollato dalle note |
| D2-D4 | Duplicazione | 🟡 | Tabelle di conversione sparse |
| D6-D7 | Duplicazione | 🟡 | Filtri ornamentali ripetuti |
| C2, C4, C5 | Conflitto | 🟡 | Funzioni "pitchClass" divergenti, fragili |
| A2-A4 | Fragilità | 🟡 | Sequence detector non filtra; preferenze ricalcolate |
| C6 | UX | 🟢 | Toggle "Pattern cadenzali" non indipendente |
| F2-F5 | Eliminabile | 🟢 | Wrapper minori |
| A5 | Fragilità | 🟢 | Bass calc divergente |

---

## Raccomandazioni di sequenza per Fase 2

1. **Prerequisito**: cancellare [src/data/constants.ts](src/data/constants.ts) (F1). Espandere `ALL_NOTE_SPELLINGS` con E#/Cb/Fb/B# (D1).
2. **Tipo `SpelledPitch`** in `types.ts` con `toMidi`, `toPc`, `spellInterval`.
3. **Refactor `identifyChordCandidates`** — rimuovere `noteIndex: pc`, far portare al candidate `root: SpelledPitch` derivato dalla nota originale (letter+accidental preservati).
4. **Refactor `calculateRomanNumeral`** — derivare grado da intervallo diatonico (letter-steps) anziché `mod12`.
5. **Refactor `getChordSymbol`** — generare da `root.letter + accidental_suffix`.
6. **Unificare** le 5 sedi di calcolo ottava al pattern `naturalMidi - accSemi` (D5).
7. **Unificare** le 3 tabelle `NOTE_TO_PC` in una sola (D2).
8. **Refactor `parseChordSymbol`** per garantire che `notePropsFromTone` usi `SpelledPitch` end-to-end.

Tutto **dentro lo scope di Fase 2 indicato nello SPEC**. Riguardo regressioni: la regress suite copre chord ID, roman, symbol → buona barra di confidence.

Le voci `🟡` e `🟢` possono essere affrontate in passate successive — non bloccanti.
