/**
 * licenseManager.js — License activation & validation via Cloudflare Worker.
 *
 * Stores the activated license locally (encrypted with machineId).
 * Validates online every 7 days; allows 30-day offline grace period.
 *
 * Flow:
 *   1. User enters license key → POST /activate to Worker
 *   2. Worker proxies to LemonSqueezy → returns instanceId
 *   3. License stored locally: { licenseKey, instanceId, activatedAt, lastValidated }
 *   4. On each app start: if >7 days since lastValidated → POST /validate
 *   5. If offline and <30 days grace → still allowed
 *   6. If offline and >30 days → blocked until online validation
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { getMachineId } = require('./machineId');
const { encrypt, decrypt } = require('./licenseCrypto');

// ── Configuration ──
// Replace with your actual Cloudflare Worker URL before production build.
const LICENSE_SERVER_URL = 'https://harmony-tutor-license.maomail-zito.workers.dev';
const VALIDATE_INTERVAL_DAYS = 7;
const OFFLINE_GRACE_DAYS = 30;
const LICENSE_FILE = 'license.enc';

// ── Helpers ──

function getLicenseFilePath() {
  return path.join(app.getPath('userData'), LICENSE_FILE);
}

function readLicense() {
  try {
    const machineId = getMachineId();
    const raw = fs.readFileSync(getLicenseFilePath(), 'utf8');
    return decrypt(raw, machineId);
  } catch {
    return null;
  }
}

function writeLicense(data) {
  const machineId = getMachineId();
  const encrypted = encrypt(data, machineId);
  fs.writeFileSync(getLicenseFilePath(), encrypted, 'utf8');
}

function removeLicense() {
  try {
    fs.unlinkSync(getLicenseFilePath());
  } catch { /* ignore */ }
}

function daysSince(isoString) {
  return (Date.now() - new Date(isoString).getTime()) / (1000 * 60 * 60 * 24);
}

async function postJSON(endpoint, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${LICENSE_SERVER_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ── Public API ──

/**
 * Activate a license key. Returns { success, error?, data? }
 */
async function activateLicense(licenseKey) {
  const machineId = getMachineId();
  try {
    const result = await postJSON('/activate', {
      licenseKey,
      instanceName: `HT-${machineId.slice(0, 8)}`,
    });

    if (result.valid && result.activated) {
      const licenseData = {
        licenseKey: result.licenseKey || licenseKey,
        instanceId: result.instanceId,
        customerName: result.customerName || null,
        customerEmail: result.customerEmail || null,
        activatedAt: new Date().toISOString(),
        lastValidated: new Date().toISOString(),
        expiresAt: result.expiresAt || null,
        machineId,
      };
      writeLicense(licenseData);
      return { success: true, data: licenseData };
    }

    return { success: false, error: result.error || 'Attivazione fallita' };
  } catch (err) {
    return { success: false, error: 'Impossibile contattare il server di licenze. Verifica la connessione.' };
  }
}

/**
 * Check if the current license is valid.
 * Returns:
 *   { status: 'licensed', customerName?, daysUntilRevalidation? }
 *   { status: 'no-license' }
 *   { status: 'invalid', error }
 *   { status: 'grace-period', daysRemaining }
 *   { status: 'grace-expired' }
 */
async function checkLicense() {
  const license = readLicense();
  if (!license || !license.licenseKey) {
    return { status: 'no-license' };
  }

  // Verify machineId matches
  const machineId = getMachineId();
  if (license.machineId && license.machineId !== machineId) {
    removeLicense();
    return { status: 'no-license' };
  }

  // Check if we need to revalidate online
  const daysSinceValidation = daysSince(license.lastValidated);

  if (daysSinceValidation < VALIDATE_INTERVAL_DAYS) {
    // Still within validation window — no need to call server
    return {
      status: 'licensed',
      customerName: license.customerName,
      daysUntilRevalidation: Math.ceil(VALIDATE_INTERVAL_DAYS - daysSinceValidation),
    };
  }

  // Try online validation
  try {
    const result = await postJSON('/validate', {
      licenseKey: license.licenseKey,
      instanceId: license.instanceId,
    });

    if (result.valid) {
      // Update lastValidated
      license.lastValidated = new Date().toISOString();
      writeLicense(license);
      return {
        status: 'licensed',
        customerName: license.customerName,
        daysUntilRevalidation: VALIDATE_INTERVAL_DAYS,
      };
    }

    // License revoked or expired on server
    removeLicense();
    return { status: 'invalid', error: result.error || 'Licenza non più valida' };
  } catch {
    // Offline — check grace period
    if (daysSinceValidation < OFFLINE_GRACE_DAYS) {
      return {
        status: 'grace-period',
        daysRemaining: Math.ceil(OFFLINE_GRACE_DAYS - daysSinceValidation),
      };
    }

    // Grace period expired
    return { status: 'grace-expired' };
  }
}

/**
 * Deactivate the current license (frees an activation slot).
 */
async function deactivateLicense() {
  const license = readLicense();
  if (!license) return { success: true };

  try {
    await postJSON('/deactivate', {
      licenseKey: license.licenseKey,
      instanceId: license.instanceId,
    });
  } catch {
    // Best-effort; remove locally anyway
  }
  removeLicense();
  return { success: true };
}

/**
 * Get stored license info (without validation).
 */
function getLicenseInfo() {
  const license = readLicense();
  if (!license) return { licensed: false };
  return {
    licensed: true,
    licenseKey: license.licenseKey ? license.licenseKey.slice(0, 8) + '...' : null,
    customerName: license.customerName,
    customerEmail: license.customerEmail,
    activatedAt: license.activatedAt,
    expiresAt: license.expiresAt,
  };
}

module.exports = {
  activateLicense,
  checkLicense,
  deactivateLicense,
  getLicenseInfo,
  LICENSE_SERVER_URL,
};
