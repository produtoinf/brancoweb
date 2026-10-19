// Teste do site demo: criar a partir da prospecção, gerar (padrão e IA simulada), editar, publicar, follow-up e isolamento entre contas.
// Rodar:  node worker/test/demos.test.mjs      (Node 22+, sem instalar nada)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { novoD1 } from './d1.mjs';

const aqui = new URL('.', import.meta.url).pathname;
const fonte = readFileSync(join(aqui, '../src/index.js'), 'utf8').replace('// @@DEMO@@', () => readFileSync(join(aqui, '../src/demo.js'), 'utf8'))
  .replace('__PAINEL__', '"<html>painel</html>"').replace('__CLIENTE__', '"<html>cliente</html>"');
const tmp = mkdtempSync(join(tmpdir(), 'branco-demo-')); writeFileSync(join(tmp, 'worker.mjs'), fonte);
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
console.log = (...a) => { if (!String(a[0]).startsWith('[e-mail')) process.stdout.write(a.join(' ') + '\n'); };
const worker = (await import(join(tmp, 'worker.mjs'))).default;

const d1 = novoD1(), BASE = 'https://painel.teste';
const env = { DB: d1, ADMIN_SENHA: 'senha-do-dono', CADASTRO_ABERTO: '1' };
let passou = 0, falhou = 0;
function ok(nome, cond) { if (cond) passou++; else { falhou++; console.error('  ✗', nome); } }
async function chama(metodo, caminho, { corpo, cookie, host } = {}) {
  const h = { 'Content-Type': 'application/json' }; if (cookie) h.Cookie = cookie;
  const r = await worker.fetch(new Request((host ? 'https://' + host : BASE) + caminho, { method: metodo, headers: h, body: corpo ? JSON.stringify(corpo) : undefined }), env, { waitUntil() {} });
  const texto = await r.clone().text(); let dados = null; try { dados = JSON.parse(texto); } catch {}
  return { status: r.status, dados, texto, headers: r.headers, cookie: (r.headers.get('Set-Cookie') || '').split(';')[0] || null };
}
const api = cookie => ({ get: c => chama('GET', c, { cookie }), post: (c, corpo) => chama('POST', c, { corpo, cookie }), patch: (c, corpo) => chama('PATCH', c, { corpo, cookie }), del: c => chama('DELETE', c, { cookie }) });

const A = api((await chama('POST', '/api/login', { corpo: { senha: 'senha-do-dono' } })).cookie);
const item = { id: 's:1', nome: 'Barbearia do Zé', categoria: 'Barbearia', telefone: '5541999887766', celular: true, whatsapp: false, site: null, instagram: '@barbeariadoze',
  endereco: 'R. XV de Novembro, 100 · Centro', cidade: 'Curitiba', maps: 'https://maps.google.com/?cid=123' };

console.log('• criar a partir da prospecção');
const c1 = await A.post('/api/demos', { item, nicho: 'Barbearia', idioma: 'pt', estado: 'Paraná', pais: 'Brasil' });
ok('cria a demo em rascunho', c1.status === 200 && c1.dados.demo.status === 'draft' && c1.dados.demo.template === 'premium');
ok('nicho identificado', c1.dados.demo.dados.nichoId === 'barbearia' && c1.dados.demo.dados.cidade === 'Curitiba');
const demo = c1.dados.demo, fu1 = (await A.get('/api/followup')).dados;
const ct = fu1.contatos.find(c => c.nome === 'Barbearia do Zé');
ok('prospect salvo no follow-up e ligado à demo', ct && ct.id === demo.contato_id && ct.demo_id === demo.id && ct.demo_status === 'draft');
const c2 = await A.post('/api/demos', { item, nicho: 'Barbearia', idioma: 'pt' });
ok('mesmo prospect não cria outra demo', c2.dados.existente === true && c2.dados.demo.id === demo.id);
ok('sem link antes de publicar', demo.link === null);

console.log('• gerar com textos padrão (sem chave de IA)');
const g1 = await A.post(`/api/demos/${demo.id}/gerar`, { estilo: 'auto' });
ok('gera sem IA', g1.status === 200 && g1.dados.demo.status === 'ready' && g1.dados.demo.ia === false);
ok('conteúdo tem título, serviços e contato real', g1.dados.demo.conteudo.titulo === 'Barbearia do Zé' && g1.dados.demo.conteudo.servicos.length >= 3 && g1.dados.demo.conteudo.contato.whatsapp === '5541999887766');
ok('não gera de novo sem confirmar', (await A.post(`/api/demos/${demo.id}/gerar`, {})).status === 409);
ok('gera de novo confirmando', (await A.post(`/api/demos/${demo.id}/gerar`, { forcar: true, estilo: 'natural' })).dados.demo.tema.cor === '#2f855a');

console.log('• prévia');
const pv = await A.get(`/api/demos/${demo.id}/previa`);
ok('prévia abre no painel (iframe do próprio painel)', pv.status === 200 && /frame-ancestors 'self'/.test(pv.headers.get('Content-Security-Policy')) && pv.headers.get('X-Frame-Options') === 'SAMEORIGIN');
ok('página sem scripts e não indexável', !/<script/i.test(pv.texto) && /noindex/.test(pv.texto) && /default-src 'none'/.test(pv.headers.get('Content-Security-Policy')));
ok('tem o aviso de demonstração', pv.texto.includes('Demonstração conceitual — site não oficial') && pv.texto.includes('Não é o site oficial de Barbearia do Zé'));
ok('botão do WhatsApp com o número do prospect', pv.texto.includes('https://wa.me/5541999887766'));
for (const t of ['premium', 'moderno', 'comercial']) {
  await A.patch(`/api/demos/${demo.id}`, { template: t });
  const h = (await A.get(`/api/demos/${demo.id}/previa`)).texto;
  ok(`template ${t} renderiza todas as seções`, ['id="inicio"', 'id="servicos"', 'id="contato"', 'id="sobre"'].every(x => h.includes(x)));
}

console.log('• edição e segurança do conteúdo');
const ed = await A.patch(`/api/demos/${demo.id}`, { template: 'moderno', conteudo: { ...g1.dados.demo.conteudo, titulo: '<script>alert(1)</script>Zé', subtitulo: 'Cortes "clássicos" & barba' },
  tema: { modo: 'escuro', cor: 'red;}body{display:none', cor2: '#222222', imagem: 'javascript:alert(1)', imagem2: 'http://inseguro.com/a.jpg' } });
ok('salva a edição', ed.status === 200 && ed.dados.demo.template === 'moderno' && ed.dados.demo.tema.modo === 'escuro');
ok('cor inválida volta ao padrão', ed.dados.demo.tema.cor === '#2563eb' && ed.dados.demo.tema.cor2 === '#222222');
ok('imagem só https', ed.dados.demo.tema.imagem === null && ed.dados.demo.tema.imagem2 === null);
const pv2 = (await A.get(`/api/demos/${demo.id}/previa`)).texto;
ok('texto é escapado (não vira código)', pv2.includes('&lt;script&gt;alert(1)&lt;/script&gt;Zé') && !pv2.includes('<script>alert'));
ok('título vazio é recusado', (await A.patch(`/api/demos/${demo.id}`, { conteudo: { titulo: '' } })).status === 400);
ok('alteração continua salva depois de recarregar', (await A.get(`/api/demos/${demo.id}`)).dados.conteudo.subtitulo === 'Cortes "clássicos" & barba');

console.log('• publicação');
ok('antes de publicar o link público dá 404', (await chama('GET', '/d/' + demo.slug)).status === 404);
const pub = await A.post(`/api/demos/${demo.id}/publicar`);
ok('publica e devolve o link', pub.dados.demo.status === 'published' && pub.dados.demo.link === `${BASE}/d/${demo.slug}`);
const pg = await chama('GET', '/d/' + demo.slug);
ok('link público abre sem login', pg.status === 200 && pg.texto.includes('Demonstração conceitual'));
ok('link público: sem indexação e sem iframe', /noindex/.test(pg.headers.get('X-Robots-Tag')) && pg.headers.get('X-Frame-Options') === 'DENY');
ok('slug é único e legível', /^barbearia-do-ze-[a-z0-9]{6}$/.test(demo.slug));
env.DEMO_DOMINIO = 'https://demo.exemplo.com/';
ok('link usa o DEMO_DOMINIO', (await A.get(`/api/demos/${demo.id}`)).dados.link === `https://demo.exemplo.com/${demo.slug}`);
ok('domínio das demos serve a página', (await chama('GET', '/' + demo.slug, { host: 'demo.exemplo.com' })).status === 200);
ok('domínio das demos não serve o painel', (await chama('GET', '/admin', { host: 'demo.exemplo.com' })).status === 404);
delete env.DEMO_DOMINIO;
ok('robots.txt bloqueia tudo', (await chama('GET', '/robots.txt')).texto.includes('Disallow: /'));
await A.post(`/api/demos/${demo.id}/despublicar`);
ok('despublicar tira do ar', (await chama('GET', '/d/' + demo.slug)).status === 404 && (await A.get(`/api/demos/${demo.id}`)).dados.status === 'ready');

console.log('• follow-up');
await A.post(`/api/demos/${demo.id}/evento`, { tipo: 'link_copiado' });
await A.post(`/api/demos/${demo.id}/evento`, { tipo: 'msg_copiada' });
let c = (await A.get('/api/followup')).dados.contatos.find(x => x.id === demo.contato_id);
ok('copiar link/mensagem não marca como enviada', c.contatos === 0 && c.venda === 'novo');
ok('evento inválido é recusado', (await A.post(`/api/demos/${demo.id}/evento`, { tipo: 'enviada' })).status === 400);
await A.post(`/api/demos/${demo.id}/abordagem`, { hoje: '2026-10-18', canal: 'whatsapp' });
c = (await A.get('/api/followup')).dados.contatos.find(x => x.id === demo.contato_id);
ok('abordagem registrada conta como mensagem e agenda lembrete', c.contatos === 1 && c.venda === 'enviada' && c.proximo_contato === '2026-10-20');
const ld = (await A.get('/api/demos')).dados.demos.find(d => d.id === demo.id);
ok('aba Sites demo: lista traz a empresa e o envio', ld.empresa.nome === 'Barbearia do Zé' && ld.empresa.telefone === '5541999887766' && ld.empresa.instagram === '@barbeariadoze' && ld.contatos === 1 && !('dados' in ld));
await A.post(`/api/demos/${demo.id}/followup`, { proximo_contato: '2026-11-03', notas: 'gostou da demo' });
const det = (await A.get(`/api/demos/${demo.id}`)).dados;
ok('próximo contato e anotação vão para o contato', det.contato.proximo_contato === '2026-11-03' && det.contato.notas === 'gostou da demo');
ok('histórico tem os eventos', ['criada', 'gerada', 'publicada', 'despublicada', 'link_copiado', 'msg_copiada', 'abordagem', 'proximo_contato'].every(t => det.eventos.some(e => e.tipo === t)));

console.log('• isolamento entre contas');
const cb = await chama('POST', '/api/conta/cadastro', { corpo: { nome: 'Bia', email: 'bia@beta.com', senha: 'senha-bia-123' } });
const B = api(cb.cookie);
ok('B não vê as demos de A', (await B.get('/api/demos')).dados.demos.length === 0);
ok('B não abre a demo de A', (await B.get(`/api/demos/${demo.id}`)).status === 404 && (await B.get(`/api/demos/${demo.id}/previa`)).status === 404);
ok('B não edita nem publica a demo de A', (await B.patch(`/api/demos/${demo.id}`, { conteudo: { titulo: 'hack' } })).status === 404 && (await B.post(`/api/demos/${demo.id}/publicar`)).status === 404);
ok('B não apaga a demo de A', (await B.del(`/api/demos/${demo.id}`)).status === 404 && (await A.get(`/api/demos/${demo.id}`)).status === 200);
ok('sem login: 401', (await chama('GET', '/api/demos')).status === 401);

console.log('• geração com IA (simulada)');
env.ANTHROPIC_API_KEY = 'chave-teste';
const fetchReal = globalThis.fetch; let pedido = null, resposta = 'ok';
const IA = { titulo: 'Estilo e precisão em Curitiba', subtitulo: 'Cortes e barba com atendimento atencioso.', apresentacao: 'Um espaço pensado para você.', sobre: 'Texto sobre.', cta: 'Agendar pelo WhatsApp', cta2: 'Ver serviços',
  servicos_titulo: 'Serviços', servicos: [{ titulo: 'Corte', texto: 'Consulte' }, { titulo: 'Barba', texto: 'Consulte' }, { titulo: 'Acabamento', texto: 'Consulte' }], diferenciais: [{ titulo: 'Perto de você', texto: 'Centro' }],
  whatsapp_msg: 'Olá! Quero agendar.', estilo: { modo: 'escuro', cor: '#b08d57' }, contato: { telefone: '000', endereco: 'inventado' } };
globalThis.fetch = async (url, o) => {
  if (!String(url).startsWith('https://api.anthropic.com/')) return fetchReal(url, o);
  pedido = { url, headers: o.headers, corpo: JSON.parse(o.body) };
  if (resposta === 'erro') return new Response(JSON.stringify({ type: 'error', error: { message: 'overloaded' } }), { status: 529 });
  const texto = resposta === 'invalido' ? 'isto não é json' : JSON.stringify(IA);
  return new Response(JSON.stringify({ content: [{ type: 'text', text: texto }], stop_reason: 'end_turn' }), { status: 200 });
};
const lB = (await B.get('/api/demos')).dados;
ok('plano de teste: limite de 3 com IA', lB.uso.limite === 3 && lB.ia === true);
const dB = (await B.post('/api/demos', { item: { ...item, nome: 'Salão da Bia', categoria: 'Salão de beleza', telefone: '5541988880000' }, nicho: 'Salão de beleza', idioma: 'pt' })).dados.demo;
const gB = await B.post(`/api/demos/${dB.id}/gerar`, { estilo: 'auto' });
ok('gera com IA', gB.status === 200 && gB.dados.demo.ia === true && gB.dados.demo.conteudo.titulo === 'Estilo e precisão em Curitiba');
ok('estilo sugerido pela IA é aplicado no "automático"', gB.dados.demo.tema.cor === '#b08d57' && gB.dados.demo.tema.modo === 'escuro');
ok('contato não vem da IA', gB.dados.demo.conteudo.contato.telefone === '5541988880000' && gB.dados.demo.conteudo.contato.endereco !== 'inventado');
ok('pedido usa saída JSON estruturada', pedido.corpo.output_config?.format?.type === 'json_schema' && pedido.corpo.thinking === undefined && pedido.headers['x-api-key'] === 'chave-teste');
ok('pedido não leva telefone nem endereço', !JSON.stringify(pedido.corpo.messages).includes('5541988880000'));
resposta = 'invalido';
const gF = await B.post(`/api/demos/${dB.id}/gerar`, { forcar: true });
ok('resposta inválida da IA vira erro tratado', gF.status === 502 && /formato inválido/.test(gF.dados.erro));
ok('com texto anterior a demo continua pronta', (await B.get(`/api/demos/${dB.id}`)).dados.status === 'ready');
const dB2 = (await B.post('/api/demos', { item: { ...item, nome: 'Oficina Nova', categoria: 'Oficina mecânica', telefone: '5541977770000' }, nicho: 'Oficina mecânica', idioma: 'pt' })).dados.demo;
ok('template comercial recomendado para oficina', dB2.template === 'comercial');
resposta = 'erro';
const gE = await B.post(`/api/demos/${dB2.id}/gerar`, {});
const eB2 = (await B.get(`/api/demos/${dB2.id}`)).dados;
ok('erro da IA: status falhou com motivo', gE.status === 502 && eB2.status === 'failed' && /overloaded/.test(eB2.erro));
ok('falha vai para o log', !!d1._db.prepare("SELECT 1 FROM log WHERE texto LIKE 'site demo%'").get());
ok('textos padrão funcionam mesmo com a IA fora', (await B.post(`/api/demos/${dB2.id}/gerar`, { padrao: true })).dados.demo.status === 'ready');
resposta = 'ok';
d1._db.prepare("UPDATE site_demos SET status = 'generating', atualizado_em = datetime('now') WHERE id = ?").run(dB2.id);
ok('não gera duas vezes ao mesmo tempo', (await B.post(`/api/demos/${dB2.id}/gerar`, { forcar: true })).status === 409);
d1._db.prepare("UPDATE site_demos SET status = 'ready' WHERE id = ?").run(dB2.id);
await B.post(`/api/demos/${dB2.id}/gerar`, { forcar: true }); await B.post(`/api/demos/${dB2.id}/gerar`, { forcar: true });
ok('limite mensal de IA do plano', (await B.post(`/api/demos/${dB.id}/gerar`, { forcar: true })).status === 402);
ok('conta da Branco não tem limite', (await A.get('/api/demos')).dados.uso.limite === null);
globalThis.fetch = fetchReal; delete env.ANTHROPIC_API_KEY;

console.log('• excluir conta apaga as demos');
const contaB = d1._db.prepare("SELECT conta_id FROM site_demos WHERE id = ?").get(dB.id).conta_id;
await A.del('/api/saas/contas/' + contaB);
ok('demos e eventos de B apagados', !d1._db.prepare('SELECT 1 FROM site_demos WHERE conta_id = ?').get(contaB) && !d1._db.prepare('SELECT 1 FROM demo_eventos WHERE conta_id = ?').get(contaB));

console.log(`\n${passou} ok, ${falhou} falhou`);
process.exit(falhou ? 1 : 0);
