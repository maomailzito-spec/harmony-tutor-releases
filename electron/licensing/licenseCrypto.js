/**
 * licenseCrypto.js — HMAC signing and AES encryption for trial/license data.
 *
 * The secret is derived from the machineId so that:
 *   - Trial files from one machine are invalid on another.
 *   - Editing the JSON without the secret invalidates the HMAC.
 */
const crypto = require('crypto');

const APP_SALT = 'HarmonyTutor-2026-salt';

/**
 * Derive a machine-specific secret key.
 */
function deriveKey(machineId) {
  return crypto.createHash('sha256').update(APP_SALT + '|' + machineId).digest();
}

/**
 * Sign a payload string with HMAC-SHA256.
 * Returns hex string.
 */
function hmacSign(payload, machineId) {
  const key = deriveKey(machineId);
  return crypto.createHmac('sha256', key).update(payload).digest('hex');
}

/**
 * Verify an HMAC signature.
 */
function hmacVerify(payload, signature, machineId) {
  const expected = hmacSign(payload, machineId);
  // Constant-time comparison
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Encrypt a JSON-serializable object. Returns base64 string.
 */
function encrypt(data, machineId) {
  const key = deriveKey(machineId);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const json = JSON.stringify(data);
  let encrypted = cipher.update(json, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return iv.toString('base64') + ':' + encrypted;
}

/**
 * Decrypt a base64 string back to an object.
 */
function decrypt(encoded, machineId) {
  const key = deriveKey(machineId);
  const [ivB64, encB64] = encoded.split(':');
  if (!ivB64 || !encB64) return null;
  const iv = Buffer.from(ivB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encB64, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

module.exports = { hmacSign, hmacVerify, encrypt, decrypt };
