# Trilha do motion "saas" (18 s = 9 compassos, 120 BPM): cada corte de cena cai no tempo forte de um compasso.
# uso: python3 musica.py  ->  saas.wav  (44,1 kHz, estéreo)
# 120 BPM = 1 batida a cada 0,5 s; 1 compasso (4 batidas) = 2 s = 1 cena.
import wave, pathlib
import numpy as np

here = pathlib.Path(__file__).parent
SR, BPM, DUR = 44100, 120, 18.0
NC = int(DUR / 2)               # compassos (= cenas); o último é o do logo
B = 60 / BPM                     # duração de uma batida
N = int((DUR + .05) * SR)
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(11)
tt = lambda d: np.arange(int(d * SR)) / SR


def add(sig, t, g=1.0, pan=0.0):
    i = int(round(t * SR))
    if i >= N or i < 0: return
    sig = sig[: N - i]
    L[i:i + len(sig)] += sig * g * (1 - max(0, pan))
    R[i:i + len(sig)] += sig * g * (1 + min(0, pan))


def fft_filtro(x, lo=0, hi=SR / 2):   # passa-faixa por FFT (sem scipy)
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    X[(f < lo) | (f > hi)] = 0
    return np.fft.irfft(X, len(x))


def nota(n):  # número MIDI -> Hz
    return 440 * 2 ** ((n - 69) / 12)


# ---------- instrumentos ----------
def kick(forte=1.0):
    t = tt(.45); f = 45 + 120 * np.exp(-t * 32)
    corpo = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7)
    clique = rng.standard_normal(len(t)) * np.exp(-t * 300) * .25
    return np.tanh((corpo + clique) * 1.6 * forte) * .9

def clap():
    t = tt(.35); n = fft_filtro(rng.standard_normal(len(t)), 900, 7000)
    env = np.zeros(len(t))
    for d in (0, .011, .022): env += np.exp(-np.clip(t - d, 0, None) * 90) * (t >= d)
    env += np.exp(-t * 14) * .5
    return n * env * .5

def hat(aberto=False):
    t = tt(.28 if aberto else .05); n = np.diff(rng.standard_normal(len(t) + 1))
    return fft_filtro(n, 6500) * np.exp(-t * (12 if aberto else 90)) * .32

def baixo(freq, dur):   # baixo serra com "filtro" que fecha: harmônicos somados
    t = tt(dur); s = np.zeros(len(t)); corte = 900 * np.exp(-t * 9) + 140
    for h in range(1, 18):
        fh = freq * h
        s += np.sin(2 * np.pi * fh * t) / h * (1 / (1 + (fh / corte) ** 4))
    env = np.minimum(1, t / .005) * np.exp(-t * 2.2)
    return np.tanh(s * 1.8) * env * .45

def pluck(freq, dur=.22):
    t = tt(dur); s = np.zeros(len(t))
    for h in range(1, 9): s += np.sin(2 * np.pi * freq * h * t) / h ** 1.3 * np.exp(-t * (14 + h * 6))
    return s * .22

def pad(freqs, dur):
    t = tt(dur); s = np.zeros(len(t))
    for f in freqs:
        for d in (-.12, 0, .12):   # leve desafinação = coro
            s += np.sin(2 * np.pi * f * 2 ** (d / 12) * t + rng.uniform(0, 6)) + .3 * np.sin(2 * np.pi * 2 * f * t)
    env = np.minimum(1, t / .4) * np.minimum(1, (dur - t) / 1.2)
    return s / (len(freqs) * 3) * env * .5

def whoosh(dur=.5, subindo=True):   # varredura de ruído que entra junto com a transição
    t = tt(dur); x = rng.standard_normal(len(t)); out = np.zeros(len(t)); passos = 12
    for k in range(passos):   # filtro que abre aos poucos (em blocos)
        a, b = k * len(t) // passos, (k + 1) * len(t) // passos
        c = 400 * (14 ** ((k + 1) / passos if subindo else 1 - k / passos))
        out[a:b] = fft_filtro(x, c * .5, c * 1.6)[a:b]
    env = (t / dur) ** 2 if subindo else (1 - t / dur) ** 2
    return out * env * .7

def impacto():
    t = tt(1.4); f = 32 + 70 * np.exp(-t * 10)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.6)
    ruido = fft_filtro(rng.standard_normal(len(t)), 80, 3000) * np.exp(-t * 9) * .7
    return np.tanh((sub + ruido) * 1.4) * .8

def crash():
    t = tt(1.6); n = fft_filtro(rng.standard_normal(len(t)), 4000)
    return n * np.exp(-t * 2.4) * .22

def blip(freq):   # bipes do visor
    t = tt(.06); return np.sin(2 * np.pi * freq * t) * np.exp(-t * 60) * .25


# ---------- arranjo ----------
# progressão em Lá menor, um acorde por compasso (= por cena)
ACORDES = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]] * 3      # Am F C G
RAIZ = [33, 29, 36, 31] * 3                                                  # A1 F1 C2 G1
ARP = [0, 1, 2, 1, 0, 2, 1, 2]

for c in range(NC):
    t0 = c * 2 * B * 2   # compasso c começa em c*2 s
    t0 = c * 2.0
    # corte de cena: impacto + crash no tempo forte (menos no primeiro e no logo, que tem o seu)
    if 1 <= c <= NC - 2: add(impacto(), t0, .55); add(crash(), t0, .9, pan=.3)
    # whoosh nos últimos 1/2 tempo antes de cada corte (casa com as faixas/halftone)
    if c < NC - 1: add(whoosh(.5), t0 + 2 - .5, .9, pan=-.2 if c % 2 else .2)

    if c == 0:   # visor ligando: só bipes, pulso grave e chimbal subindo
        for k in range(16): add(blip(1760 if k % 4 == 0 else 1320), t0 + k * B / 4, .7 if k % 4 == 0 else .35, pan=(k % 2 - .5) * .6)
        add(baixo(nota(RAIZ[0]), 2.0), t0, .6)
        for k in range(8): add(hat(), t0 + 1 + k * B / 4, .4 + k * .08)
        continue

    if c == NC - 1:   # logo: impacto grande, acorde aberto e silêncio do ritmo
        add(impacto(), t0, 1.1); add(crash(), t0, 1.2, pan=-.2); add(kick(1.3), t0, 1.0)
        add(pad([nota(57), nota(64), nota(69), nota(71), nota(76)], 2.05), t0, 1.0)
        add(baixo(nota(33), 2.0), t0, .8)
        for k, n in enumerate([69, 72, 76, 79, 81]): add(pluck(nota(n), .5), t0 + .25 + k * B / 2, .6, pan=(k - 2) * .25)
        continue

    # cenas 2 a 7: batida completa
    for k in range(4):
        add(kick(1.0 if k == 0 else .85), t0 + k * B, .95)
        if k in (1, 3): add(clap(), t0 + k * B, .8)
    for k in range(16):   # chimbal em semicolcheias com acento
        add(hat(k % 8 == 6), t0 + k * B / 4, (.55 if k % 2 == 0 else .3) * (1.2 if c >= 4 else 1), pan=.25 if k % 2 else -.25)
    # baixo em colcheias com pausa no contratempo
    for k in range(8):
        if k in (3,): continue
        add(baixo(nota(RAIZ[c] + (12 if k in (5,) else 0)), B / 2 * .95), t0 + k * B / 2, .85)
    # arpejo em semicolcheias (só a partir da cena 3)
    if c >= 2:
        notas = ACORDES[c]
        for k in range(16):
            n = notas[ARP[k % 8]] + (12 if k >= 8 else 0)
            add(pluck(nota(n)), t0 + k * B / 4, .55, pan=.35 if k % 2 else -.35)
    # cama harmônica
    add(pad([nota(n) for n in ACORDES[c]], 2.0), t0, .7)
    # cena 7 (idiomas): "picotado" no último tempo antes do logo
    if c == NC - 2:
        for k in range(4): add(clap(), t0 + 1.5 + k * B / 4, .5 + k * .12)

# ---------- mixagem final ----------
mix = np.stack([L, R], 1)
mix = np.tanh(mix * 1.3) / np.tanh(1.3)                  # saturação suave
fim = int((DUR - .4) * SR); mix[fim:] *= np.linspace(1, 0, len(mix) - fim)[:, None] ** 2   # some no fim
mix = mix[: int(DUR * SR)]
mix = mix / np.max(np.abs(mix)) * .89
with wave.open(str(here / 'saas.wav'), 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('saas.wav', DUR, 's', BPM, 'BPM')
