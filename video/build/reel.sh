#!/bin/sh
# Junta a filmagem do notebook + zoom entrando na tela + apresentação vertical.
# uso: sh reel.sh <filmagem.mp4>
# antes: node render.mjs "apresentacao.html?vert" 1080 1920 vertical && python3 sfx.py vertical && python3 sfx.py intro && node legenda.mjs
set -e
cd "$(dirname "$0")"
CAM="$1"
SS=0.3; L=6; Z0=4.7; ZD=1.3; ZMAX=4.6; CX=517; CY=960; XF=5.65; XFMS=5650   # CX/CY = centro da tela do notebook na filmagem
Z="(1+($ZMAX-1)*pow(min(1\,max(0\,(t-$Z0)/$ZD))\,3))"
ffmpeg -v error -y -ss $SS -t $L -i "$CAM" -i vertical_mudo.mp4 -loop 1 -t $L -i legenda.png -i intro.wav -i vertical.wav -filter_complex "
[0:v]fps=30,scale=1080:1920:flags=lanczos,unsharp=5:5:0.6,eq=contrast=1.05:saturation=1.05,setsar=1[cam0];
[2:v]format=rgba,fade=t=out:st=4.4:d=0.4:alpha=1[leg];
[cam0][leg]overlay=0:90[cam1];
[cam1]scale=w='1080*$Z':h='1920*$Z':eval=frame:flags=bicubic,crop=1080:1920:x='max(0\,$CX*$Z-540)':y='max(0\,$CY*$Z-960)',setsar=1,format=yuv420p,settb=1/30[cam];
[1:v]fps=30,settb=1/30,setsar=1,format=yuv420p[pres];
[cam][pres]xfade=transition=fade:duration=0.35:offset=$XF[v];
[0:a]volume=12dB,afade=t=out:st=4.8:d=1,aresample=44100,pan=mono|c0=0.5*c0+0.5*c1[ca];
[4:a]adelay=$XFMS[pa];
[ca][3:a][pa]amix=inputs=3:normalize=0:duration=longest,loudnorm=I=-16:TP=-1.5:LRA=11[a]" \
 -map "[v]" -map "[a]" -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p -c:a aac -b:a 192k -ar 48000 -ac 2 -movflags +faststart ../branco-reels.mp4
echo ok
