// Teste de isolamento entre contas: cria contas, enche de dados e confere que uma não vê nem mexe na outra.
// Rodar:  node worker/test/isolamento.test.mjs      (precisa do Node 22+, sem instalar nada)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { novoD1 } from './d1.mjs';

const aqui = new URL('.', import.meta.url).pathname;
const fonte = readFileSync(join(aqui, '../src/index.js'), 'utf8').replace('__PAINEL__', '"<html>painel</html>"').replace('__CLIENTE__', '"<html>cliente</html>"');
const tmp = mkdtempSync(join(tmpdir(), 'branco-')); writeFileSync(join(tmp, 'worker.mjs'), fonte);
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
console.log = (...a) => { if (!String(a[0]).startsWith('[e-mail')) process.stdout.write(a.join(' ') + '\n'); }; // esconde os e-mails simulados
const worker = (await import(join(tmp, 'worker.mjs'))).default;

const d1 = novoD1(), BASE = 'https://painel.teste';
const env = { DB: d1, ADMIN_SENHA: 'senha-do-dono', CADASTRO_ABERTO: '1' };

// 1) banco "antigo": tabelas sem conta_id, com dados — como está em produção hoje
d1._db.exec(`
  CREATE TABLE contatos (id INTEGER PRIMARY KEY, lid TEXT UNIQUE, v TEXT, nome TEXT, telefone TEXT, empresa TEXT, projeto TEXT, mensagem TEXT, status TEXT NOT NULL DEFAULT 'parcial', origem TEXT, venda TEXT NOT NULL DEFAULT 'novo', contatos INTEGER NOT NULL DEFAULT 0, ultimo_contato TEXT, proximo_contato TEXT, notas TEXT, proposta INTEGER, criado_em TEXT NOT NULL DEFAULT (datetime('now')), atualizado_em TEXT);
  CREATE TABLE vendas (id INTEGER PRIMARY KEY, cliente TEXT NOT NULL, servico TEXT, valor INTEGER NOT NULL DEFAULT 0, mensal INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, fim TEXT, pago INTEGER NOT NULL DEFAULT 0, notas TEXT, contato_id INTEGER, criado_em TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE clientes (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, email TEXT, projeto TEXT, site_url TEXT, etapa INTEGER NOT NULL DEFAULT 1, recado TEXT, site TEXT UNIQUE NOT NULL, token TEXT UNIQUE NOT NULL, criado_em TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE extrato (id INTEGER PRIMARY KEY, ext_id TEXT UNIQUE NOT NULL, data TEXT NOT NULL, valor INTEGER NOT NULL, descricao TEXT, venda_id INTEGER, ignorar INTEGER NOT NULL DEFAULT 0, criado_em TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE config (chave TEXT PRIMARY KEY, valor TEXT);
  INSERT INTO contatos (lid, nome, telefone, origem, venda) VALUES ('antigo1', 'Cliente Antigo', '5541999990000', 'prospeccao', 'conversando');
  INSERT INTO vendas (cliente, servico, valor, data) VALUES ('Venda Antiga', 'Site', 150000, '2026-01-10');
  INSERT INTO clientes (nome, site, token) VALUES ('Cliente Site Antigo', 'abc123', 'tokentokentokentoken1234');
  INSERT INTO extrato (ext_id, data, valor, descricao) VALUES ('nu-1', '2026-01-11', 150000, 'PIX recebido');
  INSERT INTO config (chave, valor) VALUES ('msg_semsite', 'Oi {nome}, mensagem antiga da Branco');
`);

// ---- utilidades ----
let passou = 0, falhou = 0;
function ok(nome, cond) { if (cond) passou++; else { falhou++; console.error('  ✗', nome); } }
async function chama(metodo, caminho, { corpo, cookie, origem } = {}) {
  const h = { 'Content-Type': 'application/json' }; if (cookie) h.Cookie = cookie; if (origem) h.Origin = origem;
  const r = await worker.fetch(new Request(BASE + caminho, { method: metodo, headers: h, body: corpo ? JSON.stringify(corpo) : undefined }), env);
  let dados = null; try { dados = await r.clone().json(); } catch {}
  return { status: r.status, dados, cookie: (r.headers.get('Set-Cookie') || '').split(';')[0] || null };
}
const api = cookie => ({
  get: c => chama('GET', c, { cookie }), post: (c, corpo) => chama('POST', c, { corpo, cookie }),
  patch: (c, corpo) => chama('PATCH', c, { corpo, cookie }), put: (c, corpo) => chama('PUT', c, { corpo, cookie }), del: c => chama('DELETE', c, { cookie }),
});

// ---- 2) dono entra como antes (só a senha) e vê os dados antigos na conta 1 ----
console.log('• migração + login antigo');
const falha = await chama('POST', '/api/login', { corpo: { senha: 'errada' } });
ok('senha errada dá 401', falha.status === 401);
const lg = await chama('POST', '/api/login', { corpo: { senha: 'senha-do-dono' } });
ok('login pela ADMIN_SENHA funciona', lg.status === 200 && lg.cookie?.startsWith('bsess='));
const A = api(lg.cookie);
const sA = (await A.get('/api/sessao')).dados;
ok('sessão do dono é a conta 1, dona do site', sA.papel === 'admin' && sA.conta.id === 1 && sA.site === true && sA.admin === true && sA.usuario === null);
const fuA = (await A.get('/api/followup')).dados;
ok('contato antigo migrou para a conta 1', fuA.contatos.length === 1 && fuA.contatos[0].nome === 'Cliente Antigo');
ok('modelos iniciais criados na conta 1', fuA.modelos.length >= 1);
ok('venda antiga migrou', (await A.get('/api/vendas')).dados.vendas[0].cliente === 'Venda Antiga');
ok('cliente antigo migrou', (await A.get('/api/clientes')).dados[0].nome === 'Cliente Site Antigo');
ok('extrato antigo migrou (id do banco virou conta:id)', (await A.get('/api/extrato')).dados.length === 1 && d1._db.prepare("SELECT ext_id FROM extrato").get().ext_id === '1:nu-1');
ok('mensagem de prospecção antiga virou da conta 1', (await A.get('/api/config')).dados.msg_semsite.includes('mensagem antiga'));

// ---- 3) duas contas novas pelo cadastro ----
console.log('• cadastro de duas contas');
const cb = await chama('POST', '/api/conta/cadastro', { corpo: { nome: 'Bia', empresa: 'Beta Design', email: 'bia@beta.com', senha: 'senha-bia-123' } });
ok('cadastro B cria sessão', cb.status === 200 && cb.cookie);
const cc = await chama('POST', '/api/conta/cadastro', { corpo: { nome: 'Caio', email: 'caio@gama.com', senha: 'senha-caio-123' } });
ok('cadastro C cria sessão', cc.status === 200 && cc.cookie);
ok('e-mail repetido é recusado', (await chama('POST', '/api/conta/cadastro', { corpo: { nome: 'X', email: 'bia@beta.com', senha: 'senha-qualquer' } })).status === 400);
ok('senha curta é recusada', (await chama('POST', '/api/conta/cadastro', { corpo: { nome: 'X', email: 'x@x.com', senha: '123' } })).status === 400);
const B = api(cb.cookie), C = api(cc.cookie);
const sB = (await B.get('/api/sessao')).dados, sC = (await C.get('/api/sessao')).dados;
ok('B é dona da própria conta, sem visão do site', sB.conta.nome === 'Beta Design' && sB.meuPapel === 'dono' && sB.site === false && sB.admin === false && sB.usuario.email === 'bia@beta.com');
ok('C tem conta própria (nome = nome da pessoa)', sC.conta.nome === 'Caio' && sC.conta.id !== sB.conta.id && sC.conta.id !== 1);
ok('conta nova começa sem contatos', (await B.get('/api/followup')).dados.contatos.length === 0);
ok('conta nova recebe os modelos iniciais', (await B.get('/api/followup')).dados.modelos.length >= 1);

// ---- 4) cada conta cria seus dados (assinantes só têm follow-up e prospecção) ----
console.log('• dados de cada conta');
for (const [X, n] of [[B, 'B'], [C, 'C']]) {
  await X.post('/api/contatos', { nome: 'Contato ' + n, telefone: '5541988880000' });
  await X.post('/api/modelos', { titulo: 'Modelo ' + n, texto: 'Texto ' + n });
  await X.put('/api/config', { msg_semsite: 'Mensagem de ' + n });
  await X.post('/api/prospeccao/salvar', { itens: [{ nome: 'Barbearia ' + n, telefone: '554199999' + (n === 'B' ? '1111' : '2222'), cidade: 'Curitiba', nicho: 'Barbearia' }] });
}
await A.post('/api/clientes', { nome: 'Cliente A', email: 'a@cliente.com' });
await A.post('/api/vendas', { cliente: 'Venda A', valor: 100000, data: '2026-02-01' });
await A.post('/api/extrato', { itens: [{ ext_id: 'nu-2', data: '2026-02-02', valor: 100000, descricao: 'PIX A' }] });
const fuB = (await B.get('/api/followup')).dados, fuC = (await C.get('/api/followup')).dados, fuA2 = (await A.get('/api/followup')).dados;
ok('B vê só os contatos de B', fuB.contatos.length === 2 && fuB.contatos.every(c => /B$/.test(c.nome)));
ok('C vê só os contatos de C', fuC.contatos.length === 2 && fuC.contatos.every(c => /C$/.test(c.nome)));
ok('conta 1 não vê os contatos de B e C', fuA2.contatos.length === 1);
ok('modelos não vazam', fuB.modelos.some(m => m.titulo === 'Modelo B') && !fuB.modelos.some(m => m.titulo === 'Modelo C'));
ok('mensagens de prospecção por conta', (await B.get('/api/config')).dados.msg_semsite === 'Mensagem de B' && (await C.get('/api/config')).dados.msg_semsite === 'Mensagem de C');
ok('dedupe da prospecção é por conta (mesmo nome em 2 contas = 2 registros)', fuB.contatos.some(c => c.nome === 'Barbearia B') && fuC.contatos.some(c => c.nome === 'Barbearia C'));
const clA = (await A.get('/api/clientes')).dados, vA = (await A.get('/api/vendas')).dados, exA = (await A.get('/api/extrato')).dados;
ok('clientes, vendas e extrato da conta 1 continuam funcionando', clA.length === 2 && vA.vendas.length === 2 && exA.length === 2);

// ---- 5) uma conta tenta mexer nos dados da outra ----
console.log('• tentativas de acesso cruzado');
const ctB = fuB.contatos.find(c => c.nome === 'Contato B').id, modB = fuB.modelos.find(m => m.titulo === 'Modelo B').id;
const cliA = clA.find(c => c.nome === 'Cliente A').id, venA = vA.vendas.find(v => v.cliente === 'Venda A').id, exIdA = exA.find(e => e.descricao === 'PIX A').id;
ok('C não altera contato de B (404)', (await C.patch('/api/contatos/' + ctB, { notas: 'hackeado' })).status === 404);
ok('C não registra envio no contato de B (404)', (await C.post('/api/contatos/' + ctB + '/enviei', {})).status === 404);
await C.del('/api/contatos/' + ctB);
ok('C não apaga contato de B', (await B.get('/api/followup')).dados.contatos.some(c => c.id === ctB && c.notas !== 'hackeado'));
ok('conta 1 não altera contato de B (404)', (await A.patch('/api/contatos/' + ctB, { notas: 'hackeado' })).status === 404);
await C.patch('/api/modelos/' + modB, { titulo: 'hack', texto: 'hack' }); await C.del('/api/modelos/' + modB);
ok('C não mexe nos modelos de B', (await B.get('/api/followup')).dados.modelos.some(m => m.id === modB && m.titulo === 'Modelo B'));
ok('assinante não põe link no cliente da conta 1 (403)', (await C.post('/api/clientes/' + cliA + '/links', { titulo: 'x', url: 'https://x.com' })).status === 403);
await C.del('/api/clientes/' + cliA); await C.patch('/api/vendas/' + venA, { pago: true }); await C.del('/api/vendas/' + venA); await C.patch('/api/extrato/' + exIdA, { ignorar: true });
ok('assinante não mexe em clientes, vendas e extrato da conta 1', (await A.get('/api/clientes')).dados.length === 2 && (await A.get('/api/vendas')).dados.vendas.find(v => v.id === venA)?.pago === false && (await A.get('/api/extrato')).dados.find(e => e.id === exIdA)?.ignorar === 0);

// ---- 6) rotas públicas do site continuam caindo na conta 1 ----
console.log('• site da Branco');
await chama('POST', '/lead', { corpo: { lid: 'lead-novo', nome: 'Lead do Site', telefone: '5541977770000', status: 'enviado' } });
await chama('POST', '/t', { corpo: { tipo: 'visita', v: 'v1', p: '/', d: 'Celular' } });
ok('lead do site entra na conta 1', (await A.get('/api/followup')).dados.contatos.some(c => c.nome === 'Lead do Site'));
ok('lead do site não entra nas outras contas', !(await B.get('/api/followup')).dados.contatos.some(c => c.nome === 'Lead do Site'));
ok('visita do site conta para a conta 1', (await A.get('/api/dados?dias=30')).dados.visitas === 1);
ok('a área do cliente por link secreto continua funcionando', (await chama('GET', '/api/cliente/tokentokentokentoken1234')).dados.nome === 'Cliente Site Antigo');

// ---- 7) e-mail, senha e login do dono ----
console.log('• verificação, recuperação e login do dono');
ok('cadastro sem RESEND_KEY devolve o código de verificação (modo teste)', typeof cb.dados.verificar === 'string');
ok('verificar e-mail', (await chama('POST', '/api/conta/verificar', { corpo: { token: cb.dados.verificar } })).status === 200 && (await B.get('/api/sessao')).dados.usuario.verificado === true);
ok('login por e-mail e senha', (await chama('POST', '/api/login', { corpo: { email: 'caio@gama.com', senha: 'senha-caio-123' } })).status === 200);
ok('login com senha errada falha', (await chama('POST', '/api/login', { corpo: { email: 'caio@gama.com', senha: 'senha-errada-1' } })).status === 401);
await chama('POST', '/api/conta/esqueci', { corpo: { email: 'caio@gama.com' } });
const tk = d1._db.prepare("SELECT token FROM tokens_email WHERE tipo = 'senha'").get()?.token;
ok('esqueci a senha gera um código', !!tk);
ok('redefinir senha', (await chama('POST', '/api/conta/redefinir', { corpo: { token: tk, senha: 'senha-nova-456' } })).status === 200);
ok('senha antiga não entra mais', (await chama('POST', '/api/login', { corpo: { email: 'caio@gama.com', senha: 'senha-caio-123' } })).status === 401);
ok('senha nova entra', (await chama('POST', '/api/login', { corpo: { email: 'caio@gama.com', senha: 'senha-nova-456' } })).status === 200);
ok('sessão antiga de C foi derrubada', (await C.get('/api/sessao')).dados.papel === null);
ok('dono cria seu login por e-mail', (await A.post('/api/conta/dono', { nome: 'Dono', email: 'dono@branco.com', senha: 'senha-dono-789' })).status === 200);
const lgD = await chama('POST', '/api/login', { corpo: { email: 'dono@branco.com', senha: 'senha-dono-789' } });
const sD = (await api(lgD.cookie).get('/api/sessao')).dados;
ok('dono por e-mail entra na conta 1 como admin do SaaS', sD.conta.id === 1 && sD.admin === true && sD.site === true);
ok('trocar senha exige a atual', (await api(lgD.cookie).patch('/api/conta', { senha_atual: 'errada', senha_nova: 'outra-senha-99' })).status === 400);
ok('cadastro fechado dá 403', (await worker.fetch(new Request(BASE + '/api/conta/cadastro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: 'Z', email: 'z@z.com', senha: 'senha-zzz-123' }) }), { ...env, CADASTRO_ABERTO: '0' })).status === 403);
ok('pedido vindo de outro site é recusado', (await chama('POST', '/api/contatos', { corpo: { nome: 'x' }, cookie: cb.cookie, origem: 'https://outro.site' })).status === 403);

// ---- 8) assinante só tem follow-up e prospecção; teste grátis de 30 empresas ----
console.log('• acesso do assinante e limite do teste grátis');
const CB2 = api((await chama('POST', '/api/login', { corpo: { email: 'bia@beta.com', senha: 'senha-bia-123' } })).cookie);
for (const rota of ['/api/dados?dias=30', '/api/clientes', '/api/vendas', '/api/extrato']) ok('assinante não acessa ' + rota + ' (403)', (await CB2.get(rota)).status === 403);
ok('conta da Branco continua com tudo', (await A.get('/api/vendas')).status === 200 && (await A.get('/api/clientes')).status === 200);
ok('cadastro vem aberto por padrão', (await chama('GET', '/api/sessao')).dados.cadastro === true);
const sB2 = (await CB2.get('/api/sessao')).dados;
ok('conta nova entra em teste grátis de 30 empresas', sB2.uso.limite === 30 && sB2.uso.usado === 0 && sB2.uso.plano === 'teste' && !!sB2.uso.testeAte && sB2.conta.plano === 'teste');
ok('a conta da Branco não tem limite', sA.uso?.limite === null || (await A.get('/api/sessao')).dados.uso.limite === null);
// OpenStreetMap de mentira: 40 barbearias em Curitiba
const fetchReal = globalThis.fetch;
globalThis.fetch = async (u) => { u = String(u);
  if (u.includes('nominatim')) return Response.json([{ osm_type: 'relation', osm_id: 1, lat: -25.4, lon: -49.3, display_name: 'Curitiba, Paraná, Brasil' }]);
  if (u.includes('overpass')) return Response.json({ elements: Array.from({ length: 40 }, (_, i) => ({ type: 'node', id: i + 1, lat: -25.4, lon: -49.3, tags: { name: 'Barbearia ' + (i + 1), shop: 'hairdresser', phone: '+55 41 9' + String(1000000 + i).padStart(8, '0') } })) });
  return new Response('', { status: 404 }); };
const b1 = (await CB2.get('/api/prospeccao?nicho=barbearia&cidade=Curitiba&estado=Paraná&fonte=osm')).dados;
ok('1ª busca devolve só o que cabe no teste (30 de 40)', b1.total === 30 && b1.uso.usado === 30);
const b2 = await CB2.get('/api/prospeccao?nicho=barbearia&cidade=Curitiba&estado=Paraná&fonte=osm');
ok('repetir a mesma busca não cobra de novo (as 30 já vistas voltam)', b2.status === 200 && b2.dados.total === 30 && b2.dados.uso.usado === 30);
globalThis.fetch = async (u) => { u = String(u);
  if (u.includes('nominatim')) return Response.json([{ osm_type: 'relation', osm_id: 1, lat: -25.4, lon: -49.3, display_name: 'Curitiba, Paraná, Brasil' }]);
  if (u.includes('overpass')) return Response.json({ elements: [{ type: 'node', id: 999, lat: -25.4, lon: -49.3, tags: { name: 'Nova Barbearia', shop: 'hairdresser', phone: '+55 41 988887777' } }] });
  return new Response('', { status: 404 }); };
ok('empresa nova com o limite cheio é bloqueada (402)', (await CB2.get('/api/prospeccao?nicho=barbearia&cidade=Curitiba&estado=Paraná&fonte=osm')).status === 402);
ok('a conta da Branco busca sem limite', (await A.get('/api/prospeccao?nicho=barbearia&cidade=Curitiba&estado=Paraná&fonte=osm')).dados.total === 1);
d1._db.prepare("UPDATE contas SET teste_ate = datetime('now', '-1 day') WHERE id = ?").run(sB2.conta.id);
ok('teste vencido bloqueia a busca (402)', (await CB2.get('/api/prospeccao?nicho=barbearia&cidade=Curitiba&estado=Paraná&fonte=osm')).status === 402);
ok('teste vencido ainda deixa ver o follow-up (dados não somem)', (await CB2.get('/api/followup')).status === 200);
globalThis.fetch = fetchReal;

// ---- 9) painel do SaaS: só o admin ----
console.log('• painel do SaaS');
ok('assinante não vê o painel do SaaS (403)', (await CB2.get('/api/saas')).status === 403);
const sa = (await A.get('/api/saas')).dados;
ok('admin vê as contas (sem a dele) e os indicadores', sa.kpis.contas === 2 && sa.contas.every(c => c.id !== 1) && sa.contas.find(c => c.dono_email === 'bia@beta.com')?.usado === 30 && typeof sa.kpis.mrr === 'number');
const idB = sa.contas.find(c => c.dono_email === 'bia@beta.com').id;
ok('admin troca o plano', (await A.patch('/api/saas/contas/' + idB, { plano: 'pro' })).status === 200 && (await CB2.get('/api/sessao')).dados.uso.limite === 1500);
ok('conta bloqueada não entra', (await A.patch('/api/saas/contas/' + idB, { status: 'bloqueada' })).status === 200 && (await CB2.get('/api/followup')).status === 403);
ok('liberar volta a funcionar', (await A.patch('/api/saas/contas/' + idB, { status: 'ativa' })).status === 200 && (await CB2.get('/api/followup')).status === 200);
ok('+7 dias de teste reativa o teste', (await A.patch('/api/saas/contas/' + idB, { teste_mais_dias: 7 })).status === 200 && (await CB2.get('/api/sessao')).dados.uso.testeAcabou === false);
ok('conta 1 não pode ser alterada por aqui', (await A.patch('/api/saas/contas/1', { status: 'bloqueada' })).status === 400);
const nova = (await A.post('/api/saas/contas', { nome: 'Agência Pixel', email: 'ana@pixel.com', plano: 'start' })).dados;
ok('admin cria conta na mão e recebe a senha (sem e-mail configurado)', nova.ok && typeof nova.senha === 'string');
ok('a conta criada na mão entra', (await chama('POST', '/api/login', { corpo: { email: 'ana@pixel.com', senha: nova.senha } })).status === 200);
ok('admin exclui uma conta e os dados dela somem', (await A.del('/api/saas/contas/' + nova.id)).status === 200 && !d1._db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get('ana@pixel.com') && !d1._db.prepare('SELECT 1 FROM modelos WHERE conta_id = ?').get(nova.id));
ok('o log registra as ações', (await A.get('/api/saas')).dados.log.some(l => /excluída/.test(l.texto)));

// ---- 10) cobrança pelo Mercado Pago (de mentira) ----
console.log('• assinatura (Mercado Pago simulado)');
const CC = api((await chama('POST', '/api/login', { corpo: { email: 'caio@gama.com', senha: 'senha-nova-456' } })).cookie);
ok('sem MP_ACCESS_TOKEN, assinar avisa que não está configurado (503)', (await CC.post('/api/assinatura/criar', { plano: 'start' })).status === 503);
env.MP_ACCESS_TOKEN = 'TEST-token';
const MPDB = {}; let pagos = 0;
globalThis.fetch = async (u, o = {}) => { u = String(u);
  if (!u.startsWith('https://api.mercadopago.com')) return new Response('', { status: 404 });
  const path = u.slice('https://api.mercadopago.com'.length), b = o.body ? JSON.parse(o.body) : {};
  if (path === '/preapproval' && o.method === 'POST') { const id = 'pre_' + Object.keys(MPDB).length; MPDB[id] = { id, status: 'pending', external_reference: b.external_reference, auto_recurring: b.auto_recurring, next_payment_date: null }; return Response.json({ ...MPDB[id], init_point: 'https://mp.test/checkout/' + id }); }
  const mPre = path.match(/^\/preapproval\/([^/?]+)$/);
  if (mPre && o.method === 'PUT') { Object.assign(MPDB[mPre[1]], b); return Response.json(MPDB[mPre[1]]); }
  if (mPre) return MPDB[mPre[1]] ? Response.json(MPDB[mPre[1]]) : new Response('{"message":"not found"}', { status: 404 });
  const mPag = path.match(/^\/authorized_payments\/([^/?]+)$/);
  if (mPag) { const [, preId, st] = mPag[1].split('-'); return Response.json({ id: mPag[1], preapproval_id: preId, status: 'processed', payment: { status: st }, transaction_amount: 29.9, date_created: '2026-10-13T10:00:00.000-03:00' }); }
  return new Response('', { status: 404 }); };
const cr = (await CC.post('/api/assinatura/criar', { plano: 'start' })).dados;
ok('criar assinatura devolve o link do Mercado Pago', cr.ok && cr.url === 'https://mp.test/checkout/pre_0');
ok('a assinatura fica pendente até o pagamento', (await CC.get('/api/assinatura')).dados.atual.status === 'pendente');
ok('assinante não é admin do MP: só o dono assina (B é membro? não — dono) → plano inválido dá 400', (await CC.post('/api/assinatura/criar', { plano: 'teste' })).status === 400);
// o cliente paga: o MP autoriza e manda o webhook
MPDB.pre_0.status = 'authorized'; MPDB.pre_0.next_payment_date = '2026-11-13T10:00:00.000-03:00';
const wh = (tipo, id, extra = {}) => worker.fetch(new Request(BASE + '/webhook/mp', { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify({ type: tipo, data: { id }, action: 'updated', date_created: '2026-10-13T10:00:00Z' }) }), env);
ok('webhook sem segredo configurado é aceito', (await wh('subscription_preapproval', 'pre_0')).status === 200);
const sCa = (await CC.get('/api/sessao')).dados;
ok('plano ativa na conta depois do webhook', sCa.conta.plano === 'start' && sCa.uso.limite === 200 && sCa.uso.testeAte === null);
ok('próxima cobrança registrada', (await CC.get('/api/assinatura')).dados.atual.proximo_pagamento === '2026-11-13 10:00:00');
ok('webhook repetido não faz nada de errado (idempotente)', (await wh('subscription_preapproval', 'pre_0')).status === 200 && (await CC.get('/api/sessao')).dados.conta.plano === 'start');
ok('webhook com id inventado não derruba nada', (await wh('subscription_preapproval', 'pre_999')).status === 200 && (await CC.get('/api/sessao')).dados.conta.plano === 'start');
ok('cobrança aprovada entra no histórico', (await wh('subscription_authorized_payment', 'pag-pre_0-approved')).status === 200 && (await CC.get('/api/assinatura')).dados.cobrancas[0]?.status === 'approved');
// troca de plano: nova assinatura; ao autorizar, a antiga é cancelada no MP
const cr2 = (await CC.post('/api/assinatura/criar', { plano: 'pro' })).dados; MPDB.pre_1.status = 'authorized'; MPDB.pre_1.next_payment_date = '2026-11-13T10:00:00.000-03:00';
await wh('subscription_preapproval', 'pre_1');
ok('troca de plano ativa o novo e cancela o antigo no Mercado Pago', (await CC.get('/api/sessao')).dados.conta.plano === 'pro' && MPDB.pre_0.status === 'cancelled');
// pagamento recusado seguido → MP pausa → conta inadimplente: busca trava, follow-up continua
await wh('subscription_authorized_payment', 'pag-pre_1-rejected');
MPDB.pre_1.status = 'paused'; await wh('subscription_preapproval', 'pre_1');
ok('assinatura pausada deixa a conta inadimplente', (await CC.get('/api/sessao')).dados.uso.inadimplente === true);
globalThis.fetch = (f => async (u, o) => String(u).includes('nominatim') ? Response.json([{ osm_type: 'relation', osm_id: 1, lat: 0, lon: 0, display_name: 'Curitiba' }]) : String(u).includes('overpass') ? Response.json({ elements: [{ type: 'node', id: 5, lat: 0, lon: 0, tags: { name: 'X', shop: 'hairdresser' } }] }) : f(u, o))(globalThis.fetch);
ok('inadimplente não busca (402) mas vê o follow-up', (await CC.get('/api/prospeccao?nicho=barbearia&cidade=Curitiba&estado=PR&fonte=osm')).status === 402 && (await CC.get('/api/followup')).status === 200);
MPDB.pre_1.status = 'authorized'; await wh('subscription_preapproval', 'pre_1'); await wh('subscription_authorized_payment', 'pag-pre_1-approved');
ok('pagamento aprovado depois regulariza', (await CC.get('/api/sessao')).dados.uso.inadimplente === false);
// cancelamento: volta para teste valendo até o fim do período pago
ok('cancelar assinatura', (await CC.post('/api/assinatura/cancelar', {})).status === 200 && MPDB.pre_1.status === 'cancelled');
const sC2 = (await CC.get('/api/sessao')).dados;
ok('depois de cancelar: acesso continua até o fim do período pago', sC2.conta.plano === 'teste' && sC2.uso.testeAte === '2026-11-13 10:00:00' && sC2.uso.testeAcabou === false);
// webhook assinado
env.MP_WEBHOOK_SECRET = 'segredo';
ok('com segredo configurado, webhook sem assinatura é recusado (401)', (await wh('subscription_preapproval', 'pre_1')).status === 401);
const ts = '1700000000', manifesto = `id:pre_1;request-id:req1;ts:${ts};`;
const k = await crypto.subtle.importKey('raw', new TextEncoder().encode('segredo'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const v1 = [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(manifesto)))].map(b => b.toString(16).padStart(2, '0')).join('');
ok('webhook com assinatura certa passa', (await wh('subscription_preapproval', 'pre_1', { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': 'req1' })).status === 200);
ok('webhook com assinatura errada é recusado', (await wh('subscription_preapproval', 'pre_1', { 'x-signature': `ts=${ts},v1=${'0'.repeat(64)}`, 'x-request-id': 'req1' })).status === 401);
delete env.MP_WEBHOOK_SECRET; globalThis.fetch = fetchReal;
ok('conta da Branco não tem assinatura', (await A.get('/api/assinatura')).status === 400);
ok('painel do SaaS mostra o recebido no mês', typeof (await A.get('/api/saas')).dados.kpis.recebidoMes === 'number');

// ---- 12) prospecção nos Estados Unidos ----
console.log('• prospecção nos EUA');
{
  const pedidos = [];
  globalThis.fetch = async (u, o = {}) => { u = String(u); let body = null; try { body = o.body ? JSON.parse(o.body) : null; } catch {} pedidos.push({ u, body });
    if (u.includes('nominatim')) return Response.json([{ osm_type: 'relation', osm_id: 7, lat: 25.76, lon: -80.19, display_name: 'Miami, Miami-Dade County, Florida, United States' }]);
    if (u.includes('overpass')) return Response.json({ elements: [
      { type: 'node', id: 1, lat: 25.7, lon: -80.1, tags: { name: 'Joe Barber', shop: 'hairdresser', phone: '(305) 555-0123', website: 'https://joebarber.test' } },
      { type: 'node', id: 2, lat: 25.7, lon: -80.1, tags: { name: 'Cut & Shave', shop: 'hairdresser', phone: '+1 786-555-0199' } },
      { type: 'node', id: 3, lat: 25.7, lon: -80.1, tags: { name: 'Sem telefone', shop: 'hairdresser', phone: '12345' } }] });
    if (u.startsWith('https://joebarber.test')) return new Response('<html><body><a href="https://wa.me/13055550100">WhatsApp</a> Call us: (305) 555-0199 · <a href="mailto:hi@joebarber.test">mail</a></body></html>', { headers: { 'content-type': 'text/html' } });
    if (u.startsWith('https://places.googleapis.com')) return Response.json({ places: [{ id: 'abc', displayName: { text: 'Miami Fades' }, nationalPhoneNumber: '(305) 555-0177', formattedAddress: '1 Ocean Dr, Miami, FL', businessStatus: 'OPERATIONAL' }] });
    if (u.startsWith('https://google.serper.dev/places')) return Response.json({ places: [{ phoneNumber: '+1 305-555-0155', website: 'https://cutshave.test' }] });
    if (u.startsWith('https://cutshave.test')) return new Response('<html><body>Hours 9-5</body></html>', { headers: { 'content-type': 'text/html' } });
    return new Response('', { status: 404 }); };
  const usR = await A.get('/api/prospeccao?nicho=barbearia&cidade=Miami&estado=Florida&pais=Estados%20Unidos&fonte=osm'); if (usR.status !== 200) console.error('   resposta:', usR.status, JSON.stringify(usR.dados)); const us = usR.dados;
  ok('busca nos EUA devolve os estabelecimentos', us.total === 3 && us.lugar.startsWith('Miami'));
  const joe = us.itens.find(x => x.nome === 'Joe Barber'), cut = us.itens.find(x => x.nome === 'Cut & Shave'), sem = us.itens.find(x => x.nome === 'Sem telefone');
  ok('telefone americano ganha o +1 e não é marcado como celular', joe.telefone === '13055550123' && joe.celular === null && cut.telefone === '17865550199');
  ok('número inválido nos EUA fica vazio', sem.telefone === null);
  ok('o OpenStreetMap recebe o país', pedidos.some(p => p.u.includes('nominatim') && /country=Estados\+?%?2?0?Unidos|country=Estados%20Unidos/.test(p.u)));
  const enr = (await A.post('/api/prospeccao/enriquecer', { pais: 'Estados Unidos', itens: [{ id: joe.id, site: joe.site, nome: joe.nome, cidade: 'Miami' }] })).dados;
  ok('no site do estabelecimento acha o WhatsApp e o e-mail no formato dos EUA', enr[joe.id]?.telefone === '13055550100' && enr[joe.id]?.whatsapp === true && enr[joe.id]?.email === 'hi@joebarber.test');
  env.GOOGLE_PLACES_KEY = 'g-teste';
  const g = (await A.get('/api/prospeccao?nicho=barbearia&cidade=Miami&estado=Florida&pais=Estados%20Unidos&fonte=google')).dados;
  const pedidoG = pedidos.find(p => p.u.startsWith('https://places.googleapis.com'));
  ok('Google Maps nos EUA pergunta em inglês', pedidoG?.body?.textQuery === 'barber shop in Miami, Florida, USA' && pedidoG?.body?.languageCode === 'en-US');
  ok('resultado do Google nos EUA com telefone +1', g.total === 1 && g.itens[0].telefone === '13055550177');
  delete env.GOOGLE_PLACES_KEY; env.SERPER_KEY = 's-teste';
  const enr2 = (await A.post('/api/prospeccao/enriquecer', { pais: 'Estados Unidos', itens: [{ id: cut.id, nome: cut.nome, cidade: 'Miami' }] })).dados;
  const pedidoS = pedidos.find(p => p.u.startsWith('https://google.serper.dev/places'));
  ok('busca no Google (Serper) nos EUA usa gl=us', pedidoS?.body?.gl === 'us' && pedidoS?.body?.hl === 'en');
  ok('telefone vindo do Google nos EUA', enr2[cut.id]?.telefone === '13055550155' && enr2[cut.id]?.google === true);
  delete env.SERPER_KEY;
  const br = (await A.get('/api/prospeccao?nicho=barbearia&cidade=Curitiba&estado=Paraná&fonte=osm'));
  ok('busca no Brasil continua igual (padrão)', br.status === 200 || br.status === 502);
  globalThis.fetch = fetchReal;
}

console.log(`\n${passou} ok, ${falhou} falhou`);
process.exit(falhou ? 1 : 0);
