#!/usr/bin/env python3
"""
_make_loop.py — costruisce un campione tenuto LOOPABILE da un render grezzo.

1. trova loopEnd per cross-correlazione → la coda combacia IN FASE con l'inizio
   del loop (niente click);
2. pareggia il LIVELLO: rampa di guadagno lenta sul corpo così che il livello a
   loopEnd = livello a loopStart (niente gradino di volume tra le ripetizioni);
3. crossfade corto che atterra su render[loopStart].

File risultante = render[0..loopEnd]; il motore lo riproduce con loop [loopStart..fine].

Uso: _make_loop.py <in.wav> <out.wav> <loopStartSec> <Lmin> <Lmax> <xfadeSec> [previewWav] [nLoops]
"""
import sys, wave, array, math

inp, outp = sys.argv[1], sys.argv[2]
S_sec, Lmin, Lmax, XF = map(float, sys.argv[3:7])
preview = sys.argv[7] if len(sys.argv) > 7 else None
nloops = int(sys.argv[8]) if len(sys.argv) > 8 else 5

w = wave.open(inp, 'rb')
sr, ch, sw, n = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
data = array.array('h'); data.frombytes(w.readframes(n)); w.close()
chans = [data[c::ch] for c in range(ch)]
mono = chans[0] if ch == 1 else array.array('i', (chans[0][i] + chans[1][i] for i in range(len(chans[0]))))
N = len(mono)

S = int(round(S_sec * sr))
# Il difetto udibile sugli archi in loop è DOPPIO e va trattato separatamente:
#   1. CLICK    = discontinuità della fondamentale → serve fase fondamentale uguale
#                 a loopStart (finestra corta Wc, pochi periodi).
#   2. GRADINO  = mismatch dell'INVILUPPO del vibrato (AM ~5-6 Hz): loopEnd deve
#                 cadere allo STESSO punto del ciclo di vibrato di loopStart, cioè
#                 stesso valore d'inviluppo E stessa pendenza (sale/scende uguale).
We = max(1, int(0.030 * sr))      # finestra inviluppo AM (> periodo fondamentale, < periodo vibrato)
Wc = max(2, int(0.012 * sr))      # finestra correlazione fondamentale (declick)
dlt = max(1, int(0.025 * sr))     # passo per la pendenza dell'inviluppo (fase vibrato)
Wl = int(0.10 * sr)               # finestra livello per la rampa di pareggio: UGUALE alla
                                  # finestra di giudizio del seam, così la rampa annulla la
                                  # deriva di decadimento proprio dove si percepisce il gradino
emin = S + int(Lmin * sr)
emax = min(N - 1, S + int(Lmax * sr))

# RMS O(1) via somma-prefissi dei quadrati (la ricerca fine itera migliaia di punti)
P = [0.0] * (N + 1); acc = 0.0
for i in range(N): acc += float(mono[i]) * mono[i]; P[i + 1] = acc
def rms(lo, hi):
    lo = max(0, lo); hi = min(N, hi)
    return math.sqrt((P[hi] - P[lo]) / (hi - lo)) if hi > lo else 0.0
def env(t): return rms(t - We // 2, t + We // 2)   # ampiezza istantanea (inviluppo vibrato)

refc = mono[S - Wc:S]
refc_e = sum(x * x for x in refc) or 1
envS = env(S) or 1.0
slopeS = env(S + dlt) - env(S - dlt)   # fase del vibrato a loopStart (segno = sale/scende)
levelS = rms(S, S + Wl) or 1.0         # livello medio all'inizio del loop (per la rampa)

steady = abs(slopeS) < 0.03 * envS   # nota quasi ferma: il vibrato non è informativo
def score(e):
    # (2) stessa ampiezza di vibrato e stessa fase (no gradino di volume)
    lvl = math.exp(-3.0 * abs(env(e) - envS) / envS)
    if steady:
        phase = 1.0   # niente vibrato → la fase è rumore: non penalizzare, lascia decidere la fondamentale
    else:
        slopeE = env(e + dlt) - env(e - dlt)
        phase = 0.5 + 0.5 * (slopeS * slopeE) / (abs(slopeS) * abs(slopeE) + 1e-9)  # 1 stessa fase, 0 opposta
    # (1) fondamentale in fase (no click) — su note ferme è il criterio dominante
    seg = mono[e - Wc:e]; dot = 0; en = 0
    for i in range(Wc):
        a = seg[i]; dot += a * refc[i]; en += a * a
    corr = max(0.0, dot / math.sqrt((en or 1) * refc_e))
    return (lvl * lvl) * (0.4 + 0.6 * phase) * (0.2 + 0.8 * corr)

# ricerca grossolana (5 ms) + fine (campione)
best_e, best = emin, -2.0
e = emin; step = int(0.005 * sr)
while e <= emax:
    s = score(e)
    if s > best: best, best_e = s, e
    e += step
for e in range(max(emin, best_e - step), min(emax, best_e + step) + 1):
    s = score(e)
    if s > best: best, best_e = s, e
E = best_e

# pareggio livello: rampa di guadagno lenta su [S..E] così livello(E)=livello(S)
levelE = rms(E - Wl, E) or levelS
gEnd = levelS / levelE
out = [array.array('h', chans[c][:E]) for c in range(ch)]
for c in range(ch):
    src = chans[c]
    for pos in range(S, E):
        g = 1.0 + (gEnd - 1.0) * (pos - S) / (E - S)
        out[c][pos] = max(-32768, min(32767, int(src[pos] * g)))

# crossfade coda corto: out[E-Xs..E] atterra su render[S] (half-sine)
Xs = int(XF * sr)
for c in range(ch):
    src = chans[c]
    for k in range(Xs):
        pos = E - Xs + k; g = (k + 1) / Xs
        fout = math.cos(g * math.pi / 2); fin = math.sin(g * math.pi / 2)
        out[c][pos] = max(-32768, min(32767, int(out[c][pos] * fout + src[S - Xs + k] * fin)))

def write(path, length, builder):
    inter = array.array('h', bytes(2 * length * ch))
    for c in range(ch): inter[c::ch] = builder(c)
    ww = wave.open(path, 'wb'); ww.setnchannels(ch); ww.setsampwidth(2); ww.setframerate(sr)
    ww.writeframes(inter.tobytes()); ww.close()

write(outp, E, lambda c: out[c])

# preview sample-accurate = attacco[0..S] + corpo[S..E] × nloops (= comportamento motore)
if preview:
    body = [out[c][S:E] for c in range(ch)]
    plen = S + (E - S) * nloops
    def pbuild(c):
        a = array.array('h', out[c][:S])
        for _ in range(nloops): a.extend(body[c])
        return a
    write(preview, plen, pbuild)

print(f'loopEnd={E/sr:.3f}s loopLen={(E-S)/sr:.3f}s corr*lvl={best:.3f} levelStepFix={20*math.log10(gEnd):+.1f}dB')
