// Grava uma página animada quadro a quadro em MP4 (sem áudio) e salva a lista de efeitos sonoros.
// uso: node render.mjs <pagina.html> <largura> <altura> <nome>
//   ex.: node render.mjs feed.html 1080 1350 feed
//        node render.mjs apresentacao.html 1920 1080 apresentacao
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { writeFileSync } from 'fs';
const [page = 'feed.html', W = '1080', H = '1350', nome = 'feed'] = process.argv.slice(2);
const FPS = 30, here = new URL('.', import.meta.url).pathname;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: +W, height: +H } });
await p.goto('file://' + here + '../' + page + (page.includes('?') ? '&' : '?') + 'render');
await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(800);
const { DUR, SFX } = await p.evaluate(() => ({ DUR: window.DUR, SFX: window.SFX }));
writeFileSync(`${here}${nome}_sfx.json`, JSON.stringify({ dur: DUR, sfx: SFX }));
const ff = spawn('ffmpeg', ['-loglevel','error','-y','-f','image2pipe','-framerate',String(FPS),'-i','-',
  '-c:v','libx264','-pix_fmt','yuv420p','-crf','18','-preset','medium', `${here}${nome}_mudo.mp4`], { stdio: ['pipe','inherit','inherit'] });
const N = Math.ceil(DUR * FPS);
for (let i = 0; i < N; i++) {
  await p.evaluate(t => render(t), i / FPS);
  const buf = await p.screenshot({ type: 'jpeg', quality: 92 });
  if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
}
ff.stdin.end(); await new Promise(r => ff.on('close', r)); await b.close();
console.log(nome, 'quadros', N, 'duração', DUR, 'efeitos', SFX.length);
