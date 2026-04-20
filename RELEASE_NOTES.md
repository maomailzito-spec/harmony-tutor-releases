## Novità in questa versione

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
