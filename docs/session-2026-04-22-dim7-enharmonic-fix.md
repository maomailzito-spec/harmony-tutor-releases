# Session 2026-04-22 — Fix °7 enarmonici e release v1.0.3

## Problema iniziale
I °7 cromatici (es. D-F-Ab-Cb in C maj) venivano etichettati come `♭III=♭VI` invece di `vii°/♭III`.

## Cause diagnosticate

### 1. `musicTheory.ts` — blocco V7♭9 rootless
Il vecchio blocco catturava i °7 come V7♭9 senza radice. Disabilitato.

### 2. `musicTheory.ts` — `isDiatonicDim` non distingueva spelling
`Cb` veniva trattato come `B` → °7 cromatico classificato come diatonico. Fix: richiede spelling effettiva diatonica.

### 3. `musicTheory.ts` — post-`calculateRomanNumeral`
Dopo la classificazione base, se il roman era `ii°`/`iv°` ma le note avevano spelling cromatica (Cb, Ab), il blocco riscrittore ora produce `vii°/X` con X = grado della nota di risoluzione (root + 1 semitono).

### 4. `musicTheory.ts` — "drop dim leading-tone" block
Sovrascriveva `vii°/X` già calcolato. Guard aggiunto: skip se `r0.includes('/')`.

### 5. `useHarmonyLabels.ts` — tonicization run rewriter (≥4 chord)
Il post-pass che semplifica regioni di tonicizzazione extended sovrascriveva `vii°/X` come `localR=target`. Guard aggiunto in exit e inside.

### 6. `useHarmonyLabels.ts` — ARD-SET loop (riga 966)
Il blocco di tonicizzazione cromatica auto-detected scriveva `♭III=♭VI` per il beat del °7. Guard aggiunto: skip se roman inizia con `vii°` o `♭`.

### 7. `useHarmonyLabels.ts` — pivot system
Non sovrascrivere roman `vii°` con `rTgt=homeR`. Guard aggiunto.

## Fix Gb maj → ♭V

**Problema:** Gb maj (Gb-Bb-Db) in C maj veniva etichettato `♭III` invece di `♭V`.

**Causa:** Il blocco "secondary dominant diatonic" catturava Gb come `V/vii°` (Gb è 5ª sopra B). Il tonicization rewriter lo convertiva poi in `♭III`.

**Fix in `musicTheory.ts`:**
- Major triad con root cromatica spelled con bemolle (`_rootIsChromaticFlat`) → skip blocco V/x diatonic
- Fallback `allRoman` per pc=6: se accidental=flat → `♭V`, se sharp → `♯IV`

## Fix ornamenti

### `isCambiata` propagation
Il flag `isCambiata` non veniva copiato nelle note del pipeline (riga 164 di `useHarmonyLabels.ts`). Ora propagato correttamente. Aggiunto anche ai filtri:
- Cadential pattern recognition
- Bass ornament guard
- hasNctFlag
- Passing/escape equivalence

### Font ornamenti
`fontWeight={700}` → `fontStyle="italic" fontWeight={400}` nel rendering SVG (`GrandStaffEditor.tsx`).

## Risultato finale (C maj)
| Accordo | Prima | Dopo |
|---|---|---|
| B-D-F-Ab | `♭III=♭VI` | `vii°` |
| D-F-Ab-Cb | `♭III=♭VI` | `vii°/♭III` |
| F-Ab-Cb-Ebb | vari override | `vii°/♭V` |
| G#-B-D-F | override | `vii°/vi` |
| Gb-Bb-Db | `♭III` | `♭V` |

## Release v1.0.3

### Problema CI (GitHub Actions)
`npm ci` falliva: `@emnapi/core@1.10.0` e `@emnapi/runtime@1.10.0` mancanti dal lockfile.

**Causa:** `npm install --package-lock-only` non aggiunge le entry `node_modules/...` per optional deps multipiattaforma.

**Fix:** `rm -rf node_modules package-lock.json && npm install` per rigenerare il lockfile completo (342KB, 1672 entries aggiunte).

### Procedura release manuale (usata)
Il workflow CI automatico era inaffidabile (8 tentativi falliti). Usata la procedura manuale:
```bash
npm run build
GH_TOKEN="" npx electron-builder --mac --win --publish never
gh release create v1.0.3 ...
# Update harmonytutor/index.html via GitHub API
```

### Note lockfile
Il lockfile ora deve essere rigenerato con `npm install` (non `--package-lock-only`) quando cambiano optional deps piattaforma-specifiche.
