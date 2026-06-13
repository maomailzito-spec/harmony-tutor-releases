# Harmony Tutor — Roadmap "Professional" (baseline)

Ultimo aggiornamento: 2026-03-12.

Questo file serve a fissare una **timeline unica** e stabile. Le stime cambiano solo in presenza di:
- cambio di scope richiesto esplicitamente (feature aggiunte/rimosse)
- bug bloccanti scoperti (documentati)
- cambiamenti di vincoli tecnici (Electron/VexFlow)

## 0) Assunzioni (perché le stime restino stabili)

- 1 sviluppatore, lavoro "focus" (no support continuo/interrupt).
- Target: macOS (win/linux "best effort").
- Nessun refactor estetico.
- Rendering: solo VexFlow.
- Sicurezza Electron: renderer non usa fs/path.

Se una di queste cambia, la timeline va ricalibrata.

## 1) Professional v1 — ✅ COMPLETATA

Tutto lo scope v1 è stato implementato:
- ✅ Preferenze centralizzate (registry + storage + menu sync) — `src/preferences/`
- ✅ Export PDF + PNG — via `window.electronAPI` + Electron main
- ✅ Autosave + crash recovery
- ✅ PreferencesModal con sezioni, reset, sync menu checkmarks
- ⚠️ Diagnostics export (B4.2) — non implementato, debito tecnico minore

## 2) Professional v1.1 — MusicXML Import — ✅ COMPLETATA

MVP implementato in `src/importers/musicxml/importMusicXML.ts`:
- ✅ Dialog import + IPC
- ✅ Parser + mapping note/durate
- ✅ Tie, Key/time changes
- Estensioni future (tuplets complessi, multi-part, cross-staff) restano possibili ma non prioritarie

## 3) Split del monolite — PARZIALE

GrandStaffEditor ridotto da ~14000 a ~8983 righe. Estrazioni completate:

- ✅ **A0** — Regression suite (43 test), golden samples
- ✅ **A1** — Project IO (`src/services/electronBridge.ts`)
- ✅ **A1** — Preferences controller/hook (`src/preferences/`)
- ✅ **A1** — Menu action controller (`src/contracts/menuActionRuntime.ts`)
- ✅ **A1** — Harmony labels (`src/hooks/useHarmonyLabels.ts`, 4400+ righe)

### A2 — Separare Interaction vs Rendering (DA FARE)
- Adapter di rendering VexFlow (input state → output draw/metrics)
- Controller interazione (mouse/keyboard/selection) isolato
- Prerequisito: completare il refactor AnnotatedNote (Sezione 7) per ridurre la complessità interna

## 4) Change control (per evitare stime "a fisarmonica")

- Ogni richiesta nuova va classificata: `MUST v1` / `SHOULD v1.1` / `LATER`.
- Se aggiungi una MUST, deve uscire una MUST equivalente (timebox invariato), oppure la timeline si allunga esplicitamente.
- Revisione una volta a settimana (non giornaliera).

## 5) Progetto in divenire: Apprendimento statistico per l'analisi

**Stato:** futuro / in valutazione

### Obiettivo
Arricchire l'analisi armonica rule-based con **hint statistici** estratti dal corpus di repertorio (`tests/`), in modo controllato e ispezionabile.

### Cosa si può apprendere dal corpus
- **Soglie ornamenti** — posizione metrica, intervalli e contesto più frequenti per note di passaggio, volta, appoggiature, anticipazioni e note di fuga.
- **Pesi euristici** — calibrare i criteri di riconoscimento su dati reali anziché soglie fisse.
- **Progressioni armoniche attese** — catene di accordi più probabili per stile/periodo, usate come tiebreaker quando le regole producono risultati ambigui.

### Architettura proposta
1. Estendere `buildDefaultStyleProfile.ts` con una sezione `analysisHints`:
   - frequenza ornamenti per posizione metrica e tipo di moto
   - intervalli ornamentali tipici per voce
   - matrice di transizione progressioni armoniche
2. `applyHarmonyRules` consulta `analysisHints` come **disambiguatore**, non come fonte primaria.
3. Le regole base restano deterministiche → stabilità garantita.
4. L'utente controlla il corpus → controlla cosa impara. Nessun "black box".

### Vantaggi
- Nessun modello ML opaco: tutto è un JSON ispezionabile.
- Miglioramento incrementale: più brani = hint più affidabili.
- Retrocompatibilità: senza hint il sistema funziona come prima.

### Piano di unificazione (prossimo passo concreto)

Attualmente esistono due script separati:
| Script | Output | Estrae |
|--------|--------|--------|
| `buildDefaultStyleProfile.ts` | `defaultStyleProfile.json` | Moti vocali (step, skip, leap, commonTone) |
| `extract-progression-stats.ts` | `progressionStats.json` | Bigrammi/trigrammi armonici (con harmonyOverrides) |

**Obiettivo:** fondere tutto in un **unico pipeline** che produce un solo `styleProfile.json` completo.

#### Architettura target
1. **Funzione pura** `buildStyleProfile(files: ProjectFile[])` in `src/engine/styleProfileBuilder.ts`:
   - Estrae moti vocali + bigrammi/trigrammi + soglie ornamenti.
   - Legge: note, `harmonyOverrides`, `ornamentOverrides`, `analysisContexts`.
   - Restituisce un oggetto `StyleProfile` tipizzato.
2. **Wrapper CLI** (`scripts/buildStyleProfile.ts`): legge i file da `tests/`, chiama la funzione, salva il JSON.
3. **Handler IPC** (`electron/main.js` → `build-style-profile`): il bottone "Carica Repertorio" nell'app richiama la stessa funzione via IPC, rigenera il profilo al volo senza uscire dall'editor.
4. **Output unico** `src/data/styleProfile.json`:
   - `voiceMotion`: statistiche moti per voce (da `buildDefaultStyleProfile`)
   - `progressions`: bigrammi/trigrammi (da `extract-progression-stats`)
   - `analysisHints`: soglie ornamenti per posizione metrica (futuro)
   - `meta`: timestamp, numero file analizzati, versione schema

#### Vincoli
- Il profilo resta un JSON piatto, ispezionabile e versionabile.
- Senza profilo il sistema funziona identicamente (fallback a regole pure).
- L'utente controlla il corpus → controlla cosa impara.

---

## Fase F — Analisi & Generazione per Simmetria (Futuro)

Progetto basato sulla ricerca sulle proprietà simmetriche delle strutture musicali
(vedi `docs/simmetria.txt`). Applicabile a livello armonico, melodico e creativo.

### F1 — Analisi armonica di simmetrie e sequenze
- Rilevamento sequenze armoniche (ii-V-I ripetuto trasposto per gradi)
- Simmetria strutturale: periodo antecedente/conseguente (stessa progressione, cadenza diversa)
- Palindromi armonici e archi di tensione simmetrici
- **Pattern Registry** (JSON locale): catalogo strutturato dei pattern ricorrenti

### F2 — Analisi melodica di simmetrie
- Trasposizione melodica (stessa sequenza di intervalli, offset diverso)
- Inversione speculare (moto contrario degli intervalli)
- Retrogradazione e retrogradazione dell'inversione
- Indice di simmetria (metrica quantitativa)

### F3 — Suggerimento creativo armonico
- Completamento per simmetria: A-B → A-B-A' con variazione cadenzale
- Risposta trasposta: dato un periodo, proponi il conseguente
- Sequenza estesa: ii-V-I → iii-VI-ii → ii-V-I

### F4 — Suggerimento creativo melodico
- Generazione varianti: trasposizione, inversione, retrogradazione
- Risposta melodica guidata: domanda → risposta con cadenza risolutiva

### F5 — Apprendimento statistico locale
- Ogni `.hmt` analizzato contribuisce a un corpus locale
- Modello Markov leggero (tutto locale, nessun server)
- L'utente sceglie: "genera nello stile dei corali analizzati"

### Prerequisiti e dipendenze
- **F1** (Pattern Registry) è prerequisito naturale di F5
- L'infrastruttura del **Cadential Pattern Recognizer** (17 formule) è estendibile per F1
- Il **Progression Suggester** (bigram/trigram) è la base per F3/F5
- Nessuno sforzo sprecato: ogni fase alimenta la successiva

---

## Fase G — Localizzazione (i18n: EN/IT)

Obiettivo: permettere all'utente di scegliere la lingua dell'interfaccia (italiano o inglese) dal menu Preferenze.

### G1 — Infrastruttura i18n
- File JSON per lingua: `src/locales/it.json`, `src/locales/en.json`
- Hook `useLocale()` → funzione `t(key)` che ritorna la stringa nella lingua attiva
- Chiave lingua nel Preferences Registry (`ui.language`), persistenza in localStorage
- Selettore lingua nella modale Preferenze (IT/EN)

### G2 — Traduzione stringhe UI
- Menu Electron (File, Modifica/Edit, Vista/View, Analisi/Analysis, Preferenze/Preferences)
- Modali (Preferenze, Salva/Apri, Conferme)
- Tooltip, bottoni, etichette
- Messaggi di errore e stato

### G3 — Menu Electron in lingua
- IPC `set-language` dal renderer al main process
- Ricostruzione menu nativo nella lingua scelta
- Sincronizzazione al cambio lingua (senza restart)

### Note
- **NON va tradotto:** numeri romani (I, IV, V7, vii°), sigle musicali (Dm, F#, Bb), abbreviazioni analitiche (P, S, App)
- Approccio leggero senza librerie esterne (~100-200 stringhe totali)
- Effort stimato: ~1-2 sessioni dedicate

---

## 6) Obiettivo v2 — Pipeline note annotate (AnnotatedNote)

Refactor architetturale della pipeline di note per eliminare la perdita di flag
(isSuspension, isPassing, ecc.) tra i vari stadi del processing.

### AN1 — Unica fonte di verità: `AnnotatedNote`
- Definire un tipo `AnnotatedNote` che estende la nota base con **tutte** le annotazioni (ornamentali, sospensione, tie, etc.)
- Costruire l'array annotato **una sola volta**, a monte, in un passo dedicato: `rawNotes → annotateNotes() → AnnotatedNote[]`
- Unificare in questo modulo la logica oggi sparpagliata tra `applyHarmonyRules`, `lastStructural`, ornament detection, suspension detection

### AN2 — Filtraggio per scopo, mai per copia
- Ogni consumer riceve l'array `AnnotatedNote[]` completo e applica **viste filtrate** (funzioni pure), senza creare copie che perdono i flag
- Esempi: `structuralNotes(notes)` filtra NCT; `harmonicNotes(notes)` filtra suspension-onset; `namingNotes(notes)` include la sostituzione di risoluzione
- Eliminare la proliferazione di array paralleli (`harmonicNotes`, `fallbackHarmonicNotes`, `fullNotes`, `analysisNotes`, `analysisNotesForNaming`)

### AN3 — Eliminare `lastStructural` / `fallbackHarmonicNotes`
- L'accumulator `lastStructural` tiene in vita note di beat precedenti senza le annotazioni originali — è la causa principale della perdita di flag
- Nel refactor, ogni beat accede direttamente alle sue note (dal timeline event) e alle note tenute (calcolate al volo dalle durate), tutte con annotazioni intatte
- Prerequisito: copertura regression completa di tutti i casi di ritardo, appoggiatura e NCT prima di procedere

### Note
- È il cuore dello **split del monolite** (Fase A) e va fatto in passi piccoli e testabili
- Ogni passo deve essere coperto da fixture regression prima di procedere
- Fino ad allora, il workaround pragmatico (filtrare per voce quando esiste una sostituzione) è sufficiente
