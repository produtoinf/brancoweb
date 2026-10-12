// Gera a legenda branca (estilo da referência) como PNG transparente: node legenda.mjs "texto"
import { chromium } from 'playwright';
const txt = process.argv[2] || 'Esse anúncio foi 100% feito com código';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 300 } });
await p.setContent(`<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@700&display=swap" rel="stylesheet">
<style>body{margin:0;display:flex;justify-content:center;align-items:flex-start;padding-top:40px;background:transparent}
span{display:block;width:fit-content;max-width:640px;text-align:center;background:#fff;color:#0a0a0b;font:700 46px/1.25 Archivo,sans-serif;padding:18px 34px;border-radius:22px;box-shadow:0 10px 40px #0006}</style><span>${txt}</span>`);
await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(500);
await p.screenshot({ path: new URL('legenda.png', import.meta.url).pathname, omitBackground: true });
await b.close();
