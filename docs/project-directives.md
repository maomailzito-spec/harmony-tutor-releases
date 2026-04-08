# Harmony Tutor — Project Directives (source of truth)

Ultimo aggiornamento: 2026-02-02.

Questo file serve a **preservare le direttive di progetto** anche se la chat si interrompe.
Quando riparti con una nuova chat: fai leggere prima questo file e poi [docs/capabilities.md](capabilities.md).

## 1) Missione e target

Harmony Tutor è un’app desktop per analisi armonica e didattica, pensata per:
- licei/conservatori (docenti + studenti)
- autodidatti
- repertorio: Bach → classico, con estensione controllata al romantico

Qualità “pro” = risultati affidabili + UX didattica chiara + export/import solidi.

## 2) Vincoli tecnici non negoziabili

- Stack: React (Vite) + Electron + Tailwind.
- Rendering musicale: usare **solo VexFlow**.
- Teoria/analisi: approccio **spelling-first** (non fidarsi del solo MIDI per enarmonie/intervalli).
- Electron security model: il renderer **non** usa `fs`/`path`. Tutto passa dal bridge in preload (`window.electronAPI`).
- Cambiamenti: preferire patch semplici e non invasive; evitare refactor “estetici” che non portano valore.

## 3) File “source of truth”

- Editor/integrazione UI principale: `src/components/GrandStaffEditor.tsx`
- Motore teoria/analisi: `src/utils/musicTheory.ts`
- Pipeline etichette/posizionamento: `src/utils/harmonyLabelPipeline.ts`, `src/utils/computeHarmonyLabelsBySystem.ts`
- Sequenze: `src/utils/sequenceDetector.ts`
- Tipi: `src/types.ts`
- Electron: `electron/main.js` + `electron/preload.js`
- Mappa funzioni/surface area: [docs/capabilities.md](capabilities.md)
- Roadmap baseline (Professional + Split): [docs/roadmap-professional.md](roadmap-professional.md)

## 4) “Contratti” da stabilizzare (per evitare regressioni)

Questi punti sono emersi dall’inventario in [docs/capabilities.md](capabilities.md) e sono prioritari perché riducono bug e drift:

1) Bridge Electron tipizzato e coerente
- Allineare preload/main/renderer (niente API esposte senza handler e viceversa).
- Centralizzare in un modulo unico la definizione delle API disponibili su `window.electronAPI`.

2) Registry unico per `menu-action`
- Evitare stringhe sparse: definire un’unica sorgente per azioni e payload (shared tra main e renderer).
- Aggiungere guard/validazione payload per evitare crash e comportamenti incoerenti.

3) Persistenza coerente
- Centralizzare tutte le chiavi `localStorage` e le relative migrazioni/versioni.

4) Flavor-aware
- Rispettare `VITE_APP_FLAVOR` (`united` | `grandstaff` | `guitar`) e mantenere menu/azioni coerenti con ciò che è disponibile.

## 5) Roadmap “pro” (principi, non scadenze)

1) Refactor mirato (prima di nuove feature grosse)
- Obiettivo: rendere solidi i contratti: Electron bridge + menu actions + preferences/storage.
- Non riscrivere tutto: estrazioni piccole e verificabili.

2) Due percorsi d’uso: Accademico vs Sigle
- Stessa engine, output diverso (overlay/label differenti).
- Implementare come “profili” (preset salvabili) che controllano:
  - cosa mostrare (romani/figure/sigle)
  - quali euristiche attivare (soft/strict)

3) Confidenza + spiegazione (didattica)
- Ogni label deve poter esporre un “perché”: note considerate, basso scelto, candidato, regole/euristiche.
- Indice di confidenza (alto/medio/basso) per distinguere analisi stabile vs ambigua.

4) Repertorio fino al romantico (incrementale)
- Migliorare cromatismo funzionale e ambiguità prolungate con approccio windowing/lookahead.

5) Export/import scolastico
- Export PDF/PNG e export testo progressioni.
- MusicXML: moltiplicatore enorme, ma da trattare come milestone dedicata.

6) Robustezza
- Golden tests: cartella brani di riferimento + snapshot risultati.
- Diagnostica locale/opt-in: report bug riproducibili.

## 6) Regole operative per modifiche al codice

- Non rompere il build: ogni cambiamento deve compilare.
- Mantenere la logica spelling-first.
- Niente nuove librerie grafiche (solo VexFlow).
- Tenere invariati gli entry point principali finché non esiste un piano di migrazione chiaro.

## 7) Stato corrente (riavvio rapido)

- Inventario aggiornato: [docs/capabilities.md](capabilities.md)
- Drift rilevato (da risolvere nel refactor mirato):
  - API preload esposte senza handler nel main e/o funzioni chiamate dal renderer non esposte nel preload.
  - stringhe `menu-action`/payload distribuite (meglio registry unico).
  - `localStorage` keys distribuite (meglio centralizzazione).

  istruzioni per me da dare nella chat:
  “Leggi START-HERE.md, project-directives.md, capabilities.md e segui copilot-instructions.md.”

