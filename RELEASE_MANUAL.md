# Harmony Tutor — Manuale Release Manuale

> Questo documento descrive la procedura **manuale** per produrre e pubblicare una release di Harmony Tutor (macOS + Windows) senza dipendere dal workflow GitHub Actions.
> Tutto è basato sulla configurazione reale del progetto al momento della stesura (v1.0.4).

---

## ⚡ Procedura automatica (consigliata)

Per la **maggior parte** delle release usa lo script automatico:

```bash
./scripts/release.sh 1.0.7
```

Lo script esegue in ordine:
1. Pre-flight checks (branch, working tree pulito, tag non esistente, allineato con remote)
2. Conferma esplicita che `RELEASE_NOTES.md` sia aggiornato
3. Build locale (`npm run build`) come pre-flight
4. Bump versione in `package.json` + `package-lock.json`
5. Commit `release: vX.Y.Z` + tag annotato + push (commit, poi tag)

A push del tag, **GitHub Actions** prende in carico:
- Build macOS (DMG + ZIP, firmato + notarizzato)
- Build Windows (EXE)
- Crea Release con DMG, ZIP, EXE, `latest-mac.yml`, `latest.yml`
- Aggiorna i link sul sito `harmonytutor.it` (solo per release stabili — non test/beta/alpha)

**Monitor**: https://github.com/maomailzito-spec/harmony-tutor-releases/actions

### Pre-flight checklist manuale

Prima di lanciare `release.sh`, verifica a mano:
- [ ] `RELEASE_NOTES.md` aggiornato con le novità della versione
- [ ] `npm run regress` passa (se hai toccato l'analisi armonica)
- [ ] App testata localmente (smoke test: apri un .htp, salva, riapri)
- [ ] Branch corretto (di norma `main` o `test-release-workflow` per test)
- [ ] Tutto committato e pushato

### Versioning

- **Stabile**: `1.0.7` → pubblicata come Release normale, aggiorna sito
- **Test**: `1.0.7-test` → pubblicata come Pre-release, sito NON aggiornato
- **Beta/Alpha**: `1.0.7-beta.1`, `1.0.7-alpha.2` → pre-release

### Se la GitHub Action fallisce

Cause comuni (in ordine di frequenza):
1. **`npm ci` fail per lock drift** — il workflow ora ha un fallback automatico (`rm package-lock.json && npm install`). Se ricapita, rigenera localmente: `rm package-lock.json && npm install && git add package-lock.json && git commit -m 'chore: refresh lockfile' && git push`.
2. **Notarizzazione Apple lenta/timeout** — riavvia il workflow (Re-run failed jobs).
3. **Artifact mancante** — il job ora fallisce esplicitamente con elenco file mancanti. Indica un build fallito a monte (controlla i log del job mac/win).
4. **Release già esistente** — se il tag è stato pushato ma il workflow ha fallito a metà: cancella la Release dalla UI GitHub, poi `Re-run all jobs`.

### Rollback (se devi rifare la release)

```bash
TAG=v1.0.7
# Locale
git tag -d "$TAG"
# Remoto
git push origin ":refs/tags/$TAG"
# Cancella anche la Release su GitHub dalla UI
# Poi rilancia: ./scripts/release.sh 1.0.7
```

---

## Prerequisiti

| Requisito | Dettaglio |
|---|---|
| macOS con Apple Silicon | Il build macOS richiede firma Developer ID — solo su Mac |
| Xcode Command Line Tools | `xcode-select --install` |
| Node.js 20 + npm | `node -v` deve mostrare v20.x |
| Certificato "Developer ID Application" | Installato nel Keychain di sistema |
| Profilo Keychain notarizzazione | Creato con `xcrun notarytool store-credentials` (vedi §3) |
| `gh` CLI | `brew install gh` — autenticato al repo `maomailzito-spec/harmony-tutor-releases` |
| `GH_TOKEN` | PAT con scope `repo` (letto automaticamente dal remote URL, vedi §5) |

---

## 1. Preparazione

### 1.1 Bump versione

```bash
cd /path/to/harmony-tutor-locale

# Aggiorna version in package.json (senza creare tag git)
npm version X.Y.Z --no-git-tag-version

# Aggiorna RELEASE_NOTES.md con le novità della versione
# (il file viene usato come corpo della GitHub Release)
```

### 1.2 Verifica build

```bash
npm run build
# Esegue in sequenza:
#   1. audit:contracts  — verifica IPC preload/menu
#   2. vite build       — produce dist/
```

Se ci sono errori TypeScript o di contratto, correggerli prima di procedere.

### 1.3 Commit e tag

```bash
git add -A
git commit -m "release: vX.Y.Z"
git tag -a vX.Y.Z -m "Release vX.Y.Z"
```

---

## 2. Build locale

### 2.1 macOS (DMG + ZIP, arm64)

```bash
VITE_APP_FLAVOR=grandstaff GH_TOKEN="" npx electron-builder --mac --publish never
```

**Output in `release/`:**
- `Harmony Tutor-X.Y.Z-mac.dmg` — installer drag-and-drop
- `Harmony Tutor-X.Y.Z-mac.dmg.blockmap`
- `Harmony Tutor-X.Y.Z-mac.zip` — **richiesto dall'auto-updater** (vedi §4)
- `Harmony Tutor-X.Y.Z-mac.zip.blockmap`
- `latest-mac.yml` — manifest per l'auto-updater

> **Nota:** Il processo include firma (`codesign`) + notarizzazione Apple (~3-5 min per l'invio ad Apple). Viene eseguito automaticamente tramite `build/notarize.js` (hook `afterSign`).

### 2.2 Windows (EXE, x64)

```bash
VITE_APP_FLAVOR=grandstaff GH_TOKEN="" npx electron-builder --win --publish never
```

**Output in `release/`:**
- `Harmony Tutor-X.Y.Z-win.exe` — installer NSIS one-click
- `Harmony Tutor-X.Y.Z-win.exe.blockmap`
- `latest.yml` — manifest per l'auto-updater Windows

> Windows non richiede ZIP. L'auto-updater scarica direttamente l'`.exe`.

### 2.3 Build di entrambi in un colpo solo

```bash
VITE_APP_FLAVOR=grandstaff GH_TOKEN="" npx electron-builder --mac --win --publish never
```

---

## 3. Firma e notarizzazione macOS

### Certificato

- **Tipo:** Developer ID Application
- **Identità:** `Developer ID Application: ERMINIO ZITO (6VGJA5UP2N)`
- **Hash:** `297FEA6B461B1FC76EDE6B324C781A4BDED0AF2A`
- Deve essere installato nel Keychain di sistema. Verifica:
  ```bash
  security find-identity -v -p codesigning | grep "ERMINIO ZITO"
  ```

### Profilo notarizzazione (Keychain)

Il metodo preferito è il profilo Keychain (non richiede variabili d'ambiente):

```bash
# Da eseguire una sola volta per configurare il profilo
xcrun notarytool store-credentials "harmony-tutor-notarize" \
  --apple-id "TUA_APPLE_ID@email.com" \
  --team-id "6VGJA5UP2N" \
  --password "xxxx-xxxx-xxxx-xxxx"   # App-specific password da appleid.apple.com
```

Il nome del profilo (`harmony-tutor-notarize`) è hardcoded in `build/notarize.js`.

### Metodo alternativo (variabili d'ambiente)

Se il Keychain non è disponibile (es. macchina nuova):

```bash
export APPLE_ID="tua@email.com"
export APPLE_APP_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="6VGJA5UP2N"
VITE_APP_FLAVOR=grandstaff GH_TOKEN="" npx electron-builder --mac --publish never
```

### Entitlements

Definiti in `build/entitlements.mac.plist` (applicati sia all'app che ai frameworks):
- `cs.allow-jit`, `cs.allow-unsigned-executable-memory`, `cs.allow-dyld-environment-variables` — necessari per Electron con Hardened Runtime
- `network.client` — per validazione licenza
- `files.user-selected.read-write` — per aprire/salvare file `.htp`

---

## 4. File YML — manifest auto-updater

I file YML vengono generati automaticamente da electron-builder, **ma il nome degli asset su GitHub usa punti al posto degli spazi** (GitHub converte gli spazi in `.`). Verificare che gli URL nel YML corrispondano ai nomi reali degli asset.

### `latest-mac.yml` (macOS)

Generato in `release/latest-mac.yml`. Deve contenere **sia zip che dmg**:

```yaml
version: X.Y.Z
files:
  - url: Harmony.Tutor-X.Y.Z-mac.zip      # ← punti, non spazi
    sha512: <base64>
    size: <bytes>
  - url: Harmony.Tutor-X.Y.Z-mac.dmg
    sha512: <base64>
    size: <bytes>
path: Harmony.Tutor-X.Y.Z-mac.zip         # ← zip come entry principale
sha512: <base64>
releaseDate: 'YYYY-MM-DDTHH:mm:ss.sssZ'
```

> **Attenzione:** Se electron-builder scrive `Harmony Tutor-X.Y.Z-mac.zip` (con spazi), l'auto-updater riceverà un 404 perché GitHub serve il file come `Harmony.Tutor-X.Y.Z-mac.zip`. Correggere manualmente con:
> ```bash
> sed -i '' 's/Harmony Tutor-/Harmony.Tutor-/g' release/latest-mac.yml
> ```

### `latest.yml` (Windows)

Generato correttamente da electron-builder, nessuna modifica necessaria.

### Ricalcolo manuale sha512 (se si crea lo zip manualmente)

Se il build con target zip si blocca, si può creare lo zip a mano dall'`.app` già firmata:

```bash
# 1. Crea zip preservando i metadati macOS
ditto -c -k --sequesterRsrc --keepParent \
  "release/mac-arm64/Harmony Tutor.app" \
  "release/Harmony Tutor-X.Y.Z-mac.zip"

# 2. Calcola sha512 e size
SHA=$(openssl dgst -sha512 -binary "release/Harmony Tutor-X.Y.Z-mac.zip" | base64)
SIZE=$(wc -c < "release/Harmony Tutor-X.Y.Z-mac.zip" | tr -d ' ')
echo "sha512: $SHA"
echo "size:   $SIZE"
```

Inserire i valori ottenuti nel `latest-mac.yml` manualmente.

---

## 5. Upload su GitHub

### 5.1 Estrai il token dal remote URL

Il token è già embedded nell'URL del remote:

```bash
export GH_TOKEN=$(git remote get-url origin | sed 's|https://maomailzito-spec:\(.*\)@github.com.*|\1|')
```

### 5.2 Crea la release e carica tutti i file

```bash
VERSION="X.Y.Z"

gh release create "v${VERSION}" \
  "release/Harmony Tutor-${VERSION}-mac.dmg#Harmony.Tutor-${VERSION}-mac.dmg" \
  "release/Harmony Tutor-${VERSION}-mac.zip#Harmony.Tutor-${VERSION}-mac.zip" \
  "release/Harmony Tutor-${VERSION}-win.exe#Harmony.Tutor-${VERSION}-win.exe" \
  release/latest-mac.yml \
  release/latest.yml \
  --repo maomailzito-spec/harmony-tutor-releases \
  --title "Harmony Tutor v${VERSION}" \
  --notes-file RELEASE_NOTES.md
```

> La sintassi `file#nome-pubblicato` rinomina l'asset su GitHub (obbligatorio per sostituire spazi con punti).

### 5.3 Aggiunta asset a release esistente (es. zip dimenticato)

```bash
gh release upload "v${VERSION}" \
  "release/Harmony Tutor-${VERSION}-mac.zip#Harmony.Tutor-${VERSION}-mac.zip" \
  --repo maomailzito-spec/harmony-tutor-releases --clobber

# Aggiorna anche il latest-mac.yml
gh release upload "v${VERSION}" \
  release/latest-mac.yml \
  --repo maomailzito-spec/harmony-tutor-releases --clobber
```

### 5.4 Verifica asset presenti

```bash
gh release view "v${VERSION}" \
  --repo maomailzito-spec/harmony-tutor-releases | grep asset
```

Output atteso:
```
asset:  Harmony.Tutor-X.Y.Z-mac.dmg
asset:  Harmony.Tutor-X.Y.Z-mac.zip
asset:  Harmony.Tutor-X.Y.Z-win.exe
asset:  latest-mac.yml
asset:  latest.yml
```

---

## 6. Push branch e tag

```bash
git push origin work/canonical-line
git push origin "vX.Y.Z"

# Se il tag esiste già in remote (es. rebuild):
git push origin "vX.Y.Z" --force
```

---

## 7. Aggiornamento sito (harmonytutor.it)

Il sito è nel repo `maomailzito-spec/harmonytutor`. I link di download in `index.html` vanno aggiornati con la nuova versione:

```bash
export GH_TOKEN=$(git remote get-url origin | sed 's|https://maomailzito-spec:\(.*\)@github.com.*|\1|')
VERSION="X.Y.Z"

git clone "https://x-access-token:${GH_TOKEN}@github.com/maomailzito-spec/harmonytutor.git" /tmp/site
cd /tmp/site

# Sostituisce qualsiasi versione precedente con la nuova
sed -i '' "s|releases/download/v[0-9.]*\/Harmony\.Tutor-[0-9.]*-|releases/download/v${VERSION}/Harmony.Tutor-${VERSION}-|g" index.html

git config user.name "release-bot"
git config user.email "release@harmonytutor.it"
git add index.html
git commit -m "chore: update download links to v${VERSION}"
git push
```

> Google Analytics: `G-5L62VXGSS2` è già configurato staticamente nell'`index.html` — non toccare.

---

## 8. Verifica finale

### 8.1 Controlla che la release sia pubblica

```bash
gh release view "vX.Y.Z" --repo maomailzito-spec/harmony-tutor-releases
```

### 8.2 Controlla i manifest YML direttamente da GitHub

```bash
curl -s "https://github.com/maomailzito-spec/harmony-tutor-releases/releases/download/vX.Y.Z/latest-mac.yml"
curl -s "https://github.com/maomailzito-spec/harmony-tutor-releases/releases/download/vX.Y.Z/latest.yml"
```

Verificare che:
- `version` corrisponda alla versione rilasciata
- `url` in `latest-mac.yml` usi punti (non spazi): `Harmony.Tutor-...`
- `path` punti al file `.zip` (non al `.dmg`)

### 8.3 Test auto-updater da app installata

Aprire la versione precedente dell'app → Menu **Harmony Tutor → Controlla aggiornamenti**.
L'app deve:
1. Trovare la nuova versione
2. Chiedere conferma prima di scaricare
3. Mostrare la barra di avanzamento
4. Offrire di riavviare subito o alla prossima chiusura

---

## 9. Workflow automatico (riferimento)

Il file `.github/workflows/release.yml` fa tutto quanto sopra in CI quando si pusha un tag `v*`. La procedura manuale è identica ma eseguita localmente. Il workflow richiede questi secrets nel repo:

| Secret | Contenuto |
|---|---|
| `GH_TOKEN` | PAT con accesso a `harmony-tutor-releases` e `harmonytutor` |
| `APPLE_CERTIFICATE_P12` | Certificato Developer ID in base64 (`base64 -i cert.p12`) |
| `APPLE_CERTIFICATE_PASSWORD` | Password del `.p12` |
| `APPLE_ID` | Apple ID email |
| `APPLE_APP_PASSWORD` | App-specific password da appleid.apple.com |
| `APPLE_TEAM_ID` | `6VGJA5UP2N` |

---

## 10. Checklist rapida

```
[ ] npm version X.Y.Z --no-git-tag-version
[ ] Aggiornato RELEASE_NOTES.md
[ ] npm run build  →  zero errori
[ ] electron-builder --mac --win --publish never
[ ] Verificato latest-mac.yml: url usa punti, path punta allo zip
[ ] gh release create con tutti e 5 gli asset
[ ] gh release view  →  5 asset presenti
[ ] git push branch + tag
[ ] Aggiornato index.html su harmonytutor.it
[ ] Test auto-updater da versione precedente
```
