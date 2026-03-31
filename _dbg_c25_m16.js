// Debug cantata 25 m16 b1
const fs = require('fs');
const path = require('path');

// Load the analysis module
const mt = require('../src/utils/musicTheory.ts');
// Can't require .ts directly — use the fixture snapshot instead
const snap = JSON.parse(fs.readFileSync('scripts/fixtures/snap-cantata-25-bach.json', 'utf8'));

// Check if snapshot has the m16 b1 label
const labels = snap.labels || snap.gold || [];
const m16 = labels.filter(l => l.measure === 16 || l.measureIndex === 15);
console.log('m16 labels:', JSON.stringify(m16, null, 2));
