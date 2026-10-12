// Junta o servidor + páginas num arquivo só: worker.js (pronto para colar na Cloudflare)
// uso: node worker/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
const here = new URL('.', import.meta.url).pathname;
const ler = f => readFileSync(here + f, 'utf8');
const logo = ler('../admin/painel.html').match(/--logo:url\([^)]+\)/)[0]; // mesma logo do painel
const out = ler('src/index.js')
  .replace('__PAINEL__', () => JSON.stringify(ler('../admin/painel.html')))
  .replace('__CLIENTE__', () => JSON.stringify(ler('src/cliente.html').replace('--logo:none', logo)));
writeFileSync(here + 'worker.js', out);
// área do cliente dentro do site (GitHub Pages): mesma página, falando com o Worker
const API = 'https://branco-admin.brancowebs.workers.dev';
const pagSite = ler('src/cliente.html').replace('--logo:none', logo).replace('<script>\nconst WHATS', `<script>window.BRANCO_API='${API}'</script>\n<script>\nconst WHATS`)
  .replace('<meta name="robots" content="noindex">', `<meta name="robots" content="noindex">\n<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src ${API}; base-uri 'none'; form-action 'none'; object-src 'none'">\n<meta name="referrer" content="no-referrer">`);
mkdirSync(here + '../cliente', { recursive: true });
writeFileSync(here + '../cliente/index.html', pagSite);
console.log('cliente/index.html gerado');
console.log('worker.js gerado', (out.length / 1024).toFixed(0) + ' KB');
