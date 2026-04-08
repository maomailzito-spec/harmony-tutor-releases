# START HERE — Harmony Tutor

Se la chat si resetta o stai riprendendo lavoro dopo tempo, parti da qui.

## Documenti “source of truth”

1) Direttive progetto (missione, vincoli hard, roadmap, contratti):
- docs/project-directives.md

2) Inventario dal codice (surface area: menu-action, IPC, storage, exports):
- docs/capabilities.md

## Regole non negoziabili (riassunto)

- Rendering musicale: solo VexFlow.
- Analisi armonica: spelling-first (non solo MIDI per enarmonie).
- Renderer Electron: niente fs/path, usare solo window.electronAPI.

## Dove mettere mano di solito

- Editor monolitico: src/components/GrandStaffEditor.tsx
- Motore analisi: src/utils/musicTheory.ts
- Electron: electron/main.js + electron/preload.js

## Quando riparti con una nuova chat

Incolla i link dei due documenti sopra e chiedi di:
- rispettare vincoli hard
- evitare refactor non necessari
- stabilizzare contratti (menu-action registry, storage keys, bridge Electron) prima di feature grandi
