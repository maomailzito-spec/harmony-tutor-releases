# Copilot Instructions — Harmony Tutor

Prima di proporre o modificare codice, leggi:
- START-HERE.md
- docs/project-directives.md
- docs/capabilities.md

## Vincoli hard

- Stack: React (Vite) + Electron + Tailwind.
- Rendering musicale: solo VexFlow.
- Analisi: spelling-first.
- Renderer: non usare fs/path; usare solo window.electronAPI (preload).

## Priorità

- Stabilizzare contratti (Electron bridge coerente e tipizzato, registry unico menu-action+payload, chiavi localStorage centralizzate) prima di nuove feature grandi.
- Cambiamenti piccoli e verificabili; niente riscritture estetiche.
