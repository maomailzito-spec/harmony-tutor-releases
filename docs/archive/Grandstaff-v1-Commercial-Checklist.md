# Grandstaff v1 — Commercial Checklist

Documento operativo (derivato da [docs/Obiettivi.txt](Obiettivi.txt)).

Obiettivo: prima commercializzazione del solo **Grandstaff** (pack separato da Guitar e United), con focus su:
- solidità strutturale (Electron bridge/contratti/persistenza)
- affidabilità teorico/didattica (analisi spelling-first)

## 0) Scope e non-scope

### In scope (v1)
- Flavor **grandstaff**: Editor Grand Staff + analisi armonica + export/import essenziali.
- UX “pro”: stabile, prevedibile, senza glitch evidenti.

### Fuori scope (rimandabile)
- Feature Guitar/Scale/Accordi/Intervalli (non blocca il primo rilascio Grandstaff).
- Refactor estetici o riscritture ampie non necessarie.
- Espansioni teoriche “romantico avanzato” se non supportate da test/regressioni.

## 1) Stabilità strutturale (hard priority)

### 1.1 Contratti Electron (bridge e registry)
- [x] `window.electronAPI` tipizzata e coerente (preload/main/renderer senza drift).
- [x] Tutte le `menu-action` sono registrate centralmente (shared) con validazione payload.
- [x] Nessun uso di `fs/path` nel renderer (solo main + preload).
- [x] Error reporting non-invasivo: `menu-error` usato per fallimenti I/O (open/save/import/export).

### 1.2 Persistenza (localStorage / preferenze)
- [ ] Chiavi `localStorage` centralizzate + versionate (evitare stringhe sparse).
- [ ] Migrazioni minime: aprire progetti vecchi senza perdere campi critici.
- [ ] Preferenze export/print centralizzate (almeno: include titolo).

### 1.3 File I/O (progetto)
- [ ] New/Open/Save/Save As/Close Project senza corruzione stato.
- [ ] Recenti: aggiunta/lettura affidabile, nessun crash su file mancante.
- [ ] Import MusicXML: gestisce annulla/errore e reset stato coerente.

## 2) Export/Print (shipping quality)

### 2.1 Export PDF
- [ ] Output non tagliato (fit or landscape) su A4.
- [ ] Niente layer “interattivi” (overlay/romani/playhead/selection) nell’export.
- [ ] Titolo: statico e opzionale (non input editabile).

### 2.2 Export PNG
- [ ] PNG corretto per contenuti lunghi (tiling o pagina singola), senza tagli laterali.
- [ ] Qualità: scala/zoom almeno decente (1x come baseline).

### 2.3 Print
- [ ] Stampa “pulita” come export (stesse esclusioni overlay).

## 3) Affidabilità didattica (spelling-first)

### 3.1 Principi
- [ ] Analisi non deve dipendere solo dal MIDI per enarmonie/intervalli.
- [ ] Output coerente con la grafia (pitch spelling) delle note inserite.
- [ ] Ambiguità gestite con regole “spiegabili” e, se necessario, override.

### 3.2 Copertura minima casi (accettazione)
- [ ] Triadi + rivolti, settime + rivolti, diminuiti/semidiminuiti.
- [ ] Accordi di dominante con tensioni (b9/#9/#11/b13) in sigla.
- [ ] Note non armoniche: passaggi, volta, anticipazioni, appoggiature, cambiamenti di basso.
- [ ] Sospensioni/ritardi: riconoscimento e resa figure (es. 4-3, 7-8, doppi ritardi).
- [ ] Tonicizzazioni essenziali (V/V) senza falsi positivi.

### 3.3 Golden / regressioni
- [ ] `npm run regress` passa.
- [ ] Aggiungere casi solo quando c’è un bug reale (no test “speculativi”).

## 4) UX “pro” (Grandstaff)

### 4.1 Robustezza interazione
- [ ] Inserimento note/pausa stabile (ticks), niente overlap “fantasma”.
- [ ] Selezione e copy/paste affidabili (clipboard locale + system clipboard).
- [ ] Undo/redo non rompe stato (soprattutto dopo open/import).

### 4.2 Layout / engraving
- [ ] Engraving `legacy/enhanced` selezionabile e persistito.
- [ ] Collision audit utilizzabile (nessun crash, report comprensibile).

## 5) Packaging (Grandstaff solo)

### 5.1 Flavor e build
- [ ] Flavor `grandstaff` avviabile e coerente (niente voci menu inutili).
- [ ] UserData separato per flavor (grandstaff vs guitar vs united) per evitare conflitti.

### 5.2 Checklist manuale pre-release (10 minuti)
- [ ] Avvio app → nuovo progetto → inserisci 1 battuta → salva → chiudi → riapri.
- [ ] Import MusicXML di prova (ok/annulla/fail path) senza corrompere stato.
- [ ] Export PNG + verifica file generati.
- [ ] Export PDF + verifica che una riga piena non sia tagliata.
- [ ] Print preview (se disponibile) o stampa su PDF OS.

## 6) Cosa può aspettare (esplicito)

- UI avanzata per opzioni export (page size, scala, tile height) finché i default sono stabili.
- Profili analisi (accademico vs sigle) se non completati con criteri e test.
- Estensioni teoriche “oltre classico” senza dataset di riferimento.

## 7) Note di implementazione (vincoli hard)

- Stack: React (Vite) + Electron + Tailwind.
- Rendering musicale: **solo VexFlow**.
- Analisi: **spelling-first**.
- Renderer Electron: non usare `fs/path`; usare solo `window.electronAPI`.
