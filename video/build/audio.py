# Monta a trilha do vídeo: narração + efeitos sonoros + música de fundo (tudo gerado aqui).
# uso: python3 audio.py   (depois de timeline.py e render.mjs)
import json, re, subprocess, wave, pathlib
import numpy as np

here = pathlib.Path(__file__).parent
SR = 44100
rng = np.random.default_rng(7)
TL = json.loads(re.search(r"window\.TL=(.*);", (here.parent / "timeline.js").read_text(encoding="utf-8")).group(1))
SFX = json.loads((here / "sfx.json").read_text())
N = int((TL["dur"] + .5) * SR)
tt = lambda d: np.arange(int(d * SR)) / SR


def load(path, filtro):
    raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(path), "-af", filtro,
                                   "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"])
    return np.frombuffer(raw, np.float32).copy()


def add(buf, sig, t, g=1.0):
    i = int(t * SR)
    if i >= len(buf): return
    sig = sig[: len(buf) - i]
    buf[i:i + len(sig)] += sig * g


def lowpass(x, a):  # filtro simples de um polo (a pode variar no tempo)
    y = np.zeros_like(x); acc = 0.0
    a = np.broadcast_to(a, x.shape)
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc); y[i] = acc
    return y


# ---------- efeitos ----------
def s_key():
    t = tt(.035); n = rng.standard_normal(len(t))
    n = np.diff(n, prepend=0) * np.exp(-t * 180)
    return n * .5 * rng.uniform(.6, 1)

def s_click():
    def tick(f):
        t = tt(.02); return (np.sin(2 * np.pi * f * t) * .6 + np.diff(rng.standard_normal(len(t)), prepend=0) * .4) * np.exp(-t * 400)
    out = np.zeros(int(.1 * SR)); out[:len(tick(3200))] += tick(3200)
    j = int(.055 * SR); u = tick(2600) * .7; out[j:j + len(u)] += u
    return out

def s_whoosh():
    t = tt(.55); n = rng.standard_normal(len(t))
    env = np.sin(np.pi * t / t[-1]) ** 2
    a = .02 + .25 * env
    return lowpass(n, a) * env * 2.2

def s_pop():
    t = tt(.16); f = 520 + 700 * (1 - np.exp(-t * 40))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 28)

def s_ding():
    t = tt(1.0)
    return (np.sin(2 * np.pi * 1318.5 * t) + .5 * np.sin(2 * np.pi * 1975.5 * t) + .25 * np.sin(2 * np.pi * 2637 * t)) * np.exp(-t * 5) * .5

def s_impact():
    t = tt(.7); f = 40 + 90 * np.exp(-t * 18)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 6)
    hit = lowpass(rng.standard_normal(len(t)), .3) * np.exp(-t * 30) * 1.5
    return boom + hit

def s_rise():
    t = tt(.6); env = (t / t[-1]) ** 2 * np.exp(-np.maximum(t - .55, 0) * 80)
    return lowpass(rng.standard_normal(len(t)), .02 + .3 * t / t[-1]) * env * 2.5

# volumes calibrados para ficar abaixo da voz (pico da voz = 0 dB)
FX = {"key": (s_key, .055), "click": (s_click, .17), "whoosh": (s_whoosh, .045), "pop": (s_pop, .25),
      "ding": (s_ding, .2), "impact": (s_impact, .13), "rise": (s_rise, .05)}

sfx = np.zeros(N)
for e in SFX:
    fn, g = FX[e["type"]]
    add(sfx, fn(), max(0, e["t"]), g * e.get("g", 1))

# ---------- narração ----------
voz = np.zeros(N)
filtro = "highpass=f=90,equalizer=f=250:t=q:w=1:g=-2,equalizer=f=3500:t=q:w=1.2:g=3,acompressor=threshold=-20dB:ratio=3:attack=5:release=90:makeup=2"
for i, l in enumerate(TL["lines"]):
    add(voz, load(here / f"voz/l{i+1}.wav", filtro), l["s"])
voz /= np.abs(voz).max() + 1e-9

# ---------- música ----------
def nota(n): return 440 * 2 ** ((n - 69) / 12)
BEAT = 60 / 100; BAR = BEAT * 4
ACORDES = [[57, 60, 64, 67, 71], [53, 57, 60, 64, 69], [48, 55, 60, 64, 67], [55, 59, 62, 64, 67]]  # Am9 Fmaj7 Cadd9 G6
mus = np.zeros(N)
nbar = int(TL["dur"] / BAR) + 2
for b in range(nbar):
    ac = ACORDES[b % 4]; t0 = b * BAR
    t = tt(BAR + .8); env = np.minimum(t / .5, 1) * np.exp(-np.maximum(t - BAR, 0) * 5)
    pad = sum(np.sin(2 * np.pi * nota(n) * t * d) for n in ac for d in (1, 1.004)) / (len(ac) * 2)
    add(mus, pad * env * .55, t0)
    add(mus, np.sin(2 * np.pi * nota(ac[0] - 12) * t) * env * .35, t0)  # baixo
    for k in range(8):  # arpejo
        n = ac[[0, 2, 4, 2, 1, 3, 4, 3][k]] + 12; tp = tt(.5)
        add(mus, (np.sin(2 * np.pi * nota(n) * tp) + .3 * np.sin(4 * np.pi * nota(n) * tp)) * np.exp(-tp * 9) * .16, t0 + k * BEAT / 2)
    if 0 < b and t0 < TL["dur"] - 3:
        for k in range(4):
            if k % 2 == 0:
                tk = tt(.4); f = 45 + 70 * np.exp(-tk * 30)
                add(mus, np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tk * 9) * .7, t0 + k * BEAT)
            th = tt(.05); add(mus, np.diff(rng.standard_normal(len(th)), prepend=0) * np.exp(-th * 90) * .08, t0 + k * BEAT + BEAT / 2)
mus /= np.abs(mus).max() + 1e-9
# abaixa a música quando alguém está falando
env = np.convolve(np.abs(voz), np.ones(int(.25 * SR)) / int(.25 * SR), mode="same")
env = np.minimum(env / (env.max() * .25 + 1e-9), 1)
t = np.arange(N) / SR
fade = np.minimum(t / 1.0, 1) * np.minimum(np.maximum(TL["dur"] + .3 - t, 0) / 2.5, 1)
mus *= (1 - .6 * env) * fade

mix = voz * 1.0 + mus * .30 + sfx
mix /= np.abs(mix).max() / .9

with wave.open(str(here / "trilha.wav"), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print("trilha.wav ok", round(N / SR, 2), "s")
