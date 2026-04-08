# Harmony Tutor — Scansione funzioni (aggiornata)

Ultimo aggiornamento: 2026-02-02.

Questo documento è un inventario “dal codice”: elenca funzionalità e punti d’aggancio principali, con riferimenti ai file chiave.

## File chiave (entry points)

- UI/Editor monolitico: `src/components/GrandStaffEditor.tsx`
- Rendering (VexFlow): `src/components/VexflowGrandStaff.tsx`
- UI (altre viste): `src/components/ScalesVisualizer.tsx`, `src/components/ChordVisualizer.tsx`, `src/components/IntervalsVisualizer.tsx`, `src/components/MainEditor.tsx`
- Persistenza libreria custom (feature chitarra): `src/components/useCustomTypes.ts`
- Motore teoria/analisi: `src/utils/musicTheory.ts`
- Pipeline etichette armoniche: `src/utils/computeHarmonyLabelsBySystem.ts`, `src/utils/harmonyLabelPipeline.ts`
- Riconoscimento sequenze: `src/utils/sequenceDetector.ts`
- Electron (menu + IPC main): `electron/main.js`
- Electron (preload + API bridge): `electron/preload.js`

## Flavor / build variants

L’app supporta un “flavor” che limita le viste disponibili.

- Variabile: `VITE_APP_FLAVOR` (letto da `src/flavor.ts`)
- Valori: `united` | `grandstaff` | `guitar`

Abilitazione viste (`AppMode` in `src/App.tsx`):

- `united`: tutte le viste (`scales`, `chords`, `intervals`, `editor`, `grandStaff`)
- `grandstaff`: solo `grandStaff`
- `guitar`: `scales` + `chords` + `intervals` + `editor` (no `grandStaff`)

## Desktop / Electron (menu, IPC, file system)

### Menu “File” (azioni)

Gestito dal processo main e inviato al renderer come `menu-action`.

- Nuovo progetto (`new`)
- Apri… (`open`)
- Recenti (lettura diretta file dal main e invio `open` con `{ data, filePath }`)
- Importa MIDI… (`import-midi`, payload con `{ base64, filePath }`)
- Esporta MIDI… (`export-midi`)
- Stampa (`print`) — lato renderer apre una nuova window e richiama `window.print()` sul contenuto SVG
- Salva (`save`) / Salva con nome… (`save-as`)
- Chiudi progetto (`close-project`)

Nota: alcune voci (es. Recenti) inviano `open` con payload `{ data, filePath }`.

Riferimenti: `electron/main.js` + handler `handleMenuAction` in `src/components/GrandStaffEditor.tsx`.

### Menu “Edit” (azioni)

- Undo / Redo
- Cut / Copy / Paste
- Select All

Nota: quando il focus è su input/testo, viene usato `document.execCommand(...)` per comportarsi come un’app “standard”.

### Preferenze & toggle (azioni)

- Apri preferenze (`open-preferences`) → `PreferencesModal`
- Toggle numeri di battuta (`set-show-measure-numbers`)
- Toggle colori voci (`set-show-voice-colors`)
- Toggle “quick insert bar” (`set-quick-insert-bar`)
- Toggle debug harmony labels (pcs) (`set-show-harmony-debug`)
- Toggle “toolbar customize” (`toggle-toolbar-customize`)
- Engraving mode (`set-engraving-mode`: `legacy` | `enhanced`)
- Overlap audit (`run-overlap-audit`: `legacy` | `enhanced`)
- Titolo: aumenta/diminuisci font (`increase-title-font`, `decrease-title-font`)

Altre azioni menu (non strettamente “preferenze”, ma inviate via `menu-action`):

- App mode (view): `set-app-mode` con payload `{ mode: 'scales' | 'chords' | 'intervals' | 'editor' | 'grandStaff' }`
- Titolo: font family (`set-title-font-family` con payload `{ family: 'serif' | 'sans-serif' | 'monospace' }`)
- Selezione: “solo voce corrente” (`set-select-only-voice` con payload `{ enabled: boolean }`)

### Electron preload API (bridge sicuro)

API esposta come `window.electronAPI`:

- `onMenuAction(callback)`
- `onMenuError(callback)`
- `saveFile(content, targetPath?)` (IPC: `save-file`)
- `saveFileDialog(content)` (IPC: `save-file-dialog`, opzionale/legacy)
- `saveBinaryFile(base64, targetPath?, filters?)` (IPC: `save-binary-file`, es. export MIDI)
- `addRecentFile(filePath)`
- `setMenuState(state)` (checkmarks/menu sync)
- `guitarLibrary.load()` / `guitarLibrary.save(library)` (solo flavor guitar)

Nota: il contratto TypeScript del bridge è centralizzato in `src/electronAPI.d.ts`.

Riferimento: `electron/preload.js`.

## Progetto (formato dati salvato)

Il progetto viene serializzato in JSON (da renderer), con campi principali:

- `notes` (array di `StaffNote` normalizzate via `normalizeNotePitchFieldsWithKey`)
- `staffSystemMode` (`grandstaff` | `satb_ancient` | `treble_only`)
- Impostazioni progetto: `keySignatureRoot`, `isMinorMode`, `minorScaleMode`, `keyChangeMode`, `modalTonicOverride`
- UI: `projectTitle`, `titleFontSize`, `titleFontFamily`, `toolbarGroupOrder`
- Tempo: `timeSignature`, `timeSignatureChanges`, `bpm`, `isBpmActive`
- Metronomo: `isMetronomeOn`, `metronomeUnit`
- Analisi: `analysisContexts`, `harmonyOverrides`
- Analisi (profili/UI): `enableInferredContexts`, `analysisProfile`, `analysisView`
- Layout: `doubleBarlineMeasures`, `measuresPerLine`, `minMeasureCount`
- Back-compat: `autoLeadingToneInMinor`

Riferimento: blocco `save/save-as` in `src/components/GrandStaffEditor.tsx`.

## Editor (Grand Staff)

### Layout righi (staff system mode)

- `grandstaff`: standard (chiave di violino + basso)
- `satb_ancient`: SATB “a righi separati” (layout dedicato)
- `treble_only`: rigo unico (stile chitarra); in playback trasposto -12 semitoni

Persistenza via `localStorage` (`harmony-tutor.staffSystemMode.v1`).

### Inserimento e timing ad alta risoluzione

- Conversione beats↔ticks (`TICKS_PER_QUARTER`) per stabilità
- Inserimento note/pausa con logica “replace-overlap” in tick-space (evita sovrapposizioni nello stesso slot)
- Ricostruzione timeline per misura/voce (`rebuildMeasureTimelineForVoice` dal motore)

### Selezione e interazione

- Selezione note, multi-selezione
- Marquee select (opzione “solo voce corrente”)
- Alt/Option+Click: ciclo tra candidati sovrapposti (facilita click su note sovrapposte)
- Copy/Cut/Paste con clipboard locale + clipboard di sistema (JSON)
- Paste caret + paste marker (incolla su posizione esplicita o fallback su playhead)

### Notazione (VexFlow)

- Rendering tramite VexFlow (solo VexFlow)
- Gestione collisioni/engraving in due modalità (`legacy` / `enhanced`)
- Audit collisioni (accidentale↔notehead, notehead↔notehead) con report in dialog

Riferimenti: `src/components/VexflowGrandStaff.tsx`, `engravingMode` in `GrandStaffEditor.tsx`.

### Tempo, playback, metronomo, MIDI out

- Playback (scheduler con cursor/absBeat)
- Metronomo con unità: `quarter` | `eighth` | `dotted-quarter`, sincronizzabile con playback
- Supporto Web MIDI (se disponibile): enumerazione output e invio note su device selezionato

## Analisi armonica

### Etichette armoniche (UI)

- Calcolo “labels by system” (posizionamento su righi/pagine)
- Roman analysis + figured bass + chord symbol
- “Debug harmony labels” (firma pcs/diagnostica)
- “Spiega/Confidenza” (click su label: snapshot note/PCS, candidati e motivi heuristic)
- “Harmony overrides” (forzature manuali) + “analysis contexts” (contesto/tonalità)

Riferimenti: `src/utils/computeHarmonyLabelsBySystem.ts`, `src/utils/harmonyLabelPipeline.ts`, integrazione in `GrandStaffEditor.tsx`.

### Sequenze (voice-leading sequences)

- Rilevamento sequenze su griglia/slot
- Evidenziazione grafica (span) + relabeling funzionale “sequence-aware”
- Toggle ON/OFF (persistito in `localStorage` come `harmony.analysis.sequencesEnabled.v1`)

Riferimenti: `src/utils/sequenceDetector.ts`, pannello `src/components/HarmonyAnalysisPanel.tsx`.

### Regole SATB e NCT (motore)

Il motore in `src/utils/musicTheory.ts` include:

- Analisi basata su spelling (non solo MIDI), intervalli “spelled” e pile di terze
- Figured bass (derivato da intervalli sopra il basso)
- Identificazione candidati accordali + Roman numerals + sigle
- Rilevamento note non armoniche (passaggi, vicinanze, ecc.) e sospensioni/ritardi
- Applica regole (violazioni) via `applyHarmonyRules(...)`

## Motore: API esportate (high level)

Alcune export “centrali” in `src/utils/musicTheory.ts` (non esaustivo):

- Timing/placement: `ticksToBeats`, `beatsToTicks`, `calculateNoteBeats`, `getActiveNotesTimeline`, `rebuildMeasureTimelineForVoice`
- Tonalità/chiavi: `getKeySignature`, `getEnharmonicPreference`, `calculateAccidental`
- Intervalli/spelling: `spelledInterval`, `collectIntervalsAboveBass`
- Figured bass: `computeFiguredBassFromNotes`, `computeFiguredBassFromIntervals`, `formatFiguredBass`, `FIGURED_BASS_UI_OPTIONS`
- Pitch helpers: `getNotePropertiesFromMidi`, `getNotePropertiesFromDiatonicPosition`, `normalizeNotePitchFieldsWithKey`
- Armonia: `identifyChordCandidates`, `calculateRomanFromChordInfo`, `getChordSymbol`, `getRomanAnalysis`, `applyHarmonyRules`

## Test e strumenti

- Fixtures JSON di test in `tests/`
- Script di debug/regressione in `scripts/` (analisi specifiche, casi Dubois, sospensioni, ecc.)
- Tooling layout audit in `tools/` (analisi sovrapposizioni)

## Appendici (surface area)

### A. Tutte le `menu-action` (main → renderer)

Fonte principale: `electron/main.js` (menu) + handler in `src/components/GrandStaffEditor.tsx`.

- `new`
- `open` (payload tipico `{ data, filePath? }`)
- `import-midi` (payload `{ base64, filePath }`)
- `export-midi`
- `print`
- `save`
- `save-as`
- `close-project`
- `undo`
- `redo`
- `edit-command` (payload `{ command: 'cut' | 'copy' | 'paste' | 'selectAll' }`)
- `open-preferences`
- `toggle-toolbar-customize`
- `set-quick-insert-bar` (payload `{ enabled: boolean }`)
- `set-show-measure-numbers` (payload `{ enabled: boolean }`)
- `set-show-harmony-debug` (payload `{ enabled: boolean }`)
- `set-show-voice-colors` (payload `{ enabled: boolean }`)
- `set-engraving-mode` (payload `{ mode: 'legacy' | 'enhanced' }`)
- `run-overlap-audit` (payload `{ mode: 'legacy' | 'enhanced' }`)
- `set-title-font-family` (payload `{ family: 'serif' | 'sans-serif' | 'monospace' }`)
- `increase-title-font`
- `decrease-title-font`
- `set-select-only-voice` (payload `{ enabled: boolean }`)
- `set-app-mode` (payload `{ mode: 'scales' | 'chords' | 'intervals' | 'editor' | 'grandStaff' }`)

### B. Canali IPC (renderer ↔ main)

Fonte: `electron/main.js` + `electron/preload.js`.

IPC esposti nel preload (renderer):

- `ipcRenderer.on('menu-action', ...)` (event bus main → renderer)
- `ipcRenderer.on('menu-error', ...)` (event bus main → renderer)
- `ipcRenderer.invoke('save-file', content, targetPath?)`
- `ipcRenderer.invoke('save-file-dialog', content)`
- `ipcRenderer.invoke('save-binary-file', base64, targetPath?, filters?)`
- `ipcRenderer.send('add-recent', filePath)`
- `ipcRenderer.invoke('guitar-library-load')`
- `ipcRenderer.invoke('guitar-library-save', library)`
- `ipcRenderer.send('set-menu-state', state)` (checkmarks/menu sync)

IPC gestiti nel main:

- `ipcMain.on('add-recent', ...)`
- `ipcMain.handle('save-file-dialog', ...)`
- `ipcMain.handle('save-file', ...)`
- `ipcMain.handle('save-binary-file', ...)` (presente, ma non esposto nel preload)
- `ipcMain.handle('guitar-library-load', ...)` / `ipcMain.handle('guitar-library-save', ...)`

### C. Chiavi `localStorage` (persistenza UI)

Raccolte da `src/components/GrandStaffEditor.tsx`, `src/components/HarmonyAnalysisPanel.tsx`, `src/components/useCustomTypes.ts`, `src/utils/musicTheory.ts`.

- `HT_EDITOR_ZOOM`
- `harmony-tutor.toolbarPrefs.v1`
- `harmony-tutor.staffSystemMode.v1`
- `harmony-tutor.engravingMode.v1`
- `HT_ENABLE_INFERRED_CONTEXTS`
- `harmony.analysis.filters.v1`
- `harmony.analysis.profileDefault.v1`
- `harmony.analysis.sequencesEnabled.v1`
- `harmony.analysis.labelMinSpanBeats.v1`
- `harmony.dev.logR06` (debug)

Chiavi custom (feature chitarra):

- `guitarAppCustomScales`
- `guitarAppCustomChords`
- `guitarAppCustomScaleShapes`
- `guitarAppCustomVoicings`

### D. Export pubblici (API) — `src/utils/musicTheory.ts`

Elenco completo degli `export` (firma non riportata):

Funzioni:

- `applyHarmonyRules`
- `beatsToTicks`
- `calculateAccidental`
- `calculateNoteBeats`
- `calculateRomanFromChordInfo`
- `collectIntervalsAboveBass`
- `computeFiguredBassFromIntervals`
- `computeFiguredBassFromNotes`
- `formatFiguredBass`
- `getActiveNotesTimeline`
- `getChordSymbol`
- `getDyadAsStaffNotes`
- `getEnharmonicPreference`
- `getFretboardNotesAsStaffNotes`
- `getKeySignature`
- `getNotePropertiesFromDiatonicPosition`
- `getNotePropertiesFromMidi`
- `getPitchClassesForDebug`
- `getRomanAnalysis`
- `getRomanAnalysisDebugSnapshot`
- `getScaleAsNoteObjects`
- `getVoicingAsStaffNotes`
- `identifyChordCandidates`
- `normalizeNotePitchFieldsWithKey`
- `rebuildMeasureTimelineForVoice`
- `spelledInterval`
- `ticksToBeats`

Tipi/const:

- `BassInterval`
- `IntervalSet`
- `SpelledInterval`
- `FigureResult`
- `FiguredBassOptions`
- `FIGURED_BASS_UI_OPTIONS`

### E. Export pubblici — pipeline labels & sequenze

`src/utils/harmonyLabelPipeline.ts`:

- tipi: `TimelineEventLike`
- funzioni: `qAbsBeat`, `getNearAbsBeat`, `buildUserHarmonyOverrideMap`, `buildEngineHarmonyOverrideMap`, `isCompoundMeter`, `isStrongPulseInMeasure`, `filterTimelineForHarmonyLabels`, `computeStructuralSnapshotForHarmonyLabelEvent`, `computeLookaheadTonicizationOverrides`

`src/utils/computeHarmonyLabelsBySystem.ts`:

- tipo: `HarmonyLabelPoint`
- funzione: `computeHarmonyLabelsBySystem`

`src/utils/sequenceDetector.ts`:

- tipi: `SequenceLabelPoint`, `SequenceDetectionOptions`
- funzione: `detectVoiceLeadingSequences`

### F. Tipi centrali — `src/types.ts`

Il file definisce (tra gli altri):

- notazione/pitch: `AccidentalType`, `NoteDuration`, `ClefType`, `Voice`, `StaffNote`, `Barline`, `KeySignature`
- tempo: `TimeSignature`, `TimeSignatureChange`
- analisi: `RuleViolation`, `AnalysisContext`, `HarmonyAnalysisResult`, `SequenceMatch`, `HarmonyLabelOverride`

## Mappa scorciatoie (versionata)

Questa sezione replica (in modo leggibile) il contenuto della dialog “Scorciatoie” definita nel menu Electron.

Fonte: `electron/main.js` (funzione `showShortcutsDialog`).

### Menu (app)

- Cmd/Ctrl+N — Nuovo progetto
- Cmd/Ctrl+O — Apri…
- Cmd/Ctrl+I — Importa MIDI…
- Cmd/Ctrl+Shift+E — Esporta MIDI…
- Cmd/Ctrl+P — Stampa
- Cmd/Ctrl+S — Salva
- Cmd/Ctrl+Shift+S — Salva con nome…
- Cmd/Ctrl+W — Chiudi progetto
- Cmd/Ctrl+Z — Annulla | Shift+Cmd/Ctrl+Z — Ripeti
- Cmd/Ctrl+X — Taglia | Cmd/Ctrl+C — Copia | Cmd/Ctrl+V — Incolla | Cmd/Ctrl+A — Seleziona tutto
- Alt/Option+S — Seleziona solo voce corrente (rettangolo)
- Alt/Option+C — Colori voci (BTAS)
- Cmd/Ctrl+] — Aumenta dimensione titolo | Cmd/Ctrl+[ — Diminuisci dimensione titolo

### Grand Staff (Editor)

- Alt/Option+L — Cicla layout righi (grandstaff ↔ SATB antiche ↔ treble-only)
- Alt/Option+T — Mostra/nascondi toolbar
- Space — Play/stop
- ArrowLeft/ArrowRight — Sposta playhead (Shift = passo più fine)
- Enter — Torna a inizio (senza suonare)
- K — Toggle metronomo
- V — Cicla voce selezionata (B→T→A→S)
- T — Toggle legatura (note selezionate)
- 1..7 — Durate (semibreve…semibiscroma)
- R — Toggle inserimento nota/pausa
- . — Toggle punto (accetta anche ">" su alcune tastiere)
- b / n / # — Accidentali (bemolle / bequadro / diesis)
- ArrowUp/ArrowDown — Trasponi (1 semitono) | Shift+ArrowUp/Down — (1 ottava)
- Backspace/Delete — Cancella selezione
- Cmd/Ctrl+C — Copia note selezionate | Cmd/Ctrl+V — Incolla

### Altre viste

- Scale: Cmd/Ctrl+Z undo; Backspace/Delete rimuovi box; Arrow + numeri per muovere/selezionare shape
- Accordi: ArrowLeft/Right voicing prev/next; ArrowUp/Down cambia set corde (se presente)
- Intervalli: Cmd/Ctrl+Z undo

### Funzioni senza scorciatoia dedicata (principali)

- Vista: Scale / Accordi / Intervalli / Editor / Grand Staff (dal menu)
- Riordina toolbar (drag)…
- Numeri misure (toggle dal menu)
- Debug harmony labels (pcs) (toggle dal menu)

---

Se vuoi, posso anche aggiungere una sezione “mappa scorciatoie” duplicando (in modo pulito) il contenuto della dialog shortcuts del menu, così resta versionata qui e non solo nel codice del main.