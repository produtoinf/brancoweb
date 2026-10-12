// Junta o servidor + páginas num arquivo só: worker.js (pronto para colar na Cloudflare)
// uso: node worker/build.mjs
import { readFileSync, writeFileSync } from 'fs';
const here = new URL('.', import.meta.url).pathname;
const ler = f => readFileSync(here + f, 'utf8');
const logo = ler('../admin/painel.html').match(/--logo:url\([^)]+\)/)[0]; // mesma logo do painel
const out = ler('src/index.js')
  .replace('__PAINEL__', () => JSON.stringify(ler('../admin/painel.html')))
  .replace('__CLIENTE__', () => JSON.stringify(ler('src/cliente.html').replace('--logo:none', logo)));
writeFileSync(here + 'worker.js', out);
console.log('worker.js gerado', (out.length / 1024).toFixed(0) + ' KB');
