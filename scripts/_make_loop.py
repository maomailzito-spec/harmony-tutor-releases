#!/usr/bin/env python3
"""
_make_loop.py — rende una nota tenuta con LOOP IN CODA ("alla sampler serio").

Si tiene il campione NATURALE quasi per intero (fino a capSec) e si mette il loop
solo nella PARTE FINALE. Così le note di durata normale (≤ durata del file)
suonano naturali, SENZA loop né giunta; solo le tenute estreme entrano nel loop
[loopStart .. fine]. È il motivo per cui i sampler veri non hanno "stacchi" sulle
note comuni: non loopano affatto finché la nota non supera il campione.

- loopStart = loopStartSec (fisso, oltre lo swell d'attacco): dove la nota torna
  quando è tenuta PIÙ del file.
- loopEnd = fine del file: scelta vicino al cap / alla fine utile del campione, nel
  punto che meglio si aggancia in fase a loopStart (declick del wrap) e di vibrato.
- rampa di livello SOLO sull'ultimo tratto (non tocca il corpo naturale) + crossfade
  corto allineato → il raro wrap è pulito.

Uso: _make_loop.py <in.wav> <out.wav> <loopStartSec> <capSec> <xfadeSec> [previewWav] [nLoops]
"""
import sys, wave, array, math

inp, outp = sys.argv[1], sys.argv[2]
S_sec, CAP, XF = map(float, sys.argv[3:6])
preview = sys.argv[6] if len(sys.argv) > 6 else None
nloops = int(sys.argv[7]) if len(sys.argv) > 7 else 5

w = wave.open(inp, 'rb')
sr, ch, sw, n = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
data = array.array('h'); data.frombytes(w.readframes(n)); w.close()
chans = [data[c::ch] for c in range(ch)]
mono = chans[0] if ch == 1 else array.array('i', (chans[0][i] + chans[1][i] for i in range(len(chans[0]))))
N = len(mono)

# ── modalità ONE-SHOT (loopStartSec < 0): strumenti che DECADONO (piano, pizzicato,
# percussioni) → nessun loop. Si tiene il decadimento naturale, si taglia il silenzio
# finale (cap a capSec) con un fade-out corto al taglio. ──
if S_sec < 0:
    bl = int(0.02 * sr)
    def rms0(lo, hi):
        lo = max(0, lo); hi = min(N, hi); s = mono[lo:hi]
        return math.sqrt(sum(x * x for x in s) / max(1, hi - lo))
    peak = max((rms0(t, t + bl) for t in range(0, min(N, int(1.0 * sr)), bl)), default=1) or 1
    thr = peak * 0.0025                       # ~ −52 dB sotto il picco = "silenzio"
    end = min(N, int(CAP * sr)); t = end
    while t > int(0.2 * sr) and rms0(t - bl, t) < thr: t -= bl
    end = min(min(N, int(CAP * sr)), t + bl)
    fo = min(int(0.05 * sr), end)
    out = [array.array('h', chans[c][:end]) for c in range(ch)]
    for c in range(ch):
        for k in range(fo):
            out[c][end - 1 - k] = int(out[c][end - 1 - k] * (k + 1) / fo)
    inter = array.array('h', bytes(2 * end * ch))
    for c in range(ch): inter[c::ch] = out[c]
    ww = wave.open(outp, 'wb'); ww.setnchannels(ch); ww.setsampwidth(2); ww.setframerate(sr)
    ww.writeframes(inter.tobytes()); ww.close()
    print(f'one-shot len={end / sr:.3f}s (no loop)')
    sys.exit(0)

S = int(round(S_sec * sr))
Xs = int(XF * sr)
Wc = max(int(0.012 * sr), Xs)   # correlazione fondamentale = lunghezza crossfade (allinea ciò che si fonde)
We = max(1, int(0.030 * sr))    # inviluppo AM (fase vibrato)
dlt = max(1, int(0.025 * sr))
Wl = int(0.10 * sr)

# RMS O(1) via somma-prefissi dei quadrati
P = [0.0] * (N + 1); acc = 0.0
for i in range(N): acc += float(mono[i]) * mono[i]; P[i + 1] = acc
def rms(lo, hi):
    lo = max(0, lo); hi = min(N, hi)
    return math.sqrt((P[hi] - P[lo]) / (hi - lo)) if hi > lo else 0.0
def env(t): return rms(t - We // 2, t + We // 2)

bodyLevel = rms(S, S + int(1.0 * sr)) or 1.0

# Fine UTILE del campione: ultimo punto (≤ cap) ancora "in suono", prima del
# rilascio/decadimento/silenzio (per i campioni più corti del cap).
capN = min(N - 1, int(CAP * sr))
thr = 0.4 * bodyLevel
U = capN; t = capN; stepd = int(0.02 * sr)
while t > S + int(1.5 * sr):
    if rms(t - int(0.05 * sr), t) >= thr: U = t; break
    t -= stepd
U = max(S + int(1.5 * sr), U - int(0.08 * sr))   # margine dal bordo

# Cerca loopEnd E in una finestra vicino a U: aggancio di fase fondamentale (declick
# del wrap) + stessa fase di vibrato di loopStart. Il loop [S..E] è lungo → il wrap
# capita di rado (solo note tenute oltre il file).
refc = mono[S - Wc:S]; refc_e = sum(x * x for x in refc) or 1
envS = env(S) or 1.0
slopeS = env(S + dlt) - env(S - dlt)
steady = abs(slopeS) < 0.03 * envS
win = min(int(3.0 * sr), int((U - S) * 0.6))   # finestra ampia: cerca il MIGLIOR aggancio di
emin = max(S + int(2.0 * sr), U - win); emax = U  # fase a S (giunzione pulita), anche un po' prima di U
def score(e):
    lvl = math.exp(-3.0 * abs(env(e) - envS) / envS)
    if steady:
        phase = 1.0
    else:
        se = env(e + dlt) - env(e - dlt)
        phase = 0.5 + 0.5 * (slopeS * se) / (abs(slopeS) * abs(se) + 1e-9)
    seg = mono[e - Wc:e]; dot = 0; en = 0
    for i in range(Wc):
        a = seg[i]; dot += a * refc[i]; en += a * a
    corr = max(0.0, dot / math.sqrt((en or 1) * refc_e))
    return lvl * (0.4 + 0.6 * phase) * (0.3 + 0.7 * corr)

best_e, best = emin, -1.0
e = emin; step = int(0.005 * sr)
while e <= emax:
    s = score(e)
    if s > best: best, best_e = s, e
    e += step
for e in range(max(emin, best_e - step), min(emax, best_e + step) + 1):
    s = score(e)
    if s > best: best, best_e = s, e
E = best_e

out = [array.array('h', chans[c][:E]) for c in range(ch)]
# Rampa di livello SOLO sull'ultimo tratto: porta livello(E)→livello(S) per il wrap,
# senza toccare il corpo naturale (le note ≤ file mantengono l'inviluppo reale).
levelE = rms(E - Wl, E) or bodyLevel
levelS = rms(S, S + Wl) or bodyLevel
target = levelS / levelE
rampN = min(int(0.6 * sr), (E - S) // 2)
for c in range(ch):
    for k in range(rampN):
        pos = E - rampN + k
        g = 1.0 + (target - 1.0) * (k / rampN)
        out[c][pos] = max(-32768, min(32767, int(out[c][pos] * g)))
# Crossfade coda corto: out[E-Xs..E] atterra su render[S-Xs..S] (wrap continuo a S).
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

# preview = comportamento motore: naturale [0..E], poi loop [S..E] × nloops
if preview:
    body = [out[c][S:E] for c in range(ch)]
    plen = E + (E - S) * nloops
    def pb(c):
        a = array.array('h', out[c][:E])
        for _ in range(nloops): a.extend(body[c])
        return a
    write(preview, plen, pb)

print(f'loopStart={S/sr:.3f}s loopEnd={E/sr:.3f}s loopLen={(E-S)/sr:.3f}s fileLen={E/sr:.3f}s')
