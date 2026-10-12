#!/bin/sh
# Gera os vídeos com efeitos sonoros (sem locução e sem música).
# uso: sh make.sh            (precisa de node + playwright, python3 + numpy e ffmpeg)
set -e
cd "$(dirname "$0")"
gerar() { # página largura altura nome saída
  node render.mjs "$1" "$2" "$3" "$4"
  python3 sfx.py "$4"
  ffmpeg -v error -y -i "$4_mudo.mp4" -i "$4.wav" -map 0:v -map 1:a -c:v copy \
    -af "loudnorm=I=-16:TP=-1.5:LRA=11" -ar 48000 -ac 2 -c:a aac -b:a 192k -shortest -movflags +faststart "../$5"
}
gerar apresentacao.html 1920 1080 apresentacao branco-apresentacao.mp4
gerar feed.html 1080 1350 feed branco-feed.mp4
