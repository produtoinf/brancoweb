# Lê a duração de cada fala e gera ../timeline.js com o início/fim de cada uma.
import json, subprocess, pathlib

here = pathlib.Path(__file__).parent
linhas = (here / "narracao.txt").read_text(encoding="utf-8").strip().splitlines()
# pausa depois de cada fala (tempo para as animações respirarem)
pausas = [1.5, 1.0, 1.0, 1.1, 1.2, 0.35, 0.7, 3.2]

t, tl = 0.8, []
for i, texto in enumerate(linhas):
    dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                         "-of", "csv=p=0", str(here / f"voz/l{i+1}.wav")]))
    tl.append({"s": round(t, 3), "e": round(t + dur, 3), "txt": texto})
    t += dur + pausas[i]

dados = {"lines": tl, "dur": round(t, 3)}
(here.parent / "timeline.js").write_text("window.TL=" + json.dumps(dados, ensure_ascii=False) + ";\n", encoding="utf-8")
print(json.dumps(dados, ensure_ascii=False, indent=1))
