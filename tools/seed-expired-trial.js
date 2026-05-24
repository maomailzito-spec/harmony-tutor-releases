/**
 * seed-expired-trial.js — Forza lo stato di trial scaduto SENZA toccare l'orologio.
 *
 * Calcola il machineId locale (identico a electron/licensing/machineId.js),
 * genera un trial.dat firmato HMAC con installDate di 15 giorni fa e lastRunDate
 * di 1 ora fa (così non scatta la clock-tamper detection), cancella anche
 * .trial-backup e license.enc nella userData dir per far partire il dialog di
 * attivazione al prossimo avvio dell'app.
 *
 * Uso:
 *   node tools/seed-expired-trial.js
 *
 * Funziona su macOS e Windows. Su Windows va lanciato con la versione
 * production di Harmony Tutor INSTALLATA (perché lo script deduce la userData
 * dir di Electron, non la crea ex novo).
 *
 * ATTENZIONE: lo script CANCELLA la licenza salvata localmente (license.enc).
 * Dopo il test dovrai riattivare la tua chiave dal menu.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── machineId (identico a electron/licensing/machineId.js) ─────────────
function getMachineId() {
  const parts = [];
  try {
    const cpus = os.cpus();
    if (cpus.length > 0) parts.push(cpus[0].model);
    parts.push(String(cpus.length));
  } catch { /* ignore */ }
  try { parts.push(String(os.totalmem())); } catch { /* ignore */ }
  try { parts.push(os.hostname()); } catch { /* ignore */ }
  parts.push(os.platform());
  parts.push(os.arch());
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const iface of nets[name]) {
        if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
          parts.push(iface.mac);
          break;
        }
      }
      if (parts.length > 5) break;
    }
  } catch { /* ignore */ }
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

// ── HMAC (identico a electron/licensing/licenseCrypto.js) ──────────────
const APP_SALT = 'HarmonyTutor-2026-salt';
function deriveKey(machineId) {
  return crypto.createHash('sha256').update(APP_SALT + '|' + machineId).digest();
}
function hmacSign(payload, machineId) {
  return crypto.createHmac('sha256', deriveKey(machineId)).update(payload).digest('hex');
}

// ── userData path per flavor 'grandstaff' ──────────────────────────────
// Replica la logica di main.js:
//   app.setPath('userData', path.join(appData, 'harmony-tutor-grandstaff'))
function getUserDataDir() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'harmony-tutor-grandstaff');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'harmony-tutor-grandstaff');
  }
  // linux
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdg, 'harmony-tutor-grandstaff');
}

// ── Main ───────────────────────────────────────────────────────────────
const machineId = getMachineId();
const userDataDir = getUserDataDir();
const trialPath = path.join(userDataDir, 'trial.dat');
const backupPath = path.join(userDataDir, '.trial-backup');
const licensePath = path.join(userDataDir, 'license.enc');

const now = new Date();
const installDate = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString();
const lastRunDate = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

const payload = JSON.stringify({ installDate, lastRunDate, machineId });
const signature = hmacSign(payload, machineId);
const record = { installDate, lastRunDate, machineId, signature };

fs.mkdirSync(userDataDir, { recursive: true });
fs.writeFileSync(trialPath, JSON.stringify(record, null, 2), 'utf8');

let removedBackup = false;
let removedLicense = false;
try { fs.unlinkSync(backupPath); removedBackup = true; } catch { /* not present */ }
try { fs.unlinkSync(licensePath); removedLicense = true; } catch { /* not present */ }

console.log('✓ Trial seedato come SCADUTO (senza toccare l\'orologio)');
console.log('');
console.log('  userData :', userDataDir);
console.log('  trial.dat: scritto');
console.log('    installDate :', installDate, '  (15 giorni fa)');
console.log('    lastRunDate :', lastRunDate, '  (1 ora fa)');
console.log('    machineId   :', machineId.slice(0, 16) + '…');
console.log('  .trial-backup:', removedBackup ? 'rimosso' : 'non presente');
console.log('  license.enc  :', removedLicense ? 'rimosso (riattiva dal menu dopo il test)' : 'non presente');
console.log('');
console.log('Ora lancia Harmony Tutor: dovrebbe apparire il dialog di trial scaduto.');
