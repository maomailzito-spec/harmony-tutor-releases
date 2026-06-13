# Session 2026-05-16 — Augmented triad root in Roman analysis

## Bug report (utente)
In *Life on Mars*, misura 28, l'accordo Gb augmented (notes: Gb3 basso, D4, Bb4) in contesto Bb maggiore (modulazione manuale a m25) era etichettato come `I+` invece del corretto `♭VI+`.
Inoltre, sovrascrivere manualmente l'etichetta destabilizzava i romani successivi, e la modulazione inferita dall'utente a m25 non sembrava sempre rispettata.

## Diagnosi
- Lo *chord symbol* mostrava correttamente "Gbaug" (root Gb), ma il roman numeral usava Bb come root → `I+` in Bb major.
- Causa nel short-circuit triade in `getRomanAnalysis` (`src/utils/musicTheory.ts`, ~L3247–L3281): quando `pcs.size === 3` la funzione cerca una triade tra le permutazioni dei pc, iterando con `for (const rootPc of pcs)` e prendendo il PRIMO match.
- Per triadi aumentate (simmetriche, [0, 4, 8] da tre root enharmonici equivalenti) il "primo pc" dipende dall'ordine di inserzione nel `Set`, cioè dall'ordine delle note in `filteredChord`. Per Life on Mars m28 b3 le note arrivavano nell'ordine alto→tenore→basso (Bb, D, Gb): il primo pc era 10 = Bb → root = Bb → roman = `I+`.
- Nota: `identifyChord` non era nemmeno raggiunto — lo short-circuit ritornava prima.

## Fix
File: `src/utils/musicTheory.ts` (block `triadType === Augmented` aggiunto subito dopo il match della triade).
Strategia di scelta root:
1. **Spelling-aware tertian** (`augTriadSpellingRootBonus`): preferisce il candidato il cui spelling produce M3 + A5 (es. Gb→Bb = M3, Gb→D = A5 → Gb è il root canonico).
2. **Bass pc** (fallback): quando nessun candidato ha spelling tertian inequivoco, usa il basso come ancoraggio funzionale (caso comune: V+ in minore con basso = dominante).

```ts
if (triadType === BuiltInChords.Augmented) {
    const validNotes = (filteredChord || []).filter(n => n && !(n as any).isRest);
    const pcsArr = [...pcs];
    let chosenPc: number | null = null;
    for (const candPc of pcsArr) {
        const rNote = validNotes.find(n => mod12(pitchClassOf(n)) === candPc);
        if (!rNote) continue;
        const bonus = augTriadSpellingRootBonus(rNote as any, validNotes as any);
        if (bonus != null && bonus > 0) { chosenPc = candPc; break; }
    }
    if (chosenPc == null) {
        const bassNoteAug = pickPreferredBassNote(validNotes as any);
        const bassPcAug = bassNoteAug ? mod12(pitchClassOf(bassNoteAug as any)) : null;
        if (bassPcAug != null && pcs.has(bassPcAug)) chosenPc = bassPcAug;
    }
    if (chosenPc != null) triadRootPc = chosenPc;
}
```

## Verifica
- Standalone test (Gb-Bb-D, bass Gb):
  - Bb major → `♭VI+` ✓
  - F major  → `♭II+` ✓
- `debug-engine.ts --file "tests/Life on Mars.htp" --spot m28b3` → `ui=♭VI+`, `full=♭VI+` ✓
- Cascade m25→m36 in Bb/Fm: contesto utente rispettato fino a m29; auto-tonicizzazione a Fm da m30 (comportamento preesistente, non modificato).

## Regression
- Baseline (pre-fix): 518 OK / 9 FAIL (5 gold + 1 + 3 snapshot)
- Post-fix (snapshot aggiornati): **521 OK / 6 FAIL** (5 gold + 1, tutti preesistenti)
- 25 snapshot file aggiornati con `npm run regress:update`: tutti riguardano triadi aumentate dove il vecchio engine pickava un root arbitrario (es. `iii+` invece di `I+` per D-F#-A# con basso D in D major → ora correttamente `I+`).
- 0 nuovi fail; 3 snapshot regressioni preesistenti risolte.

## File modificati
- `src/utils/musicTheory.ts` (+25 righe)
- 25 file in `scripts/fixtures/snap-*.json`
- `tests/Life on Mars.htp` (WIP utente, non toccato dall'agente)

## Note architetturali
- `getRomanAnalysis` e `getChordSymbol` usano logiche diverse di selezione root: il symbol applica già `augTriadSpellingRootBonus` (commento ~L1919-1928 in `musicTheory.ts`). Il roman invece evitava lo spelling bonus per non corrompere V+ minore. Il fix mantiene quella logica per `identifyChord`, e applica lo spelling bonus solo nello short-circuit triade (dove tre root simmetrici sono indistinguibili senza informazione spelling/basso).
- Pattern simile dovrebbe essere considerato anche per altre sonorità simmetriche (dim7) — già gestite con `dim7SpellingRootBonus`.
