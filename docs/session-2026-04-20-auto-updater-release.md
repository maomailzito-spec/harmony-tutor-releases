# Sessione 20 aprile 2026 — Auto-updater, Release v1.0.2, Modulazioni, CI fix

## Cosa è stato implementato

### 1. Auto-updater migliorato (`electron/main.js`, `electron/preload.js`)

La versione precedente scaricava l'aggiornamento silenziosamente (`autoDownload: true`) e mostrava un solo dialog a download completato. Ora il flusso è:

1. `autoDownload = false` — l'app non scarica senza consenso
2. `update-available` → dialog nativo: "È disponibile Harmony Tutor vX.Y.Z. Vuoi scaricare e installare?" → **Aggiorna ora** / **Rimanda**
3. Se l'utente accetta, il main process invia `UPDATE_DOWNLOAD_PROGRESS` al renderer via IPC con `{ percent, bytesPerSecond, transferred, total, status }` durante il download
4. `update-downloaded` → dialog: "Riavviare ora per completare l'installazione?" → **Riavvia ora** / **Alla prossima chiusura**
5. In caso di errore, il renderer riceve `{ status: 'error', error: message }`

Bridge preload aggiunto: `onUpdateProgress` in `electron/preload.js` espone `ipcRenderer.on('UPDATE_DOWNLOAD_PROGRESS')` al renderer. Tipo aggiunto in `src/electronAPI.d.ts`.

### 2. Barra di progresso download (`src/components/UpdateProgressBar.tsx`)

Componente React floating (fixed bottom-right, z-50) che:
- Si registra a `window.electronAPI.onUpdateProgress`
- Mostra percentuale e barra animata durante il download (status `downloading`)
- Si nasconde automaticamente dopo 3 secondi quando il download è completo (status `ready`)
- Si nasconde su errore dopo 5 secondi
- Montato in `src/App.tsx` sopra il routing

### 3. Option+M — cambio layout posizionale (`src/components/GrandStaffEditor.tsx`)

Nuova shortcut ⌥M che inserisce un cambio di layout (parti strette ↔ parti late) dalla posizione corrente della playhead in poi, senza modificare le battute precedenti. Implementato con:
- Stato `layoutModeChanges: Array<{absBeat, mode}>` che traccia i punti di cambio
- Funzione `effectiveLayoutMode(measureIndex, beat)` che risolve il modo attivo in ogni posizione consultando i breakpoint
- `clefForVoice()` ora accetta `measureIndex` e `beat` opzionali e delega a `effectiveLayoutMode`

### 4. Toolbar compattata (`src/components/GrandStaffToolbar.tsx`)

Ridotti gap (`gap-2` → `gap-1`, `gap-3` → `gap-1.5`), label abbreviate ("Tonalità:" → "Ton:", "Tempo:" abbreviato), font ridotti (`text-lg` → `text-sm`, `text-sm` → `text-xs`), larghezza select tonalità ridotta (`w-[111px]` → `w-[90px]`). I controlli stanno su 2 righe.

### 5. Fix analisi modulazioni (`src/hooks/useHarmonyLabels.ts`)

- **Cadenze d'inganno**: il filtro che bloccava le tonicizzazioni su accordi "borrowed" (modal interchange) ora fa eccezione quando la dominante contiene note cromatiche rispetto alla tonalità base. Es: C→Eb via Bb7→Eb viene accettata perché Bb7 ha Ab, che è cromatico in Do.
- **Dominanti su gradi diatonici**: prima un accordo che risolveva su un grado della scala base (es. V/vi → vi) veniva sempre rifiutato come modulazione. Ora, se la dominante contiene note diatoniche nella tonalità target ma non in quella base ("differentiating PC"), viene accettata.
- **Gate `_inferCtxEnabled`**: aggiunta lettura di `ANALYSIS_ENABLE_INFERRED_CONTEXTS_KEY` dal localStorage per disabilitare l'inferenza dei contesti tonali quando l'utente spegne il toggle "Inferisci contesti"

### 6. Test di modulazione

Aggiunti 30+ file `.htp` in `tests/` con modulazioni reali (C→G, C→F, C→Am, C→Eb, C→Db, F→Bb, Dm→G, ecc.) e 30+ snapshot di regressione in `scripts/fixtures/`. Suite: 500 OK / 5 FAIL (invariati).

### 7. Dati aggiornati

- `src/data/progressionStats.json` — statistiche bigrammi aggiornate (+2506 righe modificate)
- `src/engine/defaultStyleProfile.json` — profilo stile aggiornato
- `src/data/ornamentLearning.json` / `ornamentPatterns.ts` — pattern ornamentali aggiornati

## Decisioni prese

- **Build locale per le release**: il CI GitHub Actions aveva troppi problemi (file con `:` nella storia, submodule orfani, naming mismatch). Per questa release si è proceduto con build locale (`npx electron-builder --mac --win`) + upload via `gh release create`. Il CI va sistemato per le prossime release.
- **`private: false` in `electron-builder.yml`**: il repo `harmony-tutor-releases` è pubblico, l'auto-updater non ha bisogno di token per scaricare `latest-mac.yml`. Le versioni 1.0.0 e 1.0.1 avevano `private: true` e l'updater falliva silenziosamente — quegli utenti devono scaricare manualmente la v1.0.2.
- **Nomi asset su GitHub**: GitHub converte gli spazi nei nomi file in punti (`Harmony Tutor` → `Harmony.Tutor`). I file `latest-mac.yml` e `latest.yml` devono usare il nome con punto per matchare. Il comando `gh release upload` accetta `#` per rinominare: `"file locale#nome-su-github"`.
- **RELEASE_NOTES.md**: aggiunto file di release notes letto dal workflow come `body_path` nella GitHub Release (invece di `generate_release_notes: true`). Le note sono in italiano.
- **Google Analytics G-5L62VXGSS2**: aggiunto al sito harmonytutor.it per tracciare visite e download.

## Problemi risolti durante la release

| # | Problema | Causa root | Fix |
|---|---|---|---|
| 1 | CI Windows: `invalid path 'electron:dev'` | File `electron:dev` (log di terminale) committato per errore; `:` illegale su Windows | `git rm electron:dev` |
| 2 | CI Windows: `invalid path 'tests/Beethoven:Piston p218.htp'` | 17 file in `tests/` con `:` nel nome | Rinominati tutti con `find + git mv`, `:` → `-` |
| 3 | CI Windows: `invalid path 'tests/Cantata 2 <bach.htp'` | File con `<` nel nome | Rinominato `<bach` → `Bach` |
| 4 | CI: `audit:contracts` fallito | `onUpdateProgress` nel preload ma non in `src/electronAPI.d.ts` | Aggiunto tipo in `electronAPI.d.ts` |
| 5 | CI Mac+Win: git exit 128 al checkout | `_split/harmony-tutor-grandstaff` e `_split/harmony-tutor-guitar` registrati come gitlink (mode 160000) senza `.gitmodules` → checkout fallisce | `git rm --cached _split/*`, aggiunto `_split/` a `.gitignore` |
| 6 | CI: checkout scarica storia con file illegali | `fetch-depth` non impostato | Aggiunto `fetch-depth: 1` e `submodules: false` a tutti i checkout nel workflow |
| 7 | `release.sh`: `git push` fallisce | Branch `work/canonical-line` senza upstream | Cambiato `git push` → `git push -u origin HEAD` in `scripts/release.sh` |
| 8 | Auto-updater silenzioso nella v1.0.1 | `private: true` in `electron-builder.yml` → updater cerca di autenticarsi ma non ha token | Cambiato a `private: false`, rebuild locale |
| 9 | Updater non trova il DMG | `latest-mac.yml` dice `Harmony-Tutor` (trattini), GitHub nomina l'asset `Harmony.Tutor` (punto) | Aggiornato `latest-mac.yml` e `latest.yml` con `sed` e ri-uploadati |

## Commit della sessione

```
6b59cc0 feat+fix: modulation detection, Option+M layout toggle, toolbar compact, auto-updater UX
df54cdc release: v1.0.2
e00be01 fix(ci): remove electron:dev file (invalid path on Windows)
76c224d fix(ci): shallow clone to avoid invalid path on Windows
0300354 fix(ci): rename all files with colon (invalid on Windows)
7c700f6 fix(ci): rename file with < character (invalid on Windows)
59b0de3 fix(ci): add onUpdateProgress to electronAPI.d.ts contract
33c7a17 fix(ci): disable submodule checkout (orphan submodule refs cause git failures)
b840a8a fix(ci): remove orphan submodule gitlinks (_split/) from tree
```

Non committati (modifiche locali post-tag):
- `electron-builder.yml` — `private: false` (incluso nel rebuild locale del DMG/EXE)
- `release/latest-mac.yml`, `release/latest.yml` — nomi asset corretti con punto

## Stato a fine sessione

- **Release v1.0.2** pubblicata su GitHub con DMG (136 MB, firmato + notarizzato) + EXE (119 MB) + `latest-mac.yml` + `latest.yml`
- **harmonytutor.it**: link download aggiornati a v1.0.2, Google Analytics attivo
- **Auto-updater**: funzionante dalla v1.0.2 in poi. Utenti v1.0.0/v1.0.1 devono scaricare manualmente dal sito
- **Download storici**: v1.0.0 = 5 mac + 6 win; v1.0.1 = 5 mac; v1.0.2 = 0 (appena pubblicata)
- **Regressione**: 500 OK / 5 FAIL (invariati, pre-esistenti)
- **CI workflow**: ancora non funzionante per problemi residui (probabilmente npm ci fallisce sui runner). Per la prossima release usare build locale (vedi procedura in `/memories/repo/release-procedure.md`)
