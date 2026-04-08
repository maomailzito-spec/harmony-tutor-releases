#!/usr/bin/env node
// Simple verifier: checks layout-audit JSON files for consistent pxPerQuarter
// according to DEFAULT_PX_PER_TICK * TICKS_PER_QUARTER.

const fs = require('fs');
const path = require('path');

const DEFAULT_PX_PER_TICK = 0.05; // must match src/constants.ts
const TICKS_PER_QUARTER = 960;
const EXPECTED_PX_PER_QUARTER = DEFAULT_PX_PER_TICK * TICKS_PER_QUARTER; // 48
const EPS = 0.5; // allow small rounding diffs

function findAuditFiles(dir) {
  const names = fs.readdirSync(dir);
  return names.filter(n => n.startsWith('layout-audit') && n.endsWith('.json')).map(n => path.join(dir, n));
}

function checkFile(fp) {
  try {
    const raw = fs.readFileSync(fp, 'utf8');
    const parsed = JSON.parse(raw);
    const systems = parsed.systemsSummary || parsed.systems || null;
    if (!systems || !Array.isArray(systems)) {
      console.log(fp + ': no systemsSummary found -> SKIP');
      return true;
    }
    let ok = true;
    for (const s of systems) {
      const pxq = Number(s.pxPerQuarter || s.pxPerBeat || 0);
      if (!Number.isFinite(pxq)) continue;
      const diff = Math.abs(pxq - EXPECTED_PX_PER_QUARTER);
      const pass = diff <= EPS || pxq === 0;
      console.log(`${path.basename(fp)}: measureIndex=${s.measureIndex} pxPerQuarter=${pxq} expected=${EXPECTED_PX_PER_QUARTER.toFixed(2)} diff=${diff.toFixed(2)} => ${pass ? 'OK' : 'FAIL'}`);
      if (!pass) ok = false;
    }
    return ok;
  } catch (e) {
    console.error('Failed to parse', fp, e.message);
    return false;
  }
}

(function main(){
  const cwd = process.cwd();
  const files = findAuditFiles(cwd);
  if (files.length === 0) {
    console.log('No layout-audit-*.json files found in', cwd);
    process.exit(2);
  }
  let allOk = true;
  for (const f of files) {
    const ok = checkFile(f);
    if (!ok) allOk = false;
  }
  process.exit(allOk ? 0 : 1);
})();
