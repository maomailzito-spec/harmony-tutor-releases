# Riepilogo Setup Release — Harmony Tutor

> Documento riservato. Non condividere. Contiene riferimenti a credenziali sensibili.

---

## 1. Repository GitHub

| Repo | Scopo |
|------|-------|
| `maomailzito-spec/harmony-tutor-releases` | Codice sorgente + release (DMG, EXE) |
| `maomailzito-spec/harmonytutor` | Sito web (GitHub Pages → harmonytutor.it) |

---

## 2. Secrets configurati su GitHub Actions

Percorso: https://github.com/maomailzito-spec/harmony-tutor-releases/settings/secrets/actions

| Secret | Descrizione | Come rigenerarlo |
|--------|-------------|------------------|
| `GH_TOKEN` | Personal Access Token GitHub (fine-grained, tutti i repo, permessi: Contents R/W, Metadata R, Workflows R/W) | https://github.com/settings/personal-access-tokens |
| `APPLE_CERTIFICATE_P12` | Certificato di firma Apple "Developer ID Application: ERMINIO ZITO" in base64 | Keychain Access → esporta .p12 → `base64 -i cert.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Password del file .p12 | Quella scelta durante l'export (attuale: impostata il 15/04/2026) |
| `APPLE_ID` | Email Apple ID | maomail.zito@gmail.com |
| `APPLE_APP_PASSWORD` | Password specifica per le app Apple (per la notarizzazione) | https://account.apple.com → Accesso e sicurezza → Password specifiche per le app |
| `APPLE_TEAM_ID` | Apple Developer Team ID | 6VGJA5UP2N |

---

## 3. Come fare una nuova release

### Passo 1 — Apri il terminale

### Passo 2 — Vai nella cartella del progetto
```bash
cd ~/Desktop/harmony-tutor-locale
```

### Passo 3 — Salva le modifiche (se non ancora committate)
```bash
git add -A && git commit -m "descrizione delle modifiche"
```

### Passo 4 — Lancia la release (scegli il numero di versione)
```bash
./scripts/release.sh 1.0.2
```

### Cosa succede in automatico:
1. Aggiorna la versione in package.json
2. Crea un tag git e lo pusha su GitHub
3. GitHub Actions compila l'app per macOS (firmata + notarizzata) e Windows
4. Crea la Release su GitHub con i file DMG e EXE
5. Aggiorna i link di download sul sito harmonytutor.it

### Passo 5 — Verifica (opzionale, dopo ~15-20 minuti)
- Vai su: https://github.com/maomailzito-spec/harmony-tutor-releases/actions
- Pallino verde = tutto ok
- Pallino rosso = qualcosa è andato storto

---

## 4. Licenze (Lemon Squeezy)

- **Pannello**: https://app.lemonsqueezy.com
- **Link checkout**: https://harmonytutor.lemonsqueezy.com/checkout/buy/a5930998-3037-4c81-9990-2ebe269c7911
- **Prezzo**: 59€ una tantum

### Generare un codice gratuito per un insegnante:
1. Vai su Lemon Squeezy → Discounts → Create discount
2. Imposta 100% off
3. Attiva "Limit the number of redemptions" → metti 1
4. Dai un nome interno (es. "Prof. Marco")
5. Invia all'insegnante il codice sconto + il link di checkout
6. L'insegnante completa l'ordine (0€) → riceve la license key via email
7. Apre l'app → clicca "Inserisci Chiave" → incolla la license key

---

## 5. Notarizzazione locale (dal Mac)

Il profilo di notarizzazione è salvato nel Keychain con il nome `harmony-tutor-notarize`.
Viene usato automaticamente quando fai build locali con `npm run dist:mac`.

Se devi riconfigurarlo:
```bash
xcrun notarytool store-credentials "harmony-tutor-notarize" \
  --apple-id "maomail.zito@gmail.com" \
  --team-id "6VGJA5UP2N" \
  --password "la-app-specific-password"
```

---

## 6. Build locale manuale (se necessario)

Se per qualche motivo non vuoi usare GitHub Actions:

```bash
cd ~/Desktop/harmony-tutor-locale

# Compila il frontend
npm run build

# Build macOS
npx electron-builder --mac

# Build Windows
npx electron-builder --win
```

I file finiscono in `release/`:
- `Harmony Tutor-X.X.X-mac.dmg`
- `Harmony Tutor-X.X.X-win.exe`

Poi caricali manualmente su: https://github.com/maomailzito-spec/harmony-tutor-releases/releases

---

## 7. Sito web

- **URL**: https://harmonytutor.it
- **Hosting**: GitHub Pages (repo `maomailzito-spec/harmonytutor`)
- **File principale**: `index.html`
- I link di download puntano alle release di `harmony-tutor-releases`
- Il workflow automatico aggiorna i link ad ogni release

Per modificare il sito manualmente:
https://github.com/maomailzito-spec/harmonytutor/edit/main/index.html

---

*Documento creato il 15 aprile 2026*
