#!/usr/bin/env node
/**
 * prepare-salamander.mjs — genera i campioni multi-velocity del pianoforte
 * (Salamander Grand Piano V3) nel formato che si aspetta l'app:
 *   public/sounds/piano_salamander/{Nota}{Ottava}_v{n}.mp3
 * con Nota in bemolle (C, Db, D, Eb, E, F, Gb, G, Ab, A, Bb, B), ottave A0..C8,
 * e n = 0..(LAYERS-1) dal piano (v0) al forte (vLAYERS-1).
 *
 * COSA FA:
 *  1. Scopre i file .wav di Salamander nella cartella che gli passi (ricorsivo).
 *     Riconosce i nomi tipo  A0v1.wav, C1v8.wav, Ds1v16.wav, Fs2v4.wav ...
 *  2. Sceglie LAYERS layer di velocity equidistanti tra quelli disponibili.
 *  3. Per ognuna delle 88 note (A0..C8) prende il campione registrato più vicino
 *     e lo traspone di ±1 semitono (sox, preserva la durata) per coprire i buchi.
 *  4. Converte in mp3 stereo (ffmpeg libmp3lame, VBR ~q3 ≈ 175 kbps).
 *
 * REQUISITI (gratis, open-source — su Mac:  brew install ffmpeg sox):
 *   - ffmpeg   (encode ogg)
 *   - sox      (pitch-shift di qualità che preserva la durata)
 *
 * USO:
 *   1) Scarica Salamander Grand Piano V3 (CC-BY 3.0) ed estrailo:
 *        https://archive.org/details/SalamanderGrandPianoV3
 *      (vanno bene i WAV 16-bit/44.1 o 24-bit/48: lo script trova i .wav da solo)
 *   2) node scripts/prepare-salamander.mjs <cartella-salamander> [--layers 6] [--dry-run]
 *
 * Esempi:
 *   node scripts/prepare-salamander.mjs ~/Downloads/SalamanderGrandPianoV3 --dry-run
 *   node scripts/prepare-salamander.mjs ~/Downloads/SalamanderGrandPianoV3
 *
 * Attribuzione (CC-BY 3.0): credita "Salamander Grand Piano V3 — Alexander Holm,
 * CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/), campioni ricompressi"
 * nella finestra "Informazioni…".
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, mkdirSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// ── parametri ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const layersArgIdx = args.indexOf('--layers');
const LAYERS = layersArgIdx !== -1 ? parseInt(args[layersArgIdx + 1], 10) : 6;
const inputDir = args.find(a => !a.startsWith('--') && a !== String(LAYERS));

if (!inputDir) {
  console.error('Uso: node scripts/prepare-salamander.mjs <cartella-salamander> [--layers 6] [--dry-run]');
  process.exit(1);
}
if (!existsSync(inputDir)) {
  console.error(`Cartella non trovata: ${inputDir}`);
  process.exit(1);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(scriptDir, '..', 'public', 'sounds', 'piano_salamander');

// ── util musicali ──────────────────────────────────────────────────────────
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** "A0" "Ds1" "C8" "Gb3" → midi (C4=60, A0=21). null se non valido. */
function noteToMidi(letter, accidental, octave) {
  const pc = LETTER_PC[letter.toUpperCase()];
  if (pc == null) return null;
  let off = 0;
  if (accidental === 's' || accidental === 'S' || accidental === '#') off = 1;
  else if (accidental === 'b' || accidental === 'B') off = -1;
  return (octave + 1) * 12 + pc + off;
}
/** midi → "Db4" (convenzione dell'app: bemolle, ottava floor(midi/12)-1). */
function midiToFileName(midi) {
  return `${FLATS[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

// ── 1. scoperta dei campioni sorgente ────────────────────────────────────────
const SAMPLE_RE = /^([A-G])([sb#]?)(\d+)v(\d+)\.wav$/i; // es. A0v1.wav, Ds1v16.wav

/** mappa: midi -> { layerNum -> filepath } */
const sources = new Map();
const layerNumbers = new Set();

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) { walk(full); continue; }
    const m = basename(name).match(SAMPLE_RE);
    if (!m) continue;
    const midi = noteToMidi(m[1], m[2], parseInt(m[3], 10));
    if (midi == null) continue;
    const layer = parseInt(m[4], 10);
    layerNumbers.add(layer);
    if (!sources.has(midi)) sources.set(midi, new Map());
    sources.get(midi).set(layer, full);
  }
}
walk(inputDir);

if (sources.size === 0) {
  console.error('Nessun campione riconosciuto (atteso nomi tipo A0v1.wav, Ds1v16.wav).');
  console.error('Controlla di aver passato la cartella che contiene i .wav di Salamander.');
  process.exit(1);
}

const sampledMidis = [...sources.keys()].sort((a, b) => a - b);
const availableLayers = [...layerNumbers].sort((a, b) => a - b);

// ── 2. scelta dei LAYERS layer equidistanti ──────────────────────────────────
const chosenLayers = [];
for (let i = 0; i < LAYERS; i++) {
  const idx = Math.round((i * (availableLayers.length - 1)) / (LAYERS - 1));
  chosenLayers.push(availableLayers[idx]);
}

// ── target: 88 note A0(21)..C8(108) ──────────────────────────────────────────
const TARGETS = [];
for (let midi = 21; midi <= 108; midi++) TARGETS.push(midi);

function nearestSampled(midi) {
  let best = sampledMidis[0];
  for (const s of sampledMidis) if (Math.abs(s - midi) < Math.abs(best - midi)) best = s;
  return best;
}

console.log('── Salamander → app ─────────────────────────────────');
console.log(`Input:           ${inputDir}`);
console.log(`Output:          ${OUT_DIR}`);
console.log(`Campioni trovati: ${sources.size} note, layer disponibili: ${availableLayers.join(',')}`);
console.log(`Layer scelti (${LAYERS}): ${chosenLayers.join(',')} → v0..v${LAYERS - 1}`);
console.log(`Note da generare: ${TARGETS.length} × ${LAYERS} = ${TARGETS.length * LAYERS} file mp3`);

if (DRY_RUN) {
  console.log('\n[--dry-run] anteprima mappatura (prime 6 note):');
  for (const midi of TARGETS.slice(0, 6)) {
    const src = nearestSampled(midi);
    console.log(`  ${midiToFileName(midi)}  ←  ${midiToFileName(src)} ${src === midi ? '(diretto)' : `(shift ${midi - src > 0 ? '+' : ''}${midi - src} st)`}`);
  }
  console.log('\nNessun file scritto (dry-run). Rilancia senza --dry-run per generare.');
  process.exit(0);
}

// ── verifica dipendenze ───────────────────────────────────────────────────────
function checkTool(cmd, versionArg) {
  try { execFileSync(cmd, [versionArg], { stdio: 'ignore' }); return true; }
  catch { return false; }
}
if (!checkTool('ffmpeg', '-version')) { console.error('ffmpeg non trovato. Su Mac:  brew install ffmpeg'); process.exit(1); }
if (!checkTool('sox', '--version'))   { console.error('sox non trovato. Su Mac:  brew install sox'); process.exit(1); }

// ── 3+4. genera ───────────────────────────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true });
const tmp = join(tmpdir(), 'salamander-prep');
mkdirSync(tmp, { recursive: true });

let done = 0, skipped = 0;
for (const midi of TARGETS) {
  const src = nearestSampled(midi);
  const offset = midi - src; // semitoni
  for (let out = 0; out < LAYERS; out++) {
    const srcLayer = chosenLayers[out];
    const srcFile = sources.get(src)?.get(srcLayer);
    if (!srcFile) { skipped++; continue; }
    const outFile = join(OUT_DIR, `${midiToFileName(midi)}_v${out}.mp3`);

    let toEncode = srcFile;
    let tmpWav = null;
    if (offset !== 0) {
      tmpWav = join(tmp, `s_${midi}_${out}.wav`);
      // Resampling (sox speed): preserva il TRANSIENTE d'attacco netto (a differenza
      // di "pitch" che lo spalma). La nota trasposta dura ~6% in più/meno per ±1
      // semitono — impercettibile, e l'attacco resta pulito.
      const speedFactor = Math.pow(2, offset / 12);
      execFileSync('sox', [srcFile, tmpWav, 'speed', speedFactor.toFixed(6), 'rate', '48000'], { stdio: 'ignore' });
      toEncode = tmpWav;
    }
    // mp3 stereo, VBR ~q3 (~175 kbps) — compatibile con decodeAudioData
    execFileSync('ffmpeg', ['-y', '-i', toEncode, '-ac', '2', '-c:a', 'libmp3lame', '-q:a', '3', outFile], { stdio: 'ignore' });
    if (tmpWav) rmSync(tmpWav, { force: true });
    done++;
    if (done % 50 === 0) console.log(`  ...${done}/${TARGETS.length * LAYERS}`);
  }
}

// manifest (utile per debug / attribuzione)
writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify({
  source: 'Salamander Grand Piano V3 — Alexander Holm, CC-BY 3.0',
  layers: LAYERS,
  chosenLayers,
  format: 'mp3 stereo VBR ~q3 (~175 kbps)',
  generated: new Date().toISOString(),
}, null, 2));

console.log(`\nFatto: ${done} file generati${skipped ? `, ${skipped} saltati (layer mancante)` : ''}.`);
console.log(`In: ${OUT_DIR}`);
console.log('Ricarica l\'app: il pianoforte userà automaticamente i nuovi campioni.');
