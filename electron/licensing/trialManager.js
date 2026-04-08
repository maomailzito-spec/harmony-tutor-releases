/**
 * trialManager.js — 10-day trial with anti-tamper protection.
 *
 * Trial state is stored in two places:
 *   1. JSON file in app.getPath('userData') — primary store
 *   2. Backup via Electron safeStorage (OS keychain) — survives reinstall
 *
 * Data stored: { installDate, lastRunDate, machineId, signature }
 *
 * Anti-tamper:
 *   - HMAC signature bound to machineId → can't be copied between machines
 *   - Clock rollback detection: if current date < lastRunDate → suspicious
 *   - If JSON is deleted but keychain backup exists → restore from keychain
 */
const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { getMachineId } = require('./machineId');
const { hmacSign, hmacVerify } = require('./licenseCrypto');

const TRIAL_DAYS = 10;
const TRIAL_FILE = 'trial.dat';
const KEYCHAIN_SERVICE = 'HarmonyTutor-Trial';

// ── Helpers ──

function getTrialFilePath() {
  return path.join(app.getPath('userData'), TRIAL_FILE);
}

function nowISO() {
  return new Date().toISOString();
}

function daysBetween(dateStrA, dateStrB) {
  const a = new Date(dateStrA);
  const b = new Date(dateStrB);
  return (b - a) / (1000 * 60 * 60 * 24);
}

// ── File I/O ──

function writeTrialFile(data, machineId) {
  const payload = JSON.stringify({ installDate: data.installDate, lastRunDate: data.lastRunDate, machineId });
  const signature = hmacSign(payload, machineId);
  const record = { ...JSON.parse(payload), signature };
  fs.writeFileSync(getTrialFilePath(), JSON.stringify(record, null, 2), 'utf8');
}

function readTrialFile(machineId) {
  try {
    const raw = fs.readFileSync(getTrialFilePath(), 'utf8');
    const record = JSON.parse(raw);
    const { signature, ...rest } = record;
    const payload = JSON.stringify(rest);
    if (!hmacVerify(payload, signature, machineId)) return null; // tampered
    if (rest.machineId !== machineId) return null; // wrong machine
    return rest;
  } catch {
    return null;
  }
}

// ── Keychain backup ──

function writeKeychainBackup(data) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return;
    const json = JSON.stringify(data);
    const encrypted = safeStorage.encryptString(json);
    const backupPath = path.join(app.getPath('userData'), '.trial-backup');
    fs.writeFileSync(backupPath, encrypted);
  } catch { /* ignore */ }
}

function readKeychainBackup() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const backupPath = path.join(app.getPath('userData'), '.trial-backup');
    if (!fs.existsSync(backupPath)) return null;
    const encrypted = fs.readFileSync(backupPath);
    const json = safeStorage.decryptString(encrypted);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ── Main API ──

/**
 * Check trial status. Returns:
 *   { status: 'active', daysRemaining: N }
 *   { status: 'expired' }
 *   { status: 'clock-tamper' }
 *   { status: 'licensed' }         (placeholder for future license check)
 */
function checkTrial() {
  const machineId = getMachineId();
  const now = nowISO();

  // Try reading from file first
  let data = readTrialFile(machineId);

  // If file is missing/tampered, try keychain backup
  if (!data) {
    const backup = readKeychainBackup();
    if (backup && backup.machineId === machineId) {
      data = backup;
      // Restore the file from backup
      writeTrialFile(data, machineId);
    }
  }

  // First run ever — initialize trial
  if (!data) {
    data = { installDate: now, lastRunDate: now, machineId };
    writeTrialFile(data, machineId);
    writeKeychainBackup(data);
    return { status: 'active', daysRemaining: TRIAL_DAYS };
  }

  // Clock rollback detection: if now is significantly before lastRunDate
  const daysSinceLastRun = daysBetween(data.lastRunDate, now);
  if (daysSinceLastRun < -1) {
    // Allow up to 1 day of clock drift (DST, timezone changes)
    return { status: 'clock-tamper' };
  }

  // Check expiry
  const daysSinceInstall = daysBetween(data.installDate, now);
  if (daysSinceInstall > TRIAL_DAYS) {
    return { status: 'expired' };
  }

  // Update lastRunDate
  data.lastRunDate = now;
  writeTrialFile(data, machineId);
  writeKeychainBackup(data);

  const daysRemaining = Math.max(0, Math.ceil(TRIAL_DAYS - daysSinceInstall));
  return { status: 'active', daysRemaining };
}

/**
 * Get trial info without modifying state.
 */
function getTrialInfo() {
  const machineId = getMachineId();
  const data = readTrialFile(machineId);
  if (!data) return { installed: false };
  const daysSinceInstall = daysBetween(data.installDate, nowISO());
  return {
    installed: true,
    installDate: data.installDate,
    daysElapsed: Math.floor(daysSinceInstall),
    daysRemaining: Math.max(0, Math.ceil(TRIAL_DAYS - daysSinceInstall)),
    expired: daysSinceInstall > TRIAL_DAYS,
  };
}

module.exports = { checkTrial, getTrialInfo, TRIAL_DAYS };
