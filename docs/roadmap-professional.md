# Harmony Tutor — Roadmap "Professional" (baseline)

Ultimo aggiornamento: 2026-02-04.

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

## 1) Definizione di "Professional v1" (scope fissato)

**Professional v1** =
1) Preferenze ordinate e centralizzate (registry + storage + menu sync)
2) Export PDF + PNG affidabili (layout print pulito)
3) Autosave + crash recovery (JSON progetto)
4) Diagnostics export (report riproducibile)

**Esplicitamente fuori da v1 (posticipato):** MusicXML import.
Motivo: è un moltiplicatore di complessità (parser + mapping + edge cases). Lo facciamo come v1.1.

## 2) Timeline unica (baseline)

Questa sezione è una checklist operativa. Ogni task ha:
- **Output**: cosa produce
- **Criteri di accettazione**: cosa deve essere vero per dire “finito”
- **Verifica**: come controlliamo che non abbiamo rotto nulla

### Settimana 1 — Preferences Foundation (B1)
#### B1.1 — Registry preferenze (source of truth)
**Output**
- Un registry unico (TS) che definisce: `id`, `label`, `section`, `default`, `storageKey`, `type`, vincoli/enum dove serve.

**Criteri di accettazione**
- Ogni preferenza UI/menu esistente è presente nel registry.
- Non esistono nuove preferenze che scrivono direttamente in `localStorage` senza passare dal registry.

**Verifica**
- Ricerca testuale: nessuna nuova chiave introdotta fuori dal registry.

#### B1.2 — Storage unificato + migrazioni minime
**Output**
- API unica per leggere/scrivere preferenze (con fallback ai default).
- Migrazioni minime per chiavi esistenti (se rinomini/normalizzi).

**Criteri di accettazione**
- Le preferenze si ripristinano correttamente dopo refresh/restart.
- Un cambio di preferenza non genera crash anche con valori corrotti (sanitizzazione).

**Verifica**
- Prova manuale: forzare valori non validi in localStorage e verificare fallback.

#### B1.3 — PreferencesModal riorganizzato
**Output**
- Modal con sezioni (Editor/Layout/Analisi/MIDI/Export/Debug), wiring al registry.

**Criteri di accettazione**
- Nessun toggle duplicato o incoerente.
- “Reset to defaults” per sezione (o globale) funziona.

**Verifica**
- Apri/chiudi modal, cambia 5–6 preferenze, riavvia, verifica persistenza.

#### B1.4 — Sync menu checkmarks (main) da un solo punto
**Output**
- Un singolo “settings controller” lato renderer che chiama `window.electronAPI.setMenuState(...)` quando cambiano le preferenze rilevanti.

**Criteri di accettazione**
- Checkmarks nel menu riflettono sempre lo stato (anche dopo load progetto o reset).

**Verifica**
- Toggle da menu → modal aggiorna; toggle da modal → menu aggiorna.

### Settimana 2 — Export PDF/PNG (B2)
#### B2.1 — Print mode (layout pulito per export)
**Output**
- Una modalità “print/export” (UI minimale) che rende solo lo spartito + titolo opzionale.

**Criteri di accettazione**
- Toolbar, pannelli, overlay non desiderati non compaiono.
- Le preferenze export controllano cosa includere.

**Verifica**
- Confronto visivo: schermata normale vs print mode.

#### B2.2 — Export PDF (Electron main)
**Output**
- Export PDF affidabile (main) con opzioni base (pagina corrente/tutte, margini, scala).

**Criteri di accettazione**
- PDF generato è leggibile e coerente su 3 progetti sample.
- Error handling: se fallisce, mostra messaggio (menu-error) senza crash.

**Verifica**
- Eseguire export 3 volte di seguito sullo stesso progetto (ripetibilità).

#### B2.3 — Export PNG
**Output**
- Export PNG con risoluzione/scala controllata.

**Criteri di accettazione**
- PNG non tagliato, senza aliasing eccessivo, margini rispettati.

**Verifica**
- Test su progetti con molte battute e su progetti “corti”.

### Settimana 3 — Pro Polish (B4 subset)
#### B4.1 — Autosave + recovery
**Output**
- Autosave a intervallo (configurabile) + recovery all’avvio se esiste sessione non salvata.

**Criteri di accettazione**
- Non crea loop di salvataggio.
- Non rompe undo/redo.

**Verifica**
- Chiudi app “forzatamente” (o simula crash) e verifica recovery.

#### B4.2 — Diagnostics export
**Output**
- Export di un report JSON con: versione app, flavor, preferenze rilevanti, snapshot minimo del progetto.

**Criteri di accettazione**
- Nessun dato sensibile non necessario.
- Report utile per riprodurre un bug tipico.

**Verifica**
- Genera report su 2 progetti diversi e confronta differenze attese.

#### B4.3 — UX essentials in Preferences
**Output**
- Shortcut/label coerenti, reset per sezione o globale, ricerca opzionale se serve.

**Criteri di accettazione**
- L’utente trova i toggle principali in ≤ 2 click.

**Verifica**
- Prova “cold start”: apri modal e trova 5 impostazioni chiave rapidamente.

**Totale Professional v1:** ~3 settimane.

## 3) Professional v1.1 — MusicXML Import (B3)

**Stima:** 2–4 settimane (a seconda dei casi supportati).

### MVP (prime 2 settimane)
Checklist MVP:
- Dialog import + lettura file lato main + invio al renderer via IPC
- Parser + mapping a note/ticks/durate base
- Gestione tie
- Key/time changes semplici

### Estensioni (settimane successive)
Checklist estensioni:
- Tuplets complessi
- Multiple parts
- Cross-staff
- Articolazioni/ornamenti (solo se impattano la resa/analisi)

## 4) Piano A (successivo): Split del monolite, senza rework su B

**Quando:** dopo Professional v1 (oppure in parallelo con estrazioni minime che non toccano comportamento).

### A0 — Preparazione (2–3 giorni)
- Checklist regressioni (mouse matrix, spacing, barlines, undo/redo)
- Golden samples (3–5 file) + script di verifica

### A1 — Estrazioni low-risk (1–2 settimane)
- Project IO fuori dall’editor (serialize/deserialize/migrate)
- Preferences controller/hook (se non già completo)
- Menu action controller/hook

### A2 — Separare Interaction vs Rendering (2–3 settimane)
- Adapter di rendering VexFlow (input state → output draw/metrics)
- Controller interazione (mouse/keyboard/selection) isolato

**Nota:** A resta compatibile con B perché B dipende da contratti (registry settings, project IO, IPC), non dalla posizione del codice.

## 5) Change control (per evitare stime "a fisarmonica")

- Ogni richiesta nuova va classificata: `MUST v1` / `SHOULD v1.1` / `LATER`.
- Se aggiungi una MUST, deve uscire una MUST equivalente (timebox invariato), oppure la timeline si allunga esplicitamente.
- Revisione una volta a settimana (non giornaliera).

## 6) Progetto in divenire: Apprendimento statistico per l'analisi

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
