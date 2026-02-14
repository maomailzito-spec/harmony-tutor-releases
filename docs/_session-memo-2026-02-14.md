# Session Memo — 14 febbraio 2026

## Stato Attuale del Progetto

### Build & App
- **Build:** `npm run build` → PASSA ✓ (tsc + vite, 530 moduli, 0 errori)
- **App:** Si avvia e renderizza correttamente ✓
- **Stack:** React (Vite) + Electron + Tailwind + VexFlow

---

## Fase 2 — Split GrandStaffEditor.tsx (COMPLETATA ✓)

Il monolite `GrandStaffEditor.tsx` è stato ridotto da **~11.600 → 8.271 righe (−28.7%)**.

### Hook estratti

| File | Righe | Cosa fa |
|---|---|---|
| `src/hooks/useEditorZoom.ts` | 199 | Pinch-to-zoom (trackpad), scroll anchor, reset on bg click, base size measurement via ResizeObserver. Listener wheel nativo con `{ passive: false }` per permettere `preventDefault()`. |
| `src/hooks/useHarmonyLabels.ts` | 3.233 | 8 blocchi `useMemo` che calcolano tutti i dati di overlay armonica: etichette roman numerals + basso figurato, chord symbols, marker di progressione, marker di sequenza, marker di modulazione, marker di time signature. |

### Interfacce dei hook

**useEditorZoom:**
- Params: `scoreScrollRef`, `staffContainerRef` (RefObject)
- Returns: `editorZoom`, `resetEditorZoom`, `handleScoreMouseDownCapture`, `zoomSpacerRef`, `zoomBaseSize`

**useHarmonyLabels:**
- Params (14): `layoutData`, `timeSignature`, `timeSignatureChanges`, `analysisContexts`, `harmonyOverrides`, `currentTonic`, `isMinorMode`, `isAnalysisEnabled`, `isSequencesEnabled`, `staffSystemMode`, `notes`, `analyzedNotes`, `analysisContextAbsBeat` (callback), `timeSignatureChangeAbsBeat` (callback)
- Returns (7): `harmonyLabelsBySystemSequenced`, `progressionMarkersBySystem`, `sequenceMarkersBySystem`, `sequenceModelMarkersBySystem`, `contextMarkersBySystem`, `timeSignatureMarkersBySystem`, `sequenceMatches`
- Costanti layout duplicate: `START_X=50`, `MEASURE_PADDING_X=20`, `TOP_STAFF_TOP=30`, `VF_SATB_SOPRANO_Y=40`

### Bug risolti durante l'estrazione

1. **Schermo bianco all'avvio:** `effectiveAnalysisContexts` era una variabile closure di GrandStaffEditor che è finita nel hook senza essere passata come parametro. Fix: sostituito con `analysisContexts` (equivalente, 5 occorrenze).
2. **Errore tipo TypeScript:** `analysisContextAbsBeat` e `timeSignatureChangeAbsBeat` erano tipizzati come `number[]` nell'interfaccia del hook anziché come callback `(ctx) => number`. Fix: corretto il tipo nell'interfaccia.
3. **`preventDefault inside passive event listener` spammava il terminale:** React attacca i listener `onWheel` come passive. Fix: convertito `handleScoreWheel` da prop React `onWheel` a `addEventListener('wheel', handler, { passive: false })` nativo tramite `useEffect`. Rimosso `handleScoreWheel` dall'API pubblica del hook.

### Import rimossi da GrandStaffEditor.tsx (ora nel hook)
- `detectVoiceLeadingSequences` (sequenceDetector)
- `getActiveNotesTimeline`, `identifyChordCandidates`, `calculateRomanFromChordInfo`, `computeFiguredBassFromNotes`, `FIGURED_BASS_UI_OPTIONS` (musicTheory)

### Fase 1 (sessione precedente — già completata)
Componenti UI estratti:
- `TimeSignatureControl.tsx`
- `ModulationContextMenu.tsx`
- `HarmonyOverrideContextMenu.tsx`

---

## Fase 3 — Playback Engine (SALTATA — decisione consapevole)

L'estrazione del motore di playback (~540 righe) è stata valutata e **scartata** perché:
- Troppo accoppiato: 15+ variabili di stato da passare → params bag enorme
- Timing audio sensibile (requestAnimationFrame + AudioContext scheduling)
- Rischio regressioni rilevabili solo con test manuali
- Guadagno marginale: solo 6.5% del monolite
- Rapporto beneficio/rischio sfavorevole rispetto a Phase 2

---

## Blocchi grandi rimasti in GrandStaffEditor.tsx (8.271 righe)

| Blocco | Righe stimate | Note |
|---|---|---|
| `handleBackgroundClick` | ~670 | Click → inserimento nota, selezione, editing. Deeply coupled. |
| `handleMenuActionLegacy` | ~510 | Switch/case su ogni menu action. Needs ALL state. |
| Keyboard `useEffect` | ~475 | Gestione tutti i tasti. Needs ALL state. |
| Playback engine | ~540 | startPlayback, metronomo, playhead, autoscroll. |
| `pasteClipboardAt` | ~324 | Clipboard + notes + selection. |
| `layoutData` useMemo | ~249 | Core layout computation, usato ovunque. |

Questi blocchi sono troppo intrecciati con lo stato di editing per essere estratti "chirurgicamente" — richiederebbero una ristrutturazione più profonda (state machine, context, reducer).

---

## Progetto Futuro — Chorale Harmonization Engine

### Concept
Creare parti corali a 4 voci (SATB) scrivendo solo i Roman numerals. L'engine genera automaticamente le 4 voci nel rispetto delle regole di voice leading.

### Architettura a 3 livelli

```
┌─────────────────────────┐     StaffNote[]    ┌──────────────────────┐
│ RomanProgressionEditor  │ ──────────────────→ │  GrandStaffEditor    │
│                         │                     │                      │
│  I  IV  V7  I           │     engine puro     │  ♩♩♩♩ (SATB render)  │
│  [Genera]               │ ←── violazioni ───  │  + analisi armonica  │
└─────────────────────────┘                     └──────────────────────┘
```

#### 1. Engine puro — `src/engine/choralRealization.ts` (nuovo)
- **Input:** `RomanProgression[]` → `{ roman: 'I', inversion?: 0, beat: 1, measure: 0 }` + tonica, modo, time signature, regole attive
- **Output:** `StaffNote[]` → formato identico a GrandStaffEditor
- Zero dipendenze React/UI
- Responsabilità: posizione iniziale, voice leading (moto contrario/obliquo, risoluzione sensibile), no 5e/8e parallele, raddoppi, range SATB, crossing/overlap, risoluzione 7me
- **Testabile con unit test puri** (`npx tsx` + test JSON)

#### 2. UI di input — `src/components/RomanProgressionEditor.tsx` (nuovo)
- Pannello dove l'utente scrive la progressione (es. `I - IV - V7 - I`)
- Scelta tonalità, modo, metro
- Configurazione regole (parallele, range, raddoppi)
- Pulsante "Genera" + feedback violazioni

#### 3. Integrazione — ponte minimo con GrandStaffEditor
- Callback `onImportNotes(notes: StaffNote[])` o menu action `GENERATE_FROM_ROMAN`
- GrandStaffEditor riceve `StaffNote[]` e lo tratta come qualsiasi partitura
- Analisi armonica, playback, editing manuale post-generazione → tutto già funzionante

### Ordine di sviluppo suggerito
1. `src/engine/choralRealization.ts` + unit test (isolamento totale)
2. Menu action `GENERATE_FROM_ROMAN` + bridge IPC (contratto Electron)
3. `RomanProgressionEditor.tsx` con UI minimale
4. Integrazione: output → GrandStaffEditor notes
5. Feedback loop: analisi armonica evidenzia violazioni sulla partitura generata (gratis)

---

## File da pulire

- `scripts/_apply_harmony_hook.py` — helper script Phase 2 (eliminare)
- `scripts/_extract_block_info.sh` — helper script Phase 2 (eliminare)
- `logs/_phase2_extraction_memo.txt` — memo vecchio (eliminare)

---

## Git Status
Le modifiche Phase 2 sono **non committate**. Consiglio di fare commit con messaggio tipo:
```
feat: Phase 2 — extract useEditorZoom + useHarmonyLabels from GrandStaffEditor

- Extract useEditorZoom hook (199 lines): pinch-to-zoom, scroll anchor,
  native wheel listener with { passive: false }
- Extract useHarmonyLabels hook (3233 lines): 8 useMemo blocks for
  harmony analysis overlay computation
- Fix: effectiveAnalysisContexts → analysisContexts (was causing white screen)
- Fix: passive event listener warning on wheel handler
- Remove 6 unused imports from GrandStaffEditor
- GrandStaffEditor reduced from ~11,600 to 8,271 lines (-28.7%)
```

---

## Comandi utili
```bash
npm run build          # Build completo (audit + tsc + vite)
npm run dev            # Dev server Vite
npm run electron       # Avvia Electron dev
npm run regress        # Test di regressione
```
