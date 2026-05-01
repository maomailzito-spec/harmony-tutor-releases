## Novità in questa versione

### 🌐 Localizzazione inglese completa
- Tutti i titoli delle violazioni nel pannello analisi ora tradotti in inglese (oltre 80 varianti dinamiche: coppie di voci interne S–A, A–T, A–B, T–B, ornamenti, cadenze)
- Meccanismo `titlePrefix`+`titleSuffix` per tradurre stringhe dinamiche come "Chromatic clash: G# and G4 sound simultaneously"
- Menu Electron (File, Edit, View, Tools, Help) completamente localizzato; si aggiorna automaticamente al cambio lingua senza riavvio
- Generatore Corale da Roman Numerals interamente tradotto (pannello, guida sintassi, preset, messaggi)
- Escape notes (`ORN-ESC`, `R-ORN-ESC`), cadenza plagale (`CAD-PLAG`) e raddoppio settima (`R-10-7TH`) aggiunti al dizionario

### 🔧 Fix analisi armonica
- Corretto il riconoscimento delle modulazioni: il contesto tonale viene ora mantenuto correttamente dopo cadenze d'inganno (V→vi)
- Il grado V non viene più erroneamente riscritto come I nelle regioni di tonicizzazione estesa

### ✨ Nuove funzionalità
- **Option+M (⌥M)**: cambia la disposizione parti strette/late dal punto esatto della playhead in poi, senza modificare le battute precedenti
- **Toolbar compattata**: i controlli sono ora disposti su 2 righe per una migliore visibilità; gap e label ridotti
- **Aggiornamento automatico migliorato**: l'app chiede conferma prima di scaricare, mostra una barra di progresso durante il download e offre la scelta di riavviare subito o alla prossima chiusura

### 🧪 Test
- Aggiunti 30+ file di test per modulazioni (C→G, C→F, C→Am, ecc.)
- Suite di regressione: 500 OK / 5 FAIL (pre-esistenti, invariati)
