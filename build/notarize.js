/**
 * afterSign hook for electron-builder.
 * Notarizes the macOS app with Apple's notary service.
 *
 * Credentials are stored in macOS Keychain under the profile
 * "harmony-tutor-notarize" (set up via xcrun notarytool store-credentials).
 *
 * Fallback: set APPLE_ID + APPLE_APP_PASSWORD + APPLE_TEAM_ID env vars.
 */
const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  // Only notarize on macOS
  if (electronPlatformName !== 'darwin') return;

  // PACCHETTO DI PROVA IN LOCALE: con SKIP_NOTARIZE=1 si salta la notarizzazione.
  // Serve a provare la build vera sulla propria macchina prima di mettere il tag, senza
  // dipendere dalle credenziali Apple (che scadono, e il cui 401 non ha niente a che
  // vedere col codice che si vuole provare). La CI non la imposta, quindi i pacchetti
  // pubblicati restano notarizzati.
  if (String(process.env.SKIP_NOTARIZE || '') === '1') {
    console.log('⏭️  Notarizzazione saltata (SKIP_NOTARIZE=1) — pacchetto di sola prova.');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`🔏 Notarizing ${appPath} ...`);

  // Prefer keychain profile; fall back to env vars
  if (process.env.APPLE_ID && process.env.APPLE_APP_PASSWORD) {
    await notarize({
      appPath,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID || '6VGJA5UP2N',
    });
  } else {
    await notarize({
      appPath,
      keychainProfile: 'harmony-tutor-notarize',
    });
  }

  console.log('✅ Notarization complete.');
};
