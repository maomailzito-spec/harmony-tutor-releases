/**
 * machineId.js — Generates a stable, unique fingerprint for this machine.
 * Used to bind trial data and license activations to a specific computer.
 *
 * Combines: CPU model + total RAM + OS hostname + platform + first MAC address.
 * The result is a SHA-256 hash (hex) — deterministic and not reversible.
 */
const os = require('os');
const crypto = require('crypto');

function getMachineId() {
  const parts = [];

  // CPU model (stable across reboots)
  try {
    const cpus = os.cpus();
    if (cpus.length > 0) parts.push(cpus[0].model);
    parts.push(String(cpus.length));
  } catch { /* ignore */ }

  // Total RAM (stable)
  try {
    parts.push(String(os.totalmem()));
  } catch { /* ignore */ }

  // Hostname
  try {
    parts.push(os.hostname());
  } catch { /* ignore */ }

  // Platform + arch
  parts.push(os.platform());
  parts.push(os.arch());

  // First non-internal MAC address (stable on desktops)
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const iface of nets[name]) {
        if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
          parts.push(iface.mac);
          break;
        }
      }
      if (parts.length > 5) break; // found a MAC
    }
  } catch { /* ignore */ }

  const raw = parts.join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

module.exports = { getMachineId };
