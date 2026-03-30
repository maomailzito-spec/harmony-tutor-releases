const fs = require('fs');
const fx = JSON.parse(fs.readFileSync('./tests/Dubois n5 p 13.json', 'utf8'));
const bpm = 3;
const notes = fx.notes.sort((a, b) => a.startTick - b.startTick);

// Check accidentals now
const withAcc = notes.filter(n => n.accidental !== undefined && n.accidental !== null);
console.log('Notes with accidental:', withAcc.length, '/', notes.length);

// Show notes around ab=33 (m12 b1)
console.log('\n=== Around ab=33 (m12 b1) ===');
for (const n of notes) {
  const ab = n.startTick / 480;
  if (ab >= 31 && ab <= 35) {
    console.log('ab=' + ab.toFixed(1) + ' ' + n.pitch + '(' + (n.accidental || '?') + ')' + n.octave + ' midi=' + n.midi + ' v=' + n.voice);
  }
}

// Show notes around ab=66 (m23 b1)
console.log('\n=== Around ab=66 (m23 b1) ===');
for (const n of notes) {
  const ab = n.startTick / 480;
  if (ab >= 64 && ab <= 68) {
    console.log('ab=' + ab.toFixed(1) + ' ' + n.pitch + '(' + (n.accidental || '?') + ')' + n.octave + ' midi=' + n.midi + ' v=' + n.voice);
  }
}

// Show all E# notes
console.log('\n=== All E# notes ===');
for (const n of notes) {
  if (n.pitch === 'E' && (n.accidental === 'sharp')) {
    const ab = n.startTick / 480;
    const m = Math.floor(ab / bpm) + 1;
    console.log('m' + m + ' ab=' + ab.toFixed(1) + ' ' + n.pitch + '(' + n.accidental + ')' + n.octave + ' midi=' + n.midi);
  }
}
