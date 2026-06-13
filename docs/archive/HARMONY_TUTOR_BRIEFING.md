# HARMONY TUTOR — Briefing Completo per Claude Code

> Documento di contesto progetto. Aggiornato: marzo 2026.
> Da usare come riferimento permanente in ogni sessione di lavoro.

---

## 1. Chi è il committente

**Erminio (Mauri)** — musicista, chitarrista e insegnante privato di musica a Milano. Non è uno sviluppatore: usa Claude Opus come coding agent in VSCode e Copilot per inline assistance. Non scrive codice in autonomia.

**Preferenze comunicative:** risposte concise e pragmatiche, priorità chiare, nomenclatura accademica italiana per la teoria musicale, soluzioni semplici quando possibili.

---

## 2. Il prodotto

**Harmony Tutor** è un editor musicale SATB (Soprano, Alto, Tenore, Basso) con motore di analisi armonica automatica in tempo reale. È pensato per la didattica dell'armonia tonale classica a livello conservatorio.

**Slogan:** "Il correttore intelligente di armonia tonale e scrittura a più voci"

**Stato:** App funzionante ~90%, non ancora impacchettata (nessun installer). Non testata su Windows. Beta prevista per metà aprile 2026.

**Riferimento mercato:** Harmony Practice (software canadese/italiano, ora non più mantenuto). Harmony Tutor è considerato superiore sia graficamente che come motore analitico.

**Modello vendita:** Acquisto una tantum — 49€ studente / 79€ docente / 200€+ istituto. Piattaforma: Gumroad o LemonSqueezy.

**Versione gratuita:** max 8 battute, solo errori gravi, no export PDF.

---

## 3. Stack tecnologico

| Componente | Tecnologia |
|---|---|
| Frontend | React (Vite) + TypeScript + Tailwind CSS |
| Desktop | Electron (main + preload + renderer) |
| Rendering musicale | **VexFlow** (esclusivo — non suggerire altre librerie grafiche) |
| Audio | Web Audio API + Soundfont (FluidR3 GM, 12 strumenti per voce) |
| MIDI | Web MIDI API (canali separati per voce, compatibile con DAW) |
| Persistenza | localStorage + file .json |
| IPC | Bridge tipizzato Electron ↔ React |
| Test | Regression suite (`npm run regress`), fixture JSON in `tests/` |

---

## 4. File principali

| File | Ruolo | Note |
|---|---|---|
| `src/components/GrandStaffEditor.tsx` | God component — editor monolitico principale | ~8000+ righe |
| `src/utils/musicTheory.ts` | Cuore del motore analisi | ~11000+ righe |
| `src/hooks/useHarmonyLabels.ts` | Calcolo numeri romani | ~4200 righe |
| `src/components/VexflowGrandStaff.tsx` | Rendering VexFlow (SVG) | |
| `src/components/HarmonyAnalysisPanel.tsx` | Pannello analisi laterale | |
| `src/utils/harmonyLabelPipeline.ts` | Override, lookahead tonicizzazioni | |
| `src/utils/computeHarmonyLabelsBySystem.ts` | Posizionamento etichette per rigo/pagina | |
| `src/utils/sequenceDetector.ts` | Rilevamento sequenze voice-leading | |
| `src/utils/cadentialPatterns.ts` | Pattern cadenziali (PAC, IAC, HC, DC) | |
| `src/engine/choralRealization.ts` | Realizzatore corali (beam-search ampiezza 8) | |
| `src/engine/defaultStyleProfile.json` | Profilo corpus pre-costruito | |
| `src/data/progressionStats.json` | Statistiche progressioni (bigram/trigram) | |
| `src/components/RomanProgressionEditor.tsx` | UI per inserimento progressioni | |
| `src/types.ts` | Tipi condivisi: StaffNote, RuleViolation, AnalysisContext, HarmonyLabelOverride, SequenceMatch | |
| `electron/main.js` | Menu + IPC main + file system | |
| `electron/preload.js` | API bridge sicuro → window.electronAPI | |
| `tests/` | Cartella corpus (~216 file .json/.htp) | |

---

## 5. Comandi essenziali

```bash
# Avvio
npm run dev:grandstaff        # avvia in modalità GrandStaff
npm run dev:guitar            # avvia in modalità Guitar
npm run electron:dev          # avvia come app Electron desktop

# Corpus e test
npm run rebuild-corpus        # rigenera progressionStats + ornamentPatterns + defaultStyleProfile
npm run regress               # regression suite (attualmente 44/44 test passing)

# Git
git add . && git commit -m "nome-checkpoint"
git log --oneline -30
git reset --hard CODICE       # ripristina a un checkpoint
```

---

## 6. Pipeline di analisi armonica (8 blocchi)

La pipeline trasforma le note inserite dall'utente in etichette armoniche visualizzate sotto il pentagramma.

### Blocco 1 — Input
**File:** `GrandStaffEditor.tsx`
`StaffNote[]` in stato undoable. `calculateNoteBeats` assegna `measureIndex` + `beat` a ogni nota.
**Produce:** `StaffNote[]`, `analysisContexts`

### Blocco 2 — VexFlow Rendering
**File:** `VexflowGrandStaff.tsx`
`useEffect` crea Renderer SVG, disegna staves/note/beam/legature. Produce `layoutData` (coordinate x per ogni beat).

### Blocco 3 — Timeline & Ornament Detector (2 pass)
**File:** `musicTheory.ts` → `getActiveNotesTimeline()`, `applyHarmonyRules()`
- Scansiona ogni punto temporale, raggruppa note simultanee in "fette verticali"
- **1° pass:** pattern ovvi (passaggio, volta, appoggiatura, anticipazione, sfuggita, sospensione)
- **2° pass:** `isConsonantToHarmony()` — usa solo le note *non ornamentali* per identificare l'accordo
- **IMPORTANTE:** il 2° pass deve filtrare le note già classificate come ornamentali prima di chiamare `identifyChord()`. Senza questo filtro, le note ornamentali inquinano l'identificazione accordale.
**Produce:** `analyzedNotes` (con flag ornamento), `violations[]`

### Blocco 4 — Identificazione Accordo
**File:** `musicTheory.ts` → `identifyChordCandidates()`, `spelledInterval()`, `collectIntervalsAboveBass()`
- Analisi basata su **spelling** (nomi delle note, non solo MIDI) — principio fondamentale del progetto
- Calcola pile di terze, restituisce candidati ordinati per plausibilità
**Produce:** lista candidati `{ root, quality, inversion, score }`

### Blocco 5 — Roman Numeral Computation
**File:** `useHarmonyLabels.ts` → `getRomanAnalysis()`
Per ogni fetta verticale: identificazione accordo nel contesto della tonalità attiva. Gestisce:
- Dominanti secondarie (V/x, vii°/x)
- Accordi incompleti (dyad rescue)
- Bassi senza radice (rootless)
- Sospensioni
- Catena di step R0–R14 (R14 = corpusBias, ultimo step, usa bigram corpus per disambiguare)
**Produce:** `{ roman, figures, root }`

### Blocco 5a — Cadential Patterns
**File:** `cadentialPatterns.ts` → `evaluateCadentialPatterns()`
Finestra scorrevole di formule cadenziali (V→I, ii→V→I, vii°→I…) testata su 12 toniche candidate.
**Produce:** `CadentialMatch[]` che diventano contesti temporanei

### Blocco 5b — Lookahead Tonicizations
**File:** `harmonyLabelPipeline.ts` → `computeLookaheadTonicizationOverrides()`
Guarda 2 misure avanti per individuare tonicizzazioni (V/x → x).
**Produce:** `autoRomanDisplayByAbsBeat` per mostrare pivot labels

### Blocco 6 — Regole SATB
**File:** `musicTheory.ts` → `applyHarmonyRules()`
Applica le regole R-01…R-17 + estese. Produce `RuleViolation[]` con severità `error` / `warning` / `exception`.
(Vedi sezione 8 per l'elenco completo)

### Blocco 7 — Sequence Detection
**File:** `sequenceDetector.ts` → `detectVoiceLeadingSequences()`
Costruisce snapshot intervallari tick-per-tick, matcha modello + copie trasposte.
**Produce:** `sequenceRoman`, `sequenceRomanFunctional`

### Blocco 8 — Label Rendering
**File:** `GrandStaffEditor.tsx`
Priorità di visualizzazione: `romanDisplay` ?? `sequenceRomanFunctional` ?? `seqRoman` ?? `roman`
Le cifre del basso figurato appaiono sotto il numero romano.

---

## 7. Realizzatore Corali (Fase 3)

**File:** `src/engine/choralRealization.ts`
Beam-search con ampiezza 8, funzione costo hard/soft/bonus corpus.
**UI:** `RomanProgressionEditor.tsx`
Il corpus guida le scelte di inversione e voice-leading tramite `defaultStyleProfile.json`.

### Sintassi Roman Progression Editor

```
I ii IV V vi viio        — grado (maiuscolo=Magg, minuscolo=min)
I6 I6/4 I64              — inversioni (1°, 2°)
V7 ii7                   — settima
V6/5 V4/3 V4/2           — inversioni settime
viio vii°                — diminuito
iiø7                     — semidiminuito
bII bVII #IV             — gradi cromatici
V/V V7/IV viio/ii        — dominanti secondarie
It6 Fr6 Ger6             — seste eccedenti
→G: →Bb: →f#:            — modulazione (maiusc=Magg, minusc=min)
|                        — stanghetta (forza nuova misura)
```

---

## 8. Regole SATB — Elenco completo

### Errori (error) — marker rosso
| ruleId | Descrizione |
|---|---|
| R-01 | Ottave/unisoni paralleli |
| R-02 | Quinte parallele |
| R-02c | Quinte consecutive per moto contrario |
| R-04 | Incrocio di voci grave |
| R-06 | Risoluzione errata di salto diminuito/aumentato |
| R-07 | Mancata risoluzione della sensibile |
| R-09 | Falsa relazione cromatica tra voci (tra accordi consecutivi) |
| R-10 | Raddoppio della sensibile |
| R-10-7TH | Raddoppio della settima dell'accordo |
| R-10-DIM5 | Raddoppio della quinta diminuita |
| R-10-64 | Raddoppio nel 6/4 cadenzale |
| R-12 | Mancata risoluzione della settima |

### Warning (warning) — marker arancione
| ruleId | Descrizione |
|---|---|
| R-05 | Quinte/ottave dirette (nascoste) tra voci estreme |
| R-08 | Spaziatura eccessiva tra S–A o A–T (oltre l'ottava) |
| R-13 | Tutte le voci nella stessa direzione |
| R-14 | Moto simile tra voci estreme |
| R-15 | Salto ampio in voce interna (Alto/Tenore > 6ª) |
| R-16 | Sincope armonica — regola della stanghetta |
| R-17a | Salto di 7ª/9ª melodica |
| R-17b | 7ª/9ª percorsa in due movimenti senza grado congiunto |
| R-17c | Successione di tritono delineata in 2+ movimenti |
| R-CHORD-COMPLETE | Accordo incompleto |
| R-RANGE | Nota fuori registro SATB |
| R-SPACING-TB | Spaziatura eccessiva Tenore-Basso (>2 ottave + 5ª) |
| R-N-RES | Napoletana (N) che non risolve verso V |
| R-AUG6-RES | It+/Fr+/Ger+ che non risolvono verso V |
| R-CAD64 | 6/4 cadenzale che non risolve su V |

### Eccezioni (exception) — marker verde
| ruleId | Descrizione |
|---|---|
| EXC-M03 | Parallele per moto contrario (tollerate) |
| EXC-M04 | Perfetta per moto obliquo (tollerata) |
| EXC-OBL-PERF | 5ª/8ª giusta per moto obliquo |
| EXC-Hidden-Stepwise | Nascoste tollerate (soprano per grado congiunto) |
| EXC-Hidden-BassStep | Nascosta ammessa (basso per grado congiunto) |
| EXC-S02 | Incrocio Alto/Tenore tollerato |
| EXC-Unison-Lower | Unisono voci basse per moto contrario/obliquo |
| EXC-LT-Transfer | Sensibile trasferita ad altra voce |
| EXC-LT-Chromatic | Sensibile in linea cromatica — eccezione |
| EXC-7m01 | Settima libera tollerata |
| EXC-7-FREE | Settima minore risolta liberamente |
| EXC-7-TRANSFERRED-RES | Risoluzione settima trasferita in altra voce |
| S-strict | Sospensione/ritardo riconosciuto correttamente |

### Severity avanzata — marker viola
Una quarta severity level (violet) distingue "armonia cromatica avanzata — non convenzionale in contesto accademico, legittima in altri stili" (es. CHROM-AUG6-VAR per varianti bII+6).

---

## 9. Stato del corpus (marzo 2026)

| Metrica | Valore |
|---|---|
| File totali | 216 |
| File analizzati | 213 |
| Transizioni raw | 6.338 |
| Trigram base keys | 623 |
| Campioni ornamento | 497 |
| File in profilo stile | 180 |
| Top bigram | V5→I5: 95 occorrenze |
| Regression suite | 44/44 passing |

**Compositori presenti:** Bach (cantate e corali ~25 file), Dubois (~20), Pedron (7), Schinelli (5), ornamenti/ritardi (~30 piccoli), progressioni manuali (~15), Vivaldi Gloria, Piston, Michel Baron, Tesoro sopra tutti i tesori.

**Distribuzione ornamenti (497 campioni):** passing 53.5%, appoggiatura 21.7%, suspension 12.8%, neighbor 6.8%, anticipation 3.3%, escape 1.9%

**Riferimenti teorici:** Dubois (fonte primaria corpus, libro soluzioni completo), Pedron, Delamont vol. 2 (armonia cromatica — indice mappato, cap. 2 coperto), Piston.

---

## 10. Principi di analisi — Spelling-First

Il motore analizza gli accordi basandosi sui **nomi delle note** (spelling), non solo sui numeri MIDI. Questo è il principio fondamentale di tutto il sistema:
- Distingue correttamente intervalli enarmonici (es. A4 vs d5)
- L'analisi cromatica dipende dalla conservazione dell'ortografia originale delle note
- **La normalizzazione enarmonica (E#→F, C##→D) deve avvenire DOPO il matching degli accordi eccedenti**, non prima — altrimenti si distrugge l'informazione necessaria per il riconoscimento

---

## 11. Implementazioni recenti

| Feature | Dettaglio |
|---|---|
| CHROM-AUG6-VAR | Varianti cromatiche bII+6 (8x/5x/3+ forme, inversioni), label viola, filtro "Cromatici" |
| V/bVI | Dominanti secondarie su gradi cromatici |
| ornamentOverride | Propagato correttamente in `_gRA`/`_iC`/`isOrnamental` |
| V9 strutturale | 9M/9m con inversioni riconosciuti |
| Notehead/accidentali | Fix rendering cross-voice su bass staff |
| Picardy third | Riconoscimento sulla triade maggiore di tonica al termine di brano in minore |

---

## 12. Bug noti e issue aperti

### Priorità alta (pre-beta)
1. **Aug6 matchers incompleti:** i matcher (Ger+, Fr+, It+) cercano solo gradi diatonici come target di risoluzione. Fix necessario: estendere all'unione dei gradi maggiore+minore. Inoltre, l'ottava eccedente (ottava più che eccedente) non è ancora riconosciuta dai template matcher.
2. **Normalizzazione enarmonica prematura:** la normalizzazione (E#→F, C##→D) causa misclassificazione prima che i matcher aug6 possano valutare. Es.: in Re maggiore, Eb/A/E#/C# viene etichettato bIII 4/#6 invece di bII+6 con ottava eccedente.
3. **Falsa relazione verticale:** servono una nuova regola e un nuovo ruleId per clash cromatici all'interno dello stesso accordo (distinto da R-09, che controlla solo accordi consecutivi).

### Differiti post-beta
- `lastStructuralByVoiceBySystem` — bug note stantie (deferred)
- Refactor architetturale `AnnotatedNote` (AN1/AN2/AN3)
- Picardy third esteso a cadenze interne (attualmente solo accordo finale)
- Drag-to-resize larghezza misure in GrandStaffEditor.tsx
- MusicXML importer (conversione da output Audiveris o file IMSLP/MuseScore in JSON interno)
- Modal switch feature (Phrygian, Dorian, etc.) — UI già rileva modo probabile, estensione pianificata per influenzare interpretazione Roman numeral e severity

---

## 13. Debug della pipeline

### Debug beat specifico
```javascript
// Console Electron: Cmd+Option+I → tab Console
window._HT_DEBUG_BEAT = 44    // numero del beat problematico
// Ricarica: Cmd+R
// Output: gruppo collapsabile [HT-DEBUG] beat X con 17 step (R0–R13, D1–D2)
// Trova lo step dove roman cambia da corretto a sbagliato
delete window._HT_DEBUG_BEAT   // per disattivare
```

### Calcolo absBeat
`absBeat = (measureIndex - 1) × beatPerMeasure + beat`
Es: misura 11, battito 4, tempo 4/4 → (11-1)×4 + 4 = 44

### Toggle cadential patterns
```javascript
localStorage.setItem('harmony-tutor.analysis.cadentialPatterns.v1', 'false')  // off
localStorage.removeItem('harmony-tutor.analysis.cadentialPatterns.v1')         // on
```

### Diagnostica bug note stantie
Rimuovi note una voce alla volta dall'accordo precedente fino a che il numero romano si corregge. Annota la voce offendente come: `[brano] m[misura] b[beat] — voce [S/A/T/B] stantia`

---

## 14. Corpus — come funziona l'apprendimento

### Impara automaticamente al salvataggio
- Successioni di accordi (bigram/trigram) → migliorano suggerimenti
- Correzioni manuali (override) → entrano nel corpus
- Modulazioni segnate → pattern tonicizzazione appresi nella tonalità locale

### Impara tramite UI (tab Corali)
- "📚 Carica da repertorio" → importa profilo pre-calcolato (~180 brani)
- "🎓 Apprendi da questo file" → aggiorna profilo con brano corrente

### NON impara dinamicamente
- Correzioni ornamenti → serve `npm run rebuild-corpus`
- Regole di analisi → fisse nel codice sorgente

### Ciclo di aggiornamento
1. Salva file in `tests/`
2. `npm run rebuild-corpus`
3. `npm run build`
4. Riavvia l'app
5. Tab Corali → "📚 Carica da repertorio"

---

## 15. Formato dati progetto (JSON)

Il file progetto salvato contiene:
- `notes`: array di `StaffNote` normalizzate
- `staffSystemMode`: `grandstaff` | `satb_ancient` | `treble_only`
- Tonalità: `keySignatureRoot`, `isMinorMode`, `minorScaleMode`, `keyChangeMode`, `modalTonicOverride`
- UI: `projectTitle`, `titleFontSize`, `titleFontFamily`, `toolbarGroupOrder`
- Tempo: `timeSignature`, `timeSignatureChanges`, `bpm`, `isBpmActive`
- Analisi: `analysisContexts`, `harmonyOverrides`
- Layout: `doubleBarlineMeasures`, `measuresPerLine`, `minMeasureCount`

---

## 16. Build variants (Flavor)

Variabile `VITE_APP_FLAVOR` (letto da `src/flavor.ts`):
- **united**: tutte le viste (scale, accordi, intervalli, editor, grandStaff)
- **grandstaff**: solo GrandStaff (analisi armonica)
- **guitar**: scale + accordi + intervalli + editor (no grandStaff)

---

## 17. Chiavi localStorage

```
HT_EDITOR_ZOOM
harmony-tutor.toolbarPrefs.v1
harmony-tutor.staffSystemMode.v1
harmony-tutor.engravingMode.v1
HT_ENABLE_INFERRED_CONTEXTS
harmony.analysis.filters.v1
harmony.analysis.sequencesEnabled.v1
harmony.analysis.labelMinSpanBeats.v1
harmony-tutor.analysis.cadentialPatterns.v1
```

---

## 18. Workflow operativo

### Pattern di lavoro standard
1. Inserisci esercizio (Dubois, Pedron, Delamont, Bach MIDI)
2. Bug trovato → passa immediatamente a Claude Code per il fix
3. Fix implementato → continua inserimento

### Formato annotazione failure per corpus
Quando raccogli casi di errore dal motore, usa questo formato:
```
Pagina: X | Tonalità: Y | Note SATB: S=... A=... T=... B=...
Label atteso: ... | Label attuale: ...
```
Raccogli più casi prima di commissionare un fix.

### Regression
- `expectsViolations` e `forbidsViolations` sono l'infrastruttura di test
- Claude Code annota candidati `forbidsViolations` in `TODO_forbids.md` durante le sessioni di fix
- Dopo modifiche al codice non coperte dalla regression suite: `npm run rebuild-corpus` e confronto su tutti i file

---

## 19. Regole di comportamento (tolleranza zero)

1. **Non rompere il build:** prima di proporre codice, verifica che variabili e importazioni esistano.
2. **Soluzioni semplici:** proponi sempre la via meno invasiva. Se esiste una funzione nativa, usala.
3. **Consistenza Spelling-First:** mantieni la logica spelling-first per l'analisi. Non fidarti del MIDI per distinguere intervalli enarmonici.
4. **Electron:** React non può usare `fs` o `path` direttamente. Tutto passa dal `preload.js`.
5. **VexFlow esclusivo:** non suggerire altre librerie per il rendering musicale.
6. **Risposte concise:** solo il codice necessario o indicazioni precise su dove inserirlo.
7. **Segnala conflitti:** se rilevi un conflitto con queste istruzioni, avvisa immediatamente.
8. **Pipeline separate:** `computeHarmonyLabelsBySystem` (standalone) e hook/UI pipeline sono separate. Cambiamenti a funzioni condivise (es. `isResolvingDissonanceForLabels`) impattano entrambe.
9. **Enharmonic ordering:** la normalizzazione enarmonica deve avvenire DOPO il matching degli accordi eccedenti, non prima.
10. **Seventh protection:** la funzione `isResolvingDissonanceForLabels` non deve trattare le note dell'accordo (incluse le settime) come dissonanze da risolvere. Funzione mantenuta attiva pre-beta.

---

## 20. Funzioni principali esportate da musicTheory.ts

| Funzione | Descrizione |
|---|---|
| `applyHarmonyRules` | Analisi completa: accordi, NCT, violazioni |
| `getRomanAnalysis` | Numeri romani + basso figurato + sigla |
| `identifyChordCandidates` | Candidati accordali per un set di note |
| `computeFiguredBassFromNotes` | Calcolo basso figurato |
| `getKeySignature` | Armatura di chiave per tonalità/modo |
| `spelledInterval` | Intervallo "spelled" (non solo semitoni) |
| `calculateAccidental` | Alterazione nel contesto della tonalità |
| `normalizeNotePitchFieldsWithKey` | Normalizzazione pitch/spelling |
| `rebuildMeasureTimelineForVoice` | Ricostruzione timeline per voce |
| `getActiveNotesTimeline` | Note attive in una posizione |
| `getNotePropertiesFromMidi` | MIDI → proprietà nota |

---

## 21. Scorciatoie da tastiera

### Menu app
- `Cmd/Ctrl+N` Nuovo | `Cmd/Ctrl+O` Apri | `Cmd/Ctrl+S` Salva | `Cmd/Ctrl+Shift+S` Salva con nome
- `Cmd/Ctrl+I` Importa MIDI | `Cmd/Ctrl+Shift+E` Esporta MIDI | `Cmd/Ctrl+W` Chiudi
- `Cmd/Ctrl+Z` Annulla | `Shift+Cmd/Ctrl+Z` Ripeti

### Editor
- `Space` Play/stop | `Enter` Torna a inizio
- `V` Cicla voce (B→T→A→S) | `K` Toggle metronomo
- `1..7` Durate (semibreve→semibiscroma) | `R` Nota/pausa | `.` Punto
- `b/n/#` Accidentali | `T` Toggle legatura
- `↑/↓` Trasponi 1 semitono | `Shift+↑/↓` 1 ottava
- `Backspace/Delete` Cancella | `Alt/Option+L` Cicla layout | `Alt/Option+T` Toolbar | `Alt/Option+H` Overlay analisi

---

## 22. Temi aperti / Roadmap

### Pre-beta (urgente)
- Fix aug6 matchers (ottava eccedente + unione scale maggiore/minore per target risoluzione)
- Regola falsa relazione verticale (nuovo ruleId)
- Continuare inserimento esercizi Delamont vol. 2 per raccogliere failure cases

### Post-beta
- Test su Windows + impacchettamento installer
- MusicXML importer
- Modal switch feature (modo attivo influenza Roman numeral + severity)
- Drag-to-resize misure
- Refactor AnnotatedNote (AN1/AN2/AN3)
- Piano ristrutturazione GrandStaffEditor.tsx (Fase 1: Electron bridge, Fase 2: Registry menu-action, Fase 3: Centralizzazione localStorage, Fase 4: AnalysisProfile)

### Lancio
- Sito web pagina singola + video demo
- Contatto docenti conservatorio (licenze gratuite in beta)
- Outreach: Francesco Villa (YouTube, analisi armonica, autore "L'orecchio tonale") e Marco Zanoni (conservatorio, Logic Pro) — attendere prodotto pronto

---

## 23. Lezioni apprese (da non ripetere)

1. **Normalizzazione enarmonica:** deve avvenire DOPO aug6 matching, non prima.
2. **isResolvingDissonanceForLabels:** non deve trattare chord tones (incluse settime) come dissonanze.
3. **Bug inversioni in minore:** `buildDefaultStyleProfile.ts` usava `keySignatureRoot` direttamente come tonica minore (es. 'C' invece di 'A' per La minore). Fix: calcolare relativa minore reale quando `isMinor=true`.
4. **Picardy third:** richiede guardia posizionale — una triade maggiore di tonica a metà brano in minore può essere legittimamente una tonicizzazione.
5. **Esercizi Delamont vol. 2:** molto corti (8–26 eventi) — utili per failure cases mirati, non per crescita bulk del corpus.
6. **Documenti con numeri specifici:** citare cifre esatte, non ragionare genericamente. Ammettere incertezza prima se pressati.
