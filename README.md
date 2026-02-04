# React + TypeScript + Vite

## Start here (direttive progetto)

Se riparti dopo tempo o la chat si resetta, leggi:

- START-HERE.md
- docs/project-directives.md
- docs/capabilities.md

## Harmony Tutor – Regole/UX implementate

### Selezione
- **Marquee “solo voce corrente”**: opzione persistente nel menu Modifica; equivalente a tenere premuto Alt/Option durante la selezione a rettangolo.
- **Scorciatoia**: `Alt/Option + S` per attivare/disattivare “solo voce corrente”.
- **Feedback visivo**: rettangolo di selezione tratteggiato quando è attivo il filtro per voce.

### Inserimento (evita conflitti con selezione)
- In **modalità inserimento** l’inserimento su spazio vuoto resta prioritario.
- Il **click sulla testa** di una nota esistente seleziona la nota e aggiorna la voce corrente.
- Quando le note sono **molto vicine** (2e/3e) o sovrapposte, **Alt/Option + click** aiuta a selezionare (senza inserire) e permette di ciclare tra candidati.

### File Recenti
- La lista “Recenti” è persistente tra i riavvii tramite un JSON salvato in `Electron userData`.

### Modalità chitarra / solo chiave di violino
- Modalità **solo pentagramma in chiave di violino** (treble-only).
- **Playback** trasposto di **-12 semitoni** (ottava sotto).
- Persistenza per documento: `staffSystemMode` viene salvato/caricato nel progetto.

### Toolbar
- **Riordina toolbar (drag)…** nel menu Vista: abilita/disabilita la modalità di riordino tramite drag direttamente sulla toolbar (senza pannello dedicato).
- **Drag & drop** per riordinare i gruppi direttamente sulla toolbar quando la modalità è attiva.
- **“Numeri misure”** rimosso dalla toolbar e gestito dal menu Vista (checkbox).
- Toggle analisi compatti: **V7** (Numeri Romani) e **G7** (Sigle).
- Switch **Analisi/Editor**: un solo pulsante toggle che cambia etichetta (Analisi ↔ Editor).
- **MIDI** compattato: un solo pulsante con dropdown per scegliere il MIDI Out (incluso “Audio Interno”), chiudibile con click fuori / `Esc`.

### Scorciatoie tastiera (Grand Staff editor)

#### Layout / View
- **Alt/Option + L**: cicla la vista del pentagramma tra **Grand Staff**, **SATB antiche (4 righi)** e gli altri sistemi disponibili.
  - Azione **solo di vista**: non modifica note, voci, ritmo o stato dell’analisi.

#### Pause
- **R**: **toggle** tra inserimento **nota** ↔ **pausa**.
  - La durata segue il valore ritmico corrente (inclusi **punto**, **terzina/duina** se attivi).

#### Ottave
- **Shift + Freccia Su**: sposta le note selezionate **+1 ottava**.
- **Shift + Freccia Giù**: sposta le note selezionate **-1 ottava**.

### Rendering (VexFlow)
- Le **pause** non ricevono più modificatori di alterazione (evita “alterazioni fantasma” dopo cancellazioni/modifiche).
- La **ghost note** in inserimento mostra anche l’alterazione selezionata; l’alterazione della ghost viene inoltre spostata a sinistra per evitare sovrapposizioni con la testa della nota.

## Regole/eccezioni in musicTheory

Queste regole sono implementate nel motore di analisi in [src/utils/musicTheory.ts](src/utils/musicTheory.ts), principalmente dentro `applyHarmonyRules`.

### Tabella rapida (ruleId → severità)

| ruleId | severità | note |
| --- | --- | --- |
| R-01 | error | Ottave/unisoni paralleli |
| R-02 | error | Quinte parallele (salvo eccezioni) |
| EXC-M03 | exception | Downgrade: “finta” quinta parallela con 7ª |
| EXC-M04 | exception | Downgrade: minore vi → V |
| R-04 | error | Incrocio di voci grave |
| EXC-S02 | warning | Incrocio Alto/Tenore tollerato |
| R-05 | warning | Quinte/ottave dirette (nascoste) con salto al Soprano (incl. S–B, S–A) |
| EXC-Hidden-Stepwise | exception | Eccezione quando il Soprano procede per grado |
| EXC-Hidden-BassStep | exception | Attenuante: basso per grado + salto piccolo al Soprano |
| EXC-OBL-PERF | exception | Marker: quinte/ottave successive con moto obliquo (una voce ferma) |
| R-06 | error | Risoluzione errata di salti aumentati/diminuiti |
| R-07 | error/warning | Sensibile: error voci esterne, warning interne |
| EXC-LT-Transfer | exception | Risoluzione sensibile trasferita |
| R-08 | warning | Spaziatura eccessiva tra voci adiacenti |
| R-09 | error | Falsa relazione cromatica |
| R-10 | error | Raddoppio della sensibile |
| R-10-7TH | error | Raddoppio della 7ª dell’accordo |
| R-10-64 | warning | Raddoppio atipico in 6/4 (2ª inversione) |
| R-10-3RD | warning | Preferenza: evitare 3ª raddoppiata in stato fondamentale |
| R-10-6 | warning | Preferenza raddoppio in 6: gradi forti/deboli |
| R-12 | error | Risoluzione errata della 7ª |
| EXC-7m01 | exception | Risoluzione 7ª trasferita in un’altra voce |
| R-13 | warning | Moto parallelo di tutte le voci |
| R-14 | warning | Moto simile tra voci estreme |
| R-15 | warning | Salti ampi in voci interne |
| R-16 | warning | Sincope armonica (“regola della stanghetta”) |
| ORN-NEIGH | exception | Marker: nota di volta riconosciuta (condotta ok) |
| R-ORN-NEIGH | warning | Nota di volta sospetta/atipica (es. su tempo forte) |
| ORN-APP | exception | Marker: appoggiatura riconosciuta (condotta ok) |
| R-ORN-APP | warning | Appoggiatura sospetta/atipica |
| ORN-ANT | exception | Marker: anticipazione riconosciuta (breve, tempo debole) |
| R-ORN-ANT | warning | Anticipazione lunga o su tempo forte |
| ORN-ESC | exception | Marker: nota di sfuggita riconosciuta |
| R-ORN-ESC | warning | Sfuggita sospetta (es. su tempo forte) |
| R-N-RES | warning | Napolitana: risoluzione attesa verso V |
| R-AUG6-RES | warning | Seste aumentate: risoluzione attesa verso V |
| R-CAD64 | warning | 6/4 cadenziale: risoluzione attesa su V |
| R-CHORD-COMPLETE | warning | Accordi incompleti (manca 3ª/7ª) |
| R-SPACING-TB | warning | Spaziatura eccessiva Tenore–Basso (> 2 ottave + 5a) |
| R-RANGE | warning | Note fuori dal registro tipico SATB |
| S-strict | exception | Connessione/marker per sospensione/ritardo riconosciuto |
| CAD-PAC | exception | Marker informativo: cadenza autentica perfetta |
| CAD-IAC | exception | Marker informativo: cadenza autentica imperfetta |
| CAD-HC | exception | Marker informativo: semicadenza |
| CAD-PLAG | exception | Marker informativo: cadenza plagale |

### Motore di analisi (contesto)
- L’analisi supporta cambi di contesto (tonica/modo) tramite `analysisContexts` e selezione del contesto attivo per `absBeat`.
- La timeline armonica considera note sostenute e cambi di durata: gli “eventi d’accordo” vengono costruiti sui punti di inizio/fine nota.
- Riconoscimento automatico di **note di passaggio** (`isPassing`) su tempi deboli con moto congiunto; esclusione quando coinvolte in ritardi/sospensioni.
- Classificazione di altre **note estranee** (euristiche): **nota di volta** (neighbor), **anticipazione**, **appoggiatura**, **nota di sfuggita** (escape).
  - Marker compatti sul pentagramma: **v** = nota di volta, **a** = anticipazione.
  - Le **appoggiature** vengono trattate come note estranee per evitare **numerazioni/accordi fuorvianti** nell’analisi (non servono voci dedicate nel pannello: contano soprattutto per il filtraggio dell’armonia).
- Riconoscimento di **ritardi/sospensioni** con connessione “verde” `S-strict` quando preparazione, dissonanza al cambio armonico e risoluzione per grado sono coerenti (con gestione dedicata delle 6-5).

### Regole verticali (stesso evento armonico)
- **R-04**: incrocio di voci (error). **EXC-S02**: incrocio Alto/Tenore tollerato (warning).
- **R-08**: spaziatura eccessiva tra S-A o A-T oltre l’ottava (warning).
- **R-SPACING-TB**: spaziatura eccessiva tra Tenore e Basso oltre 2 ottave + 5a (warning).
- **R-10**: raddoppio della sensibile (error).
- **R-10-7TH**: raddoppio della 7ª dell’accordo (error).
- **R-10-64**: in un 6/4 (2ª inversione) raddoppio preferibile della 5ª/basso; segnala raddoppi “atipici” (warning).
- **R-10-3RD**: preferenza (conservativa) — in triadi in stato fondamentale a 4 voci, segnala quando è raddoppiata la 3ª invece della fondamentale (warning).
- **R-10-6**: preferenza (conservativa) — in triadi in primo rivolto (6):
  - se il **basso** (3ª dell’accordo) è un **grado forte** (I/IV/V; talvolta II), suggerisce di raddoppiare il basso.
  - se il basso è un **grado debole** (III/VI/VII), suggerisce di evitare il raddoppio del basso e di raddoppiare un grado forte presente nell’accordo.
- **R-CHORD-COMPLETE**: accordo incompleto/ambiguo (warning):
  - segnala la **mancanza della 3ª** anche in voicings “shell” (es. fondamentale + 5ª + 7ª, tipo G–D–F).
  - segnala la **mancanza della 7ª** *solo* quando l’accordo è riconosciuto come accordo di 7ª dai suoni (se la 7ª non c’è, può essere semplicemente una triade).
- **R-RANGE**: nota fuori dal registro tipico della voce (warning).

### Regole orizzontali (tra eventi consecutivi)
- **R-01**: ottave/unisoni paralleli (error).
- **R-02**: quinte parallele (error) con downgrade a eccezioni:
  - **EXC-M04**: quinte tollerate in minore in progressione vi → V (exception).
  - **EXC-M03**: “finta” quinta parallela quando l’accordo successivo è una dominante con settima e una delle due note è la 7ª (exception).
- **R-05**: quinte/ottave dirette (nascoste) tra voci estreme quando il Soprano salta (warning). **EXC-Hidden-Stepwise** se il Soprano va per grado (exception).
- **R-07**: risoluzione della sensibile applicata solo se l’accordo è V o vii° (error nelle voci esterne, warning nelle interne). **EXC-LT-Transfer** se la risoluzione è “trasferita” al Soprano (exception).
- **R-09**: falsa relazione cromatica tra voci tra due eventi successivi (error).
- **R-12**: risoluzione della 7ª dell’accordo (error). **EXC-7m01** se la risoluzione compare in un’altra voce (exception). Gestione distinta 7ª minore (obbligatoria) e 7ª maggiore (obbligatoria solo se sotto la fondamentale).
  - Nota: la regola non si applica agli accordi di **sesta aumentata** (It+/Fr+/Ger+), perché l’enarmonia può far “sembrare” una 6ª aumentata una 7ª minore e la risoluzione tipica è per espansione (sale di semitono).
- **R-13**: tutte le voci si muovono nella stessa direzione (warning).
- **R-14**: moto simile tra voci estreme (warning). **EXC-Hidden-Stepwise** se il Soprano procede per grado (exception).

### Ritmo armonico
- **R-16**: sincope armonica “regola della stanghetta” (warning): stesso insieme di classi di altezze su tempo debole (beat 4) e poi sul battere della misura successiva; non segnala se lo stesso accordo era già presente su un tempo forte (beat 1 o 3) nella misura precedente.

### Regole funzionali (stile corale classico)
- **R-N-RES**: Napolitana (N) con risoluzione non verso dominante (warning).
- **R-AUG6-RES**: accordi di sesta aumentata (It+/Fr+/Ger+) con risoluzione non verso dominante (warning).
- Nota: il riconoscimento It+/Fr+/Ger+ è **intenzionalmente “stretto”** sulle classi di altezze (pitch-class): se nell’accordo compare una pitch-class extra (es. un It+ con anche C#), non viene etichettato come sesta aumentata.
- **R-CAD64**: 6/4 cadenziale (euristica) non risolto su V (warning).

### Marker cadenze (informativi)
- **CAD-PAC / CAD-IAC / CAD-HC / CAD-PLAG**: marker informativi (severity `exception`) per cadenze individuate alla **stanghetta**.
- Visualizzazione: nel pannello come entry “verde” e sul pentagramma come connessione tratteggiata **basso→basso** tra i due accordi della cadenza.

### Regole melodiche (per singola voce)
- **R-15**: salti melodici ampi nelle voci interne (Alto/Tenore > 6a) (warning).
- **R-06**: risoluzione errata di salti melodici aumentati/diminuiti (error): richiede risoluzione per grado nella direzione appropriata.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
