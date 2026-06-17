/**
 * prepare-orchestra.mjs — Fase 1 (SPEC A): genera i campioni FLAC LOOPABILI di
 * UNO strumento orchestrale tenuto, da una libreria SFZ (VSCO2 CE), via sfizz.
 *
 * Catena per nota:
 *   1. MIDI di 1 nota tenuta  →  sfizz_render (--sfz … --midi … --wav)  → WAV
 *   2. costruzione "attacco + corpo-loop crossfadato" (sox)  [loop seamless]
 *   3. normalizzazione LUFS (ffmpeg loudnorm)
 *   4. encode FLAC  →  public/sounds/{instrument}/{Nota}{Ottava}.flac  (in-place)
 *
 * I FLAC sono ATTACCO + CORPO; il motore (AudioService.SUSTAINED) li riproduce
 * con source.loop su [loopStartSec .. fine] = attacco .. fine → tenuta infinita.
 *
 * Uso:
 *   node scripts/prepare-orchestra.mjs            # default: violini ens → string_ensemble_1
 *   node scripts/prepare-orchestra.mjs --sfz <path.sfz> --out <instrumentKey> \
 *        --lo 55 --hi 86 [--dry-run] [--only 69]
 *
 * Requisiti: sfizz_render in ~/.local/sfizz, + ffmpeg + sox (Homebrew).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, homedir } from 'node:os';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const has = (name) => args.includes(`--${name}`);

// ── parametri ────────────────────────────────────────────────────────────────
const SFZ = resolve(opt('sfz', '/Users/Erminio/Desktop/VSCO-2-CE-SFZ/ViolinEnsSusVib.sfz'));
const INSTRUMENT = opt('out', 'string_ensemble_1');
const LO = parseInt(opt('lo', '55'), 10);   // G3
const HI = parseInt(opt('hi', '86'), 10);   // D6
const ONLY = opt('only', null);             // render una sola nota (debug)
const DRY = has('dry-run');

const OUT_DIR = resolve(scriptDir, '..', 'public', 'sounds', INSTRUMENT);
const TOOL = join(homedir(), '.local', 'sfizz');
const SFIZZ = join(TOOL, 'bin', 'sfizz_render');
const DYLD = join(TOOL, 'lib');

// ── parametri timbro/loop (tarabili al gate d'ascolto) ───────────────────────
const VEL = parseInt(opt('vel', '100'), 10);   // velocity MIDI del render (sceglie il layer della sorgente)
// loopStart DEVE cadere DOPO lo swell d'attacco, in zona stazionaria. Il file tiene
// il campione naturale fino a ~CAP; il loop è solo in coda → note normali non loopano.
const ATTACK = parseFloat(opt('attack', '1.00'));    // = SUSTAINED.loopStartSec nel motore (S): dove la nota torna se tenuta oltre il file
const CAP = parseFloat(opt('cap', '8.00'));          // lunghezza max del file: le note ≤ CAP suonano NATURALI (nessun loop)
const XFADE = parseFloat(opt('xfade', '0.05'));      // crossfade del raro wrap di coda
const NOLOOP = has('no-loop');                       // strumenti che decadono (piano, pizzicato, percussioni): nessun loop
const LUFS = parseFloat(opt('lufs', '-18'));         // target integrated loudness
const SR = 44100;
// Tenere la nota oltre il cap così a CAP siamo ancora in sustain pieno (campioni lunghi).
const HOLD_SEC = CAP + 2.0;

const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const midiToName = (m) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

// ── MIDI a 1 nota (format 0) ─────────────────────────────────────────────────
const vlq = (n) => { const b = [n & 0x7f]; n >>= 7; while (n) { b.unshift((n & 0x7f) | 0x80); n >>= 7; } return Buffer.from(b); };
function writeOneNoteMidi(path, note, secs) {
  const ppq = 480, ticks = Math.round((secs / 0.5) * ppq); // 120bpm
  const ev = Buffer.concat([
    vlq(0), Buffer.from([0xFF, 0x51, 0x03, 0x07, 0xA1, 0x20]), // tempo 500000
    vlq(0), Buffer.from([0x90, note, VEL]),                    // note on
    vlq(ticks), Buffer.from([0x80, note, 0]),                  // note off
    vlq(0), Buffer.from([0xFF, 0x2F, 0x00]),                   // EOT
  ]);
  const head = Buffer.alloc(14);
  head.write('MThd'); head.writeUInt32BE(6, 4); head.writeUInt16BE(0, 8); head.writeUInt16BE(1, 10); head.writeUInt16BE(ppq, 12);
  const trkHead = Buffer.alloc(8); trkHead.write('MTrk'); trkHead.writeUInt32BE(ev.length, 4);
  writeFileSync(path, Buffer.concat([head, trkHead, ev]));
}

const run = (cmd, a, env) => execFileSync(cmd, a, { stdio: 'ignore', env: { ...process.env, ...(env || {}) } });
const sox = (a) => run('sox', a);

/** Misura integrated loudness + true peak (loudnorm pass 1, JSON su stderr).
 *  Normalizziamo poi con GUADAGNO COSTANTE (volume) per non rompere il loop:
 *  loudnorm dinamico varierebbe il livello nel tempo → re-introduce il gradino. */
function measureLoudness(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', `loudnorm=I=${LUFS}:TP=-1.5:LRA=11:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
  const txt = r.stderr || '';
  const i = txt.match(/"input_i"\s*:\s*"?(-?[\d.]+)"?/);
  const tp = txt.match(/"input_tp"\s*:\s*"?(-?[\d.]+)"?/);
  return { i: i ? parseFloat(i[1]) : null, tp: tp ? parseFloat(tp[1]) : null };
}

// ── verifica strumenti ───────────────────────────────────────────────────────
for (const [name, path] of [['sfizz_render', SFIZZ]]) if (!existsSync(path)) { console.error(`${name} non trovato in ${path}`); process.exit(1); }
const verFlag = { ffmpeg: '-version', sox: '--version' };
for (const t of ['ffmpeg', 'sox']) { try { execFileSync(t, [verFlag[t]], { stdio: 'ignore' }); } catch { console.error(`${t} non trovato`); process.exit(1); } }

const targets = ONLY ? [parseInt(ONLY, 10)] : Array.from({ length: HI - LO + 1 }, (_, i) => LO + i);
console.log(`── prepare-orchestra (Fase 1) ──────────────────────`);
console.log(`SFZ:        ${SFZ}`);
console.log(`Strumento:  ${INSTRUMENT}  →  ${OUT_DIR}`);
console.log(`Range:      ${midiToName(LO)}..${midiToName(HI)} (${targets.length} note)`);
console.log(`File:       naturale fino a ~${CAP}s + loop in coda da ${ATTACK}s (xfade ${XFADE}s) · LUFS ${LUFS} · FLAC`);
if (DRY) { console.log('\n[--dry-run] nessun file scritto.'); process.exit(0); }

mkdirSync(OUT_DIR, { recursive: true });
const tmp = join(tmpdir(), 'orchestra-prep'); mkdirSync(tmp, { recursive: true });

let done = 0, failed = 0;
for (const midi of targets) {
  const name = midiToName(midi);
  const mid = join(tmp, `n.mid`);
  const raw = join(tmp, `raw.wav`);
  try {
    writeOneNoteMidi(mid, midi, HOLD_SEC);
    run(SFIZZ, ['--sfz', SFZ, '--midi', mid, '--wav', raw, '-s', String(SR)], { DYLD_FALLBACK_LIBRARY_PATH: DYLD });

    // Loop-finder per cross-correlazione: trova loopEnd dove la coda combacia
    // IN FASE con l'inizio del loop (niente cancellazione/gradino), poi crossfade
    // corto che atterra su render[S]. File = render[0..loopEnd]; motore: loop
    // [S .. fine]. loopStart costante = ATTACK; loopEnd = durata file.
    const built = join(tmp, 'built.wav');
    const normd = join(tmp, 'norm.wav');
    const outFlac = join(OUT_DIR, `${name}.flac`);
    run('python3', [join(scriptDir, '_make_loop.py'), raw, built, NOLOOP ? '-1' : String(ATTACK), String(CAP), String(XFADE)]);

    // Normalizzazione LUFS con guadagno COSTANTE (loop-safe): misura → volume.
    const m = measureLoudness(built);
    let gainDb = (m.i != null) ? (LUFS - m.i) : 0;
    if (m.tp != null) gainDb = Math.min(gainDb, -1.0 - m.tp); // evita clipping (TP ≤ -1 dBTP)
    run('ffmpeg', ['-y', '-i', built, '-af', `volume=${gainDb.toFixed(2)}dB`, '-ar', String(SR), normd]);
    run('ffmpeg', ['-y', '-i', normd, '-c:a', 'flac', outFlac]);
    done++;
    if (done % 8 === 0) console.log(`  ...${done}/${targets.length}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name} (midi ${midi}): ${String(e.message || e).split('\n')[0]}`);
  }
}
rmSync(tmp, { recursive: true, force: true });
console.log(`\nFatto: ${done} FLAC in ${OUT_DIR}${failed ? `, ${failed} falliti` : ''}.`);
console.log(`Motore: SUSTAINED['${INSTRUMENT}'] = { loopStartSec: ${ATTACK}, ext: 'flac' } (già impostato per string_ensemble_1).`);
