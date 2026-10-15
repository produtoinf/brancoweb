// Prévia: gera quadros soltos do motion em PNG (uso: node previa.mjs <saida_dir> t1 t2 ...)
import { chromium } from 'playwright';
const [dir, ...ts] = process.argv.slice(2), here = new URL('.', import.meta.url).pathname;
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const erros = []; p.on('pageerror', e => erros.push(e.message));
await p.goto('file://' + here + '../saas.html?render'); await p.evaluate(() => document.fonts.ready);
await p.waitForFunction(() => document.getElementById('logo').complete); await p.waitForTimeout(500);
for (const t of ts) { await p.evaluate(t => render(t), +t); await p.screenshot({ path: `${dir}/q-${t}.png` }); }
console.log('ok', ts.length, erros); await b.close();
