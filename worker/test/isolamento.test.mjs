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

// ---- 4) cada conta cria seus dados ----
console.log('• dados de cada conta');
for (const [X, n] of [[B, 'B'], [C, 'C']]) {
  await X.post('/api/contatos', { nome: 'Contato ' + n, telefone: '5541988880000' });
  await X.post('/api/clientes', { nome: 'Cliente ' + n, email: n.toLowerCase() + '@cliente.com' });
  await X.post('/api/vendas', { cliente: 'Venda ' + n, valor: 100000, data: '2026-02-01' });
  await X.post('/api/modelos', { titulo: 'Modelo ' + n, texto: 'Texto ' + n });
  await X.post('/api/extrato', { itens: [{ ext_id: 'nu-1', data: '2026-02-02', valor: 100000, descricao: 'PIX ' + n }] }); // mesmo id do banco nas 2 contas
  await X.put('/api/config', { msg_semsite: 'Mensagem de ' + n });
  await X.post('/api/prospeccao/salvar', { itens: [{ nome: 'Barbearia ' + n, telefone: '554199999' + (n === 'B' ? '1111' : '2222'), cidade: 'Curitiba', nicho: 'Barbearia' }] });
}
const fuB = (await B.get('/api/followup')).dados, fuC = (await C.get('/api/followup')).dados, fuA2 = (await A.get('/api/followup')).dados;
ok('B vê só os contatos de B', fuB.contatos.length === 2 && fuB.contatos.every(c => /B$/.test(c.nome)));
ok('C vê só os contatos de C', fuC.contatos.length === 2 && fuC.contatos.every(c => /C$/.test(c.nome)));
ok('conta 1 não vê os contatos de B e C', fuA2.contatos.length === 1);
ok('modelos não vazam', fuB.modelos.some(m => m.titulo === 'Modelo B') && !fuB.modelos.some(m => m.titulo === 'Modelo C'));
const clB = (await B.get('/api/clientes')).dados, clC = (await C.get('/api/clientes')).dados;
ok('clientes isolados', clB.length === 1 && clB[0].nome === 'Cliente B' && clC.length === 1 && clC[0].nome === 'Cliente C');
const vB = (await B.get('/api/vendas')).dados, vC = (await C.get('/api/vendas')).dados;
ok('vendas isoladas', vB.vendas.length === 1 && vB.vendas[0].cliente === 'Venda B' && vC.vendas.length === 1 && vC.vendas[0].cliente === 'Venda C');
const exB = (await B.get('/api/extrato')).dados, exC = (await C.get('/api/extrato')).dados;
ok('extrato: o mesmo id do banco entra nas duas contas', exB.length === 1 && exB[0].descricao === 'PIX B' && exC.length === 1 && exC[0].descricao === 'PIX C');
ok('mensagens de prospecção por conta', (await B.get('/api/config')).dados.msg_semsite === 'Mensagem de B' && (await C.get('/api/config')).dados.msg_semsite === 'Mensagem de C');
ok('dedupe da prospecção é por conta (mesmo nome em 2 contas = 2 registros)', fuB.contatos.some(c => c.nome === 'Barbearia B') && fuC.contatos.some(c => c.nome === 'Barbearia C'));

// ---- 5) uma conta tenta mexer nos dados da outra ----
console.log('• tentativas de acesso cruzado');
const ctB = fuB.contatos.find(c => c.nome === 'Contato B').id, cliB = clB[0].id, venB = vB.vendas[0].id, exIdB = exB[0].id, modB = fuB.modelos.find(m => m.titulo === 'Modelo B').id;
ok('C não altera contato de B (404)', (await C.patch('/api/contatos/' + ctB, { notas: 'hackeado' })).status === 404);
ok('C não registra envio no contato de B (404)', (await C.post('/api/contatos/' + ctB + '/enviei', {})).status === 404);
await C.del('/api/contatos/' + ctB);
ok('C não apaga contato de B', (await B.get('/api/followup')).dados.contatos.some(c => c.id === ctB && c.notas !== 'hackeado'));
ok('C não põe link no cliente de B (404)', (await C.post('/api/clientes/' + cliB + '/links', { titulo: 'x', url: 'https://x.com' })).status === 404);
ok('C não edita cliente de B (404)', (await C.patch('/api/clientes/' + cliB, { nome: 'hackeado' })).status === 404);
await C.del('/api/clientes/' + cliB);
ok('C não apaga cliente de B', (await B.get('/api/clientes')).dados.length === 1 && (await B.get('/api/clientes')).dados[0].nome === 'Cliente B');
await C.patch('/api/vendas/' + venB, { pago: true }); await C.del('/api/vendas/' + venB);
ok('C não marca nem apaga venda de B', (await B.get('/api/vendas')).dados.vendas[0]?.pago === false);
await C.patch('/api/extrato/' + exIdB, { ignorar: true }); await C.del('/api/extrato/' + exIdB);
ok('C não mexe no extrato de B', (await B.get('/api/extrato')).dados[0]?.ignorar === 0);
await C.patch('/api/modelos/' + modB, { titulo: 'hack', texto: 'hack' }); await C.del('/api/modelos/' + modB);
ok('C não mexe nos modelos de B', (await B.get('/api/followup')).dados.modelos.some(m => m.id === modB && m.titulo === 'Modelo B'));
ok('conta sem visão do site não vê dados do site de outra', (await B.get('/api/dados?dias=30')).dados.visitas === 0);

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

console.log(`\n${passou} ok, ${falhou} falhou`);
process.exit(falhou ? 1 : 0);
