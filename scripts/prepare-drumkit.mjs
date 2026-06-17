/**
 * prepare-drumkit.mjs — genera il KIT ROCK (Salamander Drumkit, CC BY-SA, Alexander Holm)
 * come FLAC one-shot, nominati per nota GM standard, in public/sounds/drumkit/.
 *
 * La Salamander usa una mappatura tasti tutta sua (≠ GM): qui scegliamo UN campione
 * rappresentativo per pezzo e lo salviamo col nome della nota GM corrispondente, così
 * app + MIDI-out restano GM-coerenti (come il kit orchestrale 'drums').
 *
 * Per ogni pezzo: prendi il WAV (1° round-robin) → ripulisci il silenzio iniziale
 * (i sample originali hanno latenza) → mono 44.1k → cap 6s + fade per i piatti lunghi
 * → normalizza il PICCO a -6 dBFS (tutti udibili/omogenei) → FLAC.
 *
 * Uso:  node scripts/prepare-drumkit.mjs [--src <OHdir>] [--peak -6] [--dry-run]
 * Requisiti: ffmpeg + ffprobe.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(`--${n}`);

const SRC = resolve(opt('src', join(homedir(), 'Desktop', 'salamanderDrumkit', 'OH')));
const PEAK = parseFloat(opt('peak', '-6'));     // picco target dBFS
const CAP = parseFloat(opt('cap', '6'));        // durata max (piatti lunghi)
const FADE = 0.25;                              // fade-out finale quando si taglia
const DRY = has('dry-run');
const OUT_DIR = resolve(scriptDir, '..', 'public', 'sounds', 'drumkit');

const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const midiToName = (m) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

// GM ← sorgente Salamander (prefisso del file, senza l'indice round-robin _1).
const MAP = [
  { gm: 36, src: 'kick2_OH_F',       label: 'Cassa' },
  { gm: 38, src: 'snare_OH_F',       label: 'Rullante' },
  { gm: 37, src: 'snareStick_OH_F',  label: 'Rimshot' },
  { gm: 42, src: 'hihatClosed_OH_F', label: 'Charleston chiuso' },
  { gm: 44, src: 'hihatFoot_OH_MP',  label: 'Charleston pedale' },
  { gm: 46, src: 'hihatOpen_OH_F',   label: 'Charleston aperto' },
  { gm: 50, src: 'hiTom_OH_F',       label: 'Tom alto' },
  { gm: 45, src: 'loTom_OH_FF',      label: 'Tom basso' },
  { gm: 49, src: 'crash1_OH_FF',     label: 'Crash' },
  { gm: 51, src: 'ride1_OH_MP',      label: 'Ride' },
  { gm: 53, src: 'ride1Bell_OH_F',   label: 'Campana ride' },
  { gm: 52, src: 'china1_OH_FF',     label: 'China' },
  { gm: 55, src: 'splash1_OH_F',     label: 'Splash' },
  { gm: 56, src: 'cowbell_MP',       label: 'Cowbell' },
];

const run = (cmd, a) => execFileSync(cmd, a, { stdio: 'ignore' });
function probeDuration(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return parseFloat((r.stdout || '0').trim()) || 0;
}
function measurePeak(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = (r.stderr || '').match(/max_volume:\s*(-?[\d.]+)\s*dB/);
  return m ? parseFloat(m[1]) : null;
}

for (const t of ['ffmpeg', 'ffprobe']) { try { execFileSync(t, ['-version'], { stdio: 'ignore' }); } catch { console.error(`${t} non trovato`); process.exit(1); } }
if (!existsSync(SRC)) { console.error(`Cartella campioni non trovata: ${SRC}`); process.exit(1); }

console.log(`── prepare-drumkit (kit ROCK Salamander) ──`);
console.log(`Sorgente:  ${SRC}`);
console.log(`Output:    ${OUT_DIR}  ·  picco ${PEAK} dBFS · mono 44.1k · cap ${CAP}s`);
if (DRY) { console.log('[--dry-run]'); }
mkdirSync(OUT_DIR, { recursive: true });
const tmp = join(scriptDir, '.drumkit-tmp'); mkdirSync(tmp, { recursive: true });

let done = 0, failed = 0;
for (const { gm, src, label } of MAP) {
  const inWav = join(SRC, `${src}_1.wav`);
  const name = midiToName(gm);
  const outFlac = join(OUT_DIR, `${name}.flac`);
  if (!existsSync(inWav)) { console.error(`  ✗ ${label} (GM ${gm}): manca ${src}_1.wav`); failed++; continue; }
  if (DRY) { console.log(`  ${name}.flac  ← ${src}_1.wav  (${label})`); done++; continue; }
  try {
    // 1) ripulisci silenzio iniziale + mono 44.1k
    const stg = join(tmp, 'stg.wav');
    run('ffmpeg', ['-y', '-i', inWav, '-af', 'silenceremove=start_periods=1:start_threshold=-50dB,aformat=channel_layouts=mono', '-ar', '44100', stg]);
    // 2) cap + fade + normalizzazione di picco → FLAC
    const dur = Math.min(probeDuration(stg), CAP);
    const peak = measurePeak(stg);
    const gainDb = (peak != null) ? (PEAK - peak) : 0;
    const fadeSt = Math.max(0, dur - FADE);
    run('ffmpeg', ['-y', '-i', stg, '-t', dur.toFixed(3), '-af', `afade=t=out:st=${fadeSt.toFixed(3)}:d=${FADE},volume=${gainDb.toFixed(2)}dB`, '-ar', '44100', '-c:a', 'flac', outFlac]);
    console.log(`  ✓ ${name}.flac  ← ${src}  (${label})  peak ${peak}→${PEAK} dB`);
    done++;
  } catch (e) {
    console.error(`  ✗ ${label} (GM ${gm}): ${String(e.message || e).split('\n')[0]}`);
    failed++;
  }
}
console.log(`\nFatto: ${done} FLAC in ${OUT_DIR}${failed ? `, ${failed} falliti` : ''}.`);
console.log(`Credito (CC BY-SA): Salamander Drumkit — Alexander Holm.`);
