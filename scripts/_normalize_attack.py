#!/usr/bin/env python3
"""
_normalize_attack.py — uniforma la LOUDNESS D'ATTACCO dei campioni one-shot
(pizzicato/percussivi) di una cartella, così tutte le note suonano allo stesso
livello PERCEPITO (non solo stesso picco). Necessario per i bassi: la sola
normalizzazione di picco lasciava il corpo/attacco disomogeneo (gli acuti
pitch-shiftati "sparivano").

Per ogni FLAC misura l'RMS dei primi `win` s (l'attacco = ciò che si sente su
note brevi) e applica un guadagno costante per portarlo a `target` dBFS.
- target di DEFAULT = il MINIMO attacco della cartella → solo RIDUZIONI:
  niente clipping, niente limiter, tutte le note al livello della più debole
  (il livello complessivo si ripristina con INSTRUMENT_GAIN nel motore).
- se passi un `target` esplicito, il boost viene comunque LIMITATO così il picco
  non supera -1 dBFS (clip-safe).

Uso: _normalize_attack.py <cartella> [targetDB] [winSec=0.25]
Idempotente con default (auto-min): rilanciarlo non cambia nulla.
"""
import sys, os, glob, re, subprocess

folder = sys.argv[1]
target_arg = float(sys.argv[2]) if len(sys.argv) > 2 else None
# win=0 → misura l'INTERA nota (come Logic Loudness, gated). >0 → solo i primi `win` s.
win = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0
SR = 44100

def _peak(path):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-i', path, '-af', 'volumedetect', '-f', 'null', '-'],
                       capture_output=True, text=True)
    m = re.search(r'max_volume:\s*(-?[\d.]+)', r.stderr or '')
    return float(m.group(1)) if m else None

def _kloud(path):
    # Loudness integrata gated (BS.1770, come "Loudness" in Logic e come la loudness
    # percepita): misura l'INTERA nota — il gating esclude la coda silenziosa, così
    # conta solo la parte udibile. È il metro che corrisponde all'orecchio.
    args = ['ffmpeg', '-hide_banner']
    if win and win > 0:
        args += ['-t', str(win)]   # opzionale: limita alla finestra iniziale
    args += ['-i', path, '-af', 'loudnorm=print_format=json', '-f', 'null', '-']
    r = subprocess.run(args, capture_output=True, text=True)
    m = re.search(r'"input_i"\s*:\s*"(-?[\d.]+)"', r.stderr or '')
    return float(m.group(1)) if m else None

def measure(path):
    """(loudness integrata gated dell'intera nota, peak dBFS dell'intero file)."""
    return _kloud(path), _peak(path)

files = sorted(glob.glob(os.path.join(folder, '*.flac')))
if not files:
    print(f'nessun FLAC in {folder}'); sys.exit(1)

meas = {f: measure(f) for f in files}
meas = {f: m for f, m in meas.items() if m[0] is not None}
target = target_arg if target_arg is not None else min(m[0] for m in meas.values())

print(f'── normalize-attack: {folder}  target={target:.1f} dB ({"auto-min" if target_arg is None else "fisso"})  win={win}s ──')
for f in files:
    rms_db, pk_db = meas.get(f, (None, None))
    if rms_db is None:
        print(f'  {os.path.basename(f)}: vuoto, salto'); continue
    gain = target - rms_db
    cap = -1.0 - pk_db            # boost massimo che tiene il picco ≤ -1 dBFS
    if gain > cap:
        gain = cap
    tmp = f + '.tmp.flac'
    subprocess.run(
        ['ffmpeg', '-y', '-v', 'quiet', '-i', f,
         '-af', f'volume={gain:.2f}dB', '-ar', str(SR), '-c:a', 'flac', tmp],
        check=True)
    os.replace(tmp, f)
    print(f'  {os.path.basename(f):8s} attacco {rms_db:6.1f} pk {pk_db:5.1f} -> gain {gain:+.1f} dB')
print('fatto.')
