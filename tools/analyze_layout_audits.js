const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const files = fs.readdirSync(ROOT).filter(f => f.startsWith('layout-audit-') && f.endsWith('.json'));
if (files.length === 0) {
  console.error('No layout-audit-*.json files found in workspace root.');
  process.exit(1);
}

const expected = 48; // expected pxPerQuarter from DEFAULT_PX_PER_TICK * TICKS_PER_QUARTER
const tol = 6; // tolerance

const stats = {
  filesProcessed: files.length,
  entries: {}, // px value -> count
  anomalies: [],
};

files.forEach(fname => {
  try {
    const raw = fs.readFileSync(path.join(ROOT, fname), 'utf8');
    const obj = JSON.parse(raw);
    const measures = obj.measures || obj.measures || obj.measuresInfo || obj.measures || [];
    const values = [];
    // Try to handle different shapes
    const arr = Array.isArray(obj.measures) ? obj.measures : (Array.isArray(obj) ? obj : (Array.isArray(obj.measuresInfo) ? obj.measuresInfo : []));
    for (const m of arr) {
      const v = (m && (typeof m.pxPerQuarter !== 'undefined')) ? m.pxPerQuarter : (m && (typeof m.px_per_quarter !== 'undefined') ? m.px_per_quarter : null);
      if (v === null || typeof v === 'undefined') {
        values.push(null);
        stats.entries['null'] = (stats.entries['null'] || 0) + 1;
      } else {
        const key = String(v);
        values.push(v);
        stats.entries[key] = (stats.entries[key] || 0) + 1;
      }
    }

    // Detect anomalies in this file: any pxPerQuarter that differs from expected by > tol
    const bad = (values || []).filter(v => v === null || Math.abs((v || 0) - expected) > tol);
    if (bad.length > 0) {
      stats.anomalies.push({ file: fname, values: values.slice(0, 20) });
    }
  } catch (e) {
    stats.anomalies.push({ file: fname, error: String(e) });
  }
});

const out = path.join(ROOT, 'tools', 'layout-audit-summary.json');
fs.writeFileSync(out, JSON.stringify(stats, null, 2));
console.log('Wrote summary to', out);
console.log('Files processed:', stats.filesProcessed);
console.log('Unique pxPerQuarter values (sample):', Object.keys(stats.entries).slice(0,40));
console.log('Anomalous files (first 20):', stats.anomalies.slice(0,20).map(a => a.file));
process.exit(0);
