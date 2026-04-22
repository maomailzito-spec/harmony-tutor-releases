## LLM Wiki — Secondo Cervello

La mia knowledge base personale si trova in `~/Documents/llm-wiki`.
Le regole operative complete sono in `~/Documents/llm-wiki/claude.md`.

**All'inizio di ogni sessione su Harmony Tutor o teoria musicale:**
1. Leggi `~/Documents/llm-wiki/claude.md` per le convenzioni operative
2. Leggi `~/Documents/llm-wiki/index.md` per orientarti sui contenuti disponibili
3. Se la domanda riguarda un argomento già presente nella wiki, consultala prima di rispondere

**Operazioni disponibili (su richiesta):**
- `INGEST [file]` — elabora una fonte da `raw/` e crea pagine wiki collegate
- `QUERY [domanda]` — rispondi basandoti esclusivamente sul contenuto della wiki
- `LINT` — analisi di manutenzione: contraddizioni, link rotti, pagine orfane

## Aggiornamento Documentazione

Al termine di ogni sessione di sviluppo significativa, crea o aggiorna un file in `docs/` con:
- Decisioni architetturali prese
- Problemi risolti e soluzioni adottate
- Pattern o convenzioni introdotte
- Stato attuale delle funzionalità lavorate

Il file deve essere in Markdown con nome descrittivo (es. `session-2026-04-20-vexflow-rendering.md`).
Questa cartella è collegata alla wiki esterna tramite alias — i file verranno ingeriti automaticamente.
