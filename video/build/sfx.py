# Gera a trilha só com efeitos sonoros (clique, teclado, whoosh, notificação...) a partir da lista salva pelo render.mjs.
# uso: python3 sfx.py <nome>     ex.: python3 sfx.py apresentacao  ->  apresentacao_sfx.json  =>  apresentacao.wav
import json, sys, wave, pathlib
import numpy as np

here = pathlib.Path(__file__).parent
nome = sys.argv[1] if len(sys.argv) > 1 else "feed"
dados = json.loads((here / f"{nome}_sfx.json").read_text())
SR = 44100
rng = np.random.default_rng(7)
N = int((dados["dur"] + .5) * SR)
tt = lambda d: np.arange(int(d * SR)) / SR


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

mix = np.zeros(N)
for e in dados["sfx"]:
    fn, g = FX[e["type"]]
    add(mix, fn(), max(0, e["t"]), g * e.get("g", 1))
mix /= np.abs(mix).max() / .9

with wave.open(str(here / f"{nome}.wav"), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print(f"{nome}.wav ok", round(N / SR, 2), "s")
