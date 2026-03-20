# Guida Debug — Harmony Tutor

> **Scopo:** manuale operativo per le sessioni AI.
> Leggere all'inizio di ogni chat insieme a `copilot-instructions.md` e `docs/pipeline-overview.md`.

---

## 1. DUAL PIPELINE — Errore n°1 più costoso

L'app ha **due pipeline di labeling parallele**:

| Pipeline | File | Usato da |
|---|---|---|
| **UI (reale)** | `src/hooks/useHarmonyLabels.ts` (~4400 righe) | GrandStaffEditor — **quello che l'utente vede** |
| **Standalone** | `src/utils/computeHarmonyLabelsBySystem.ts` | debug scripts, regression-check |

### Regole ferree
1. **Per debugging di label UI**: testare SEMPRE `useHarmonyLabels`. Mai fidarsi di `computeHarmonyLabelsBySystem` o di `getRomanAnalysis` diretto — possono dare risultati diversi.
2. **Per fix**: applicare a ENTRAMBE le pipeline (finché il monolite non viene rifatto).
3. La differenza principale: `useHarmonyLabels` ha logica extra non presente nell'altra:
   - `evaluateCadentialPatterns` → inietta contesti di modulazione automatici (`_effectiveCtxs`)
   - Tonicization detector 12-key scan → `autoRomanDisplayByAbsBeat`
   - Lookback V/x → rietichetta pre-dominanti e pivot

### Come testare la pipeline UI senza l'app
Inserire **log diagnostici temporanei** dentro `useHarmonyLabels.ts`, buildare, aprire l'app e leggere la console DevTools (`Cmd+Opt+I`).

Esiste già un tracer permanente attivabile da console browser:
```js
localStorage.setItem('_HT_DEBUG_BEAT', '22')   // un beat specifico
localStorage.setItem('_HT_DEBUG_BEAT', '-1')    // tutti i beat
localStorage.removeItem('_HT_DEBUG_BEAT')       // disattiva
```

---

## 2. Fonti di label errati — Checklist diagnostica

Quando un label UI è sbagliato, verificare **in quest'ordine**:

### A. Il base Roman è corretto?
```ts
getRomanAnalysis(structuralNotes(ev.notes), tonic, isMinor)
```
Se già qui è sbagliato → il problema è in `musicTheory.ts` (spelling, chord candidates).

### B. Il `contextTonic` è quello giusto?
- `useHarmonyLabels` riga ~1873: `const contextTonic = applicableContext ? applicableContext.newTonic : currentTonic`
- Se `contextTonic` è errato, il Roman verrà calcolato nella tonalità sbagliata.
- **Cause frequenti:**
  - `evaluateCadentialPatterns` trova una cadenza spuria → inietta un contesto automatico
  - Cadenza a bassa confidenza sovrapposta a una più forte (fix: overlap guard, 2026-03-13)

### C. `autoRomanDisplayByAbsBeat` sovrascrive il label?
- Il tonicization detector 12-key scan (~riga 620) e il lookback V/x (~riga 800) scrivono qui.
- **Cause frequenti:**
  - Lookback V/x troppo lungo (2 misure) cattura beat di un'altra tonicizzazione (fix: secondary-function guard, 2026-03-13)
  - 12-key scan trova I in una tonalità remota senza evidenza cromatica sufficiente

### D. La structural snapshot è corretta?
- `computeStructuralSnapshotForHarmonyLabelEvent` in `harmonyLabelPipeline.ts` — usata solo da `computeHarmonyLabelsBySystem`
- `useHarmonyLabels` ha la sua **versione inline** (~riga 1650-1830) con `lastStructuralByVoiceBySystem`
- Se una nota viene esclusa/inclusa erroneamente dalla snapshot, il chord cambia.
- **Cause frequenti:**
  - Sospensione falsa: `isSuspension` flag errato → nota strutturale rimossa
  - `isNonChordToneAtLabelEvent` classifica male una nota
  - `lastStructuralByVoiceBySystem` conserva note stale da beat precedenti

### E. Override o harmony overrides?
- User overrides: `proj.harmonyOverrides` → forzano il label
- Engine overrides: `res.autoHarmonyLabelOverrides` → prodotti da `applyHarmonyRules`
- `autoOverrideByAbsBeat` → dal lookahead tonicization

---

## 3. Pattern di bug ricorrenti

### 3.1 Cadenza spuria sovrapposta
**Sintomo:** label corretto diventa V o I in una tonalità sbagliata.
**Causa:** `evaluateCadentialPatterns` trova due cadenze sovrapposte; quella più debole vince perché il suo `startBeat` è più recente.
**Diagnosi:** simulare `evaluateCadentialPatterns` con gli stessi `_chEvts` del hook e verificare i match.
**Fix tipo:** overlap guard — scartare cadenze il cui startBeat cade nel range di una cadenza con confidenza superiore.

### 3.2 Lookback V/x cattura beat di altre tonicizzazioni
**Sintomo:** un label secondario (es. vii°/IV) viene sovrascritto con ii°/x.
**Causa:** il lookback da un V/x remoto arriva a 2 misure di distanza e rietichetta un beat che appartiene a un contesto di tonicizzazione diverso.
**Diagnosi:** cercare nel codice il loop `for (let i = j - 1; i >= 0; i--)` dopo il match V/x e verificare cosa cattura.
**Fix tipo:** guard su `bi.roman.includes('/')` — non rietichettare beat con label secondario.

### 3.3 Sospensione falsa che altera il chord
**Sintomo:** accordo corretto analizzato come un altro (es. IV→V, I→IV).
**Causa:** `applyHarmonyRules` marca una nota come `isSuspension` quando non lo è (stale MIDI, chord-tone trattato come dissonanza).
**Diagnosi:** controllare `isSuspension` flag sulle note del beat incriminato.
**Fix tipo:** chord-tone guard nel detector sospensioni (`musicTheory.ts`).

### 3.4 `contextTonic` errato da modulazione automatica
**Sintomo:** label corretto nel backend, sbagliato nella UI.
**Causa:** `_effectiveCtxs` contiene un contesto iniettato da cadenze o pivot detection che cambia la tonica prematuramente/tardivamente.
**Diagnosi:** log `contextTonic` al beat incriminato (tracer `_HT_DEBUG_BEAT`).

---

## 4. Strategia di debug rapido

```
1. RIPRODUCI: identifica il beat esatto (misura, beat, absBeat)
2. BASE CHECK: con script standalone, verifica che getRomanAnalysis dà il risultato giusto
   → Se sbagliato qui: il problema è in musicTheory.ts
3. SE base è OK → il bug è nella pipeline UI (useHarmonyLabels)
4. INIETTA LOG: metti console.log temporaneo a riga ~2097 di useHarmonyLabels.ts
   per vedere contextTonic + analysisNotesForNaming + roman risultante
5. IDENTIFICA la causa con la checklist §2
6. APPLICA FIX a useHarmonyLabels.ts (e computeHarmonyLabelsBySystem.ts se necessario)
7. BUILD + REGRESS: npm run build && npm run regress
8. RIMUOVI LOG temporanei
```

---

## 5. Comandi utili

```bash
# Build rapido
npm run build 2>&1 | tail -3

# Regression (conteggio OK + lista FAIL)
npm run regress 2>&1 | grep -cE '^OK' && npm run regress 2>&1 | grep FAIL

# Tracer in-app (console DevTools)
localStorage.setItem('_HT_DEBUG_BEAT', '22')

# Test analisi su un file specifico
npx tsx -e '
const m = require("./src/utils/musicTheory");
const proj = JSON.parse(require("fs").readFileSync("tests/NOME_FILE.htp", "utf-8"));
const ks = m.getKeySignature(proj.keySignatureRoot, "Major");
const res = m.applyHarmonyRules(proj.notes, ks, proj.keySignatureRoot, !!proj.isMinorMode,
  proj.analysisContexts || [], proj.timeSignature, undefined, proj.ornamentOverrides || []);
// ... analisi mirata
'
```

---

## 6. File chiave da conoscere

| File | Ruolo |
|---|---|
| `src/utils/musicTheory.ts` | Motore analisi: chord detection, NCT, sospensioni, regole voice-leading |
| `src/hooks/useHarmonyLabels.ts` | **Pipeline UI reale** — label Roman, tonicizzazione, sequenze |
| `src/utils/computeHarmonyLabelsBySystem.ts` | Pipeline standalone (debug/regression) |
| `src/utils/harmonyLabelPipeline.ts` | Helpers condivisi: `structuralNotes`, `computeStructuralSnapshot...` |
| `src/utils/cadentialPatterns.ts` | `evaluateCadentialPatterns` — rilevamento cadenze V→I in 12 tonalità |
| `src/components/GrandStaffEditor.tsx` | Rendering VexFlow + orchestrazione UI (monolite) |

---

## 7. Regole anti-regressione

- **Mai** fidarsi di test standalone per validare bug UI — usare sempre l'app vera o i log nel hook.
- **Sempre** `npm run regress` dopo ogni fix.
- **Mai** riscrivere quando basta un guard chirurgico.
- I fix alla pipeline devono essere **piccoli e verificabili** — una condizione, non un refactoring.
