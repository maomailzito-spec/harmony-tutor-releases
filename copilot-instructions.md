# Copilot Instructions — Harmony Tutor

Quando lavori su questo repo, leggi prima:
- [docs/project-directives.md](docs/project-directives.md)
- [docs/capabilities.md](docs/capabilities.md)

## Vincoli hard

- Stack: React (Vite) + Electron + Tailwind.
- Rendering musicale: **solo VexFlow**.
- Analisi: **spelling-first** (enarmonie e intervalli non si deducono solo dal MIDI).
- Renderer: niente `fs/path`; usare solo `window.electronAPI` dal preload.

## Priorità di refactor (mirato)

- Stabilizzare i contratti: Electron bridge tipizzato e coerente, registry unico per `menu-action` + payload, centralizzazione `localStorage` keys.
- Evitare riscritture globali: fare estrazioni piccole e verificabili, senza cambiare comportamenti.

## File chiave

- `src/components/GrandStaffEditor.tsx`
- `src/utils/musicTheory.ts`
- `electron/main.js`, `electron/preload.js`

## Regole di stile

- Cambiamenti minimi e coerenti con lo stile esistente.
- Non introdurre complessità non necessaria.
- Se trovi mismatch tra preload/main/renderer, documenta e proponi fix “contrattuale” (tipi + handler).
