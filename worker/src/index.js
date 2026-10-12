/* BRANCO — Worker do painel (servidor + banco de dados + páginas)
 *
 * Precisa de:
 *   - banco D1 ligado com o nome  DB
 *   - variável secreta            ADMIN_SENHA   (senha do painel)
 * As tabelas são criadas sozinhas no primeiro acesso.
 *
 * Rotas públicas (usadas pelo site):  POST /t  POST /lead  GET /status  GET /chat.js  GET /c.js  POST /c
 * Painel:                              GET /admin  +  /api/*
 * Área do cliente:                     GET /cliente/<código>
 */

const PAINEL_HTML = __PAINEL__;
const CLIENTE_HTML = __CLIENTE__;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS eventos (id INTEGER PRIMARY KEY, tipo TEXT NOT NULL, v TEXT, p TEXT, o TEXT, d TEXT, criado_em TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS ev_data ON eventos (criado_em)`,
  `CREATE INDEX IF NOT EXISTS ev_tipo ON eventos (tipo, criado_em)`,
  `CREATE TABLE IF NOT EXISTS contatos (id INTEGER PRIMARY KEY, lid TEXT UNIQUE, v TEXT, nome TEXT, telefone TEXT, empresa TEXT, projeto TEXT, mensagem TEXT,
     status TEXT NOT NULL DEFAULT 'parcial', origem TEXT, venda TEXT NOT NULL DEFAULT 'novo', contatos INTEGER NOT NULL DEFAULT 0, ultimo_contato TEXT, proximo_contato TEXT,
     notas TEXT, proposta INTEGER, criado_em TEXT NOT NULL DEFAULT (datetime('now')), atualizado_em TEXT)`,
  `CREATE INDEX IF NOT EXISTS ct_data ON contatos (criado_em)`,
  `CREATE TABLE IF NOT EXISTS modelos (id INTEGER PRIMARY KEY, titulo TEXT NOT NULL, texto TEXT NOT NULL, criado_em TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS vendas (id INTEGER PRIMARY KEY, cliente TEXT NOT NULL, servico TEXT, valor INTEGER NOT NULL DEFAULT 0, mensal INTEGER NOT NULL DEFAULT 0,
     data TEXT NOT NULL, fim TEXT, pago INTEGER NOT NULL DEFAULT 0, notas TEXT, contato_id INTEGER, criado_em TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS clientes (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, email TEXT, projeto TEXT, site_url TEXT, etapa INTEGER NOT NULL DEFAULT 1, recado TEXT,
     site TEXT UNIQUE NOT NULL, token TEXT UNIQUE NOT NULL, criado_em TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS links (id INTEGER PRIMARY KEY, cliente_id INTEGER NOT NULL, titulo TEXT NOT NULL, url TEXT NOT NULL, criado_em TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS visitas_cliente (id INTEGER PRIMARY KEY, site TEXT NOT NULL, v TEXT, p TEXT, criado_em TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS vc_site ON visitas_cliente (site, criado_em)`,
  `CREATE TABLE IF NOT EXISTS sessoes (token TEXT PRIMARY KEY, criado_em TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT)`,
];
const MODELOS_INICIAIS = [
  ['Primeiro contato', 'Oi, {nome}! Aqui é da Branco 👋 Vi que você se interessou por {projeto}. Posso te fazer umas perguntas rápidas para montar sua proposta?'],
  ['Lembrete · 2 dias', 'Oi, {nome}! Passando para saber se ficou alguma dúvida sobre {projeto}. Fico à disposição 😊'],
  ['Lembrete · 7 dias', 'Oi, {nome}! Ainda pensando em {projeto} para {empresa}? Se quiser, te mostro alguns projetos parecidos que já fizemos.'],
  ['Último contato · 15 dias', 'Oi, {nome}! Vou encerrar seu atendimento por aqui, tudo bem? Quando quiser retomar {projeto}, é só me chamar.'],
];
const ETAPAS_VENDA = ['novo', 'conversando', 'proposta', 'fechou', 'perdido'];
const LEMBRETES = [2, 7, 15]; // dias até o próximo lembrete depois de cada mensagem

// colunas que cada tabela precisa ter: se o banco veio de uma versão antiga, as que faltam são criadas (nada é apagado)
const COLUNAS = {
  eventos: ['tipo', 'v', 'p', 'o', 'd', 'criado_em'],
  contatos: ['lid', 'v', 'nome', 'telefone', 'empresa', 'projeto', 'mensagem', 'status', 'origem', 'venda', 'contatos INTEGER', 'ultimo_contato', 'proximo_contato', 'notas', 'proposta INTEGER', 'criado_em', 'atualizado_em'],
  modelos: ['titulo', 'texto', 'criado_em'],
  vendas: ['cliente', 'servico', 'valor INTEGER', 'mensal INTEGER', 'data', 'fim', 'pago INTEGER', 'notas', 'contato_id INTEGER', 'criado_em'],
  clientes: ['nome', 'email', 'projeto', 'site_url', 'etapa INTEGER', 'recado', 'site', 'token', 'criado_em'],
  links: ['cliente_id INTEGER', 'titulo', 'url', 'criado_em'],
  visitas_cliente: ['site', 'v', 'p', 'o', 'd', 'criado_em'],
  sessoes: ['token', 'criado_em'],
};
async function migra(db) {
  const tabelas = Object.keys(COLUNAS);
  const info = await db.batch(tabelas.map(t => db.prepare(`PRAGMA table_info(${t})`)));
  const alter = [];
  tabelas.forEach((t, i) => {
    const tem = new Set(info[i].results.map(c => c.name));
    COLUNAS[t].forEach(c => { const [nome, tipo = 'TEXT'] = c.split(' '); if (!tem.has(nome)) alter.push(db.prepare(`ALTER TABLE ${t} ADD COLUMN ${nome} ${tipo}`)); });
  });
  if (alter.length) await db.batch(alter);
  // clientes antigos ganham código da área do cliente e do contador
  const sem = await db.prepare("SELECT id, site, token FROM clientes WHERE token IS NULL OR token = '' OR site IS NULL OR site = ''").all();
  if (sem.results.length) await db.batch(sem.results.map(c => db.prepare('UPDATE clientes SET token = ?, site = ? WHERE id = ?')
    .bind(c.token || aleatorio(24), c.site || aleatorio(10), c.id)));
  await db.prepare('CREATE INDEX IF NOT EXISTS cl_token ON clientes (token)').run();
}

let pronto = null;
async function prepara(db) {
  if (!pronto) pronto = (async () => {
    await db.batch(SCHEMA.map(s => db.prepare(s)));
    await migra(db);
    const { n } = await db.prepare('SELECT COUNT(*) n FROM modelos').first();
    if (!n) await db.batch(MODELOS_INICIAIS.map(m => db.prepare('INSERT INTO modelos (titulo, texto) VALUES (?, ?)').bind(...m)));
  })().catch(e => { pronto = null; throw e; });
  return pronto;
}

/* ---------- utilidades ---------- */
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (d, s = 200, h = {}) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...h } });
const erro = (m, s = 400) => json({ erro: m }, s);
const html = (t, h = {}) => new Response(t, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', ...h } });
const js = t => new Response(t, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300', ...CORS } });
const txt = (s, max) => { s = String(s ?? '').trim(); return s ? s.slice(0, max) : null; };
const digitos = s => String(s ?? '').replace(/\D/g, '').slice(0, 13) || null;
const inteiro = (v, min, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null; };
const dataOk = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : null;
const urlOk = s => { try { const u = new URL(String(s || '').trim()); return /^https?:$/.test(u.protocol) ? u.href.slice(0, 500) : null; } catch { return null; } };
const aleatorio = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
async function corpo(req) { try { return JSON.parse(await req.text() || '{}') || {}; } catch { return {}; } }
function iguais(a, b) { // comparação de senha em tempo constante
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length; for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0); return d === 0;
}
const cookie = (req, nome) => (req.headers.get('Cookie') || '').split(/;\s*/).map(c => c.split('=')).find(c => c[0] === nome)?.[1];

async function logado(req, db) {
  const t = cookie(req, 'bsess'); if (!t || t.length !== 40) return false;
  const s = await db.prepare("SELECT 1 FROM sessoes WHERE token = ? AND criado_em > datetime('now','-30 days')").bind(t).first();
  return !!s;
}

/* ---------- rotas públicas ---------- */
const TIPOS = new Set(['visita', 'whatsapp', 'form_aberto', 'form_enviado', 'chat']);
async function rotaEvento(req, db) {
  const b = await corpo(req);
  if (!TIPOS.has(b.tipo)) return new Response(null, { status: 204, headers: CORS });
  await db.prepare("INSERT INTO eventos (tipo, v, p, o, d, criado_em) VALUES (?, ?, ?, ?, ?, datetime('now'))")
    .bind(b.tipo, txt(b.v, 40), txt(b.p, 200), txt(b.o, 60)?.toLowerCase() ?? null, txt(b.d, 20)).run();
  return new Response(null, { status: 204, headers: CORS });
}
async function rotaLead(req, db) {
  const b = await corpo(req), lid = txt(b.lid, 40), nome = txt(b.nome, 100);
  if (!lid || !nome) return new Response(null, { status: 204, headers: CORS });
  const status = b.status === 'enviado' ? 'enviado' : 'parcial';
  const val = [nome, digitos(b.telefone), txt(b.empresa, 120), txt(b.projeto, 80), txt(b.mensagem, 2000)];
  const ja = await db.prepare('SELECT id FROM contatos WHERE lid = ?').bind(lid).first();
  if (ja) await db.prepare(`UPDATE contatos SET nome = ?, telefone = COALESCE(?, telefone), empresa = COALESCE(?, empresa), projeto = COALESCE(?, projeto),
      mensagem = COALESCE(?, mensagem), atualizado_em = datetime('now'), status = CASE WHEN status = 'enviado' THEN 'enviado' ELSE ? END WHERE id = ?`).bind(...val, status, ja.id).run();
  else await db.prepare(`INSERT INTO contatos (lid, v, nome, telefone, empresa, projeto, mensagem, status, origem, venda, contatos, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'site', 'novo', 0, datetime('now'))`).bind(lid, txt(b.v, 40), ...val, status).run();
  return new Response(null, { status: 204, headers: CORS });
}
async function rotaStatus(db) {
  const r = await db.prepare("SELECT chave, valor FROM config WHERE chave IN ('manutencao','mensagem')").all();
  const c = Object.fromEntries(r.results.map(x => [x.chave, x.valor]));
  return json({ manutencao: c.manutencao === '1', mensagem: c.mensagem || '' }, 200, { ...CORS, 'Cache-Control': 'max-age=30' });
}
const contadorCliente = origem => `(()=>{try{var s=new URL(document.currentScript.src).searchParams.get('s');if(!s||sessionStorage.getItem('bcv'))return;sessionStorage.setItem('bcv','1');
var v=localStorage.getItem('bcid')||(crypto.randomUUID?crypto.randomUUID():String(Math.random()).slice(2));localStorage.setItem('bcid',v);
var r=document.referrer&&document.referrer.indexOf(location.host)<0?new URL(document.referrer).hostname.replace('www.',''):null,q=new URLSearchParams(location.search);
fetch('${origem}/c',{method:'POST',keepalive:true,headers:{'Content-Type':'text/plain'},body:JSON.stringify({s:s,v:v,p:location.pathname,o:q.get('utm_source')||r,d:/Mobi|Android|iPhone/i.test(navigator.userAgent)?'Celular':'Computador'})}).catch(function(){})}catch(e){}})();`;
async function rotaVisitaCliente(req, db) {
  const b = await corpo(req), s = txt(b.s, 20);
  if (s && await db.prepare('SELECT 1 FROM clientes WHERE site = ?').bind(s).first())
    await db.prepare("INSERT INTO visitas_cliente (site, v, p, o, d, criado_em) VALUES (?, ?, ?, ?, ?, datetime('now'))").bind(s, txt(b.v, 40), txt(b.p, 200), txt(b.o, 60)?.toLowerCase() ?? null, txt(b.d, 20)).run();
  return new Response(null, { status: 204, headers: CORS });
}

/* ---------- painel: números do site ---------- */
async function dados(db, dias) {
  const desde = `-${dias} days`, q = (sql, ...a) => db.prepare(sql).bind(desde, ...a);
  const [tot, porDia, origens, disp, cads, lista] = await db.batch([
    q(`SELECT SUM(tipo='visita') visitas, COUNT(DISTINCT CASE WHEN tipo='visita' THEN v END) unicos, SUM(tipo='whatsapp') whatsapp,
       SUM(tipo='form_aberto') formAberto, SUM(tipo='chat') chat FROM eventos WHERE criado_em >= datetime('now', ?)`),
    q(`SELECT date(criado_em) dia, SUM(tipo='visita') visitas, SUM(tipo='whatsapp') whats FROM eventos WHERE criado_em >= datetime('now', ?) GROUP BY dia ORDER BY dia`),
    q(`SELECT COALESCE(o,'direto') origem, COUNT(*) n FROM eventos WHERE tipo='visita' AND criado_em >= datetime('now', ?) GROUP BY origem ORDER BY n DESC LIMIT 12`),
    q(`SELECT COALESCE(d,'—') d, COUNT(*) n FROM eventos WHERE tipo='visita' AND criado_em >= datetime('now', ?) GROUP BY d ORDER BY n DESC`),
    q(`SELECT COUNT(*) cadastros, SUM(COALESCE(status,'enviado')<>'parcial') enviados FROM contatos WHERE COALESCE(origem,'site')='site' AND criado_em >= datetime('now', ?)`),
    q(`SELECT id, nome, empresa, telefone, projeto, mensagem, COALESCE(status,'enviado') status, criado_em FROM contatos WHERE COALESCE(origem,'site')='site' AND criado_em >= datetime('now', ?) ORDER BY criado_em DESC LIMIT 500`),
  ]);
  const t = tot.results[0] || {}, c = cads.results[0] || {};
  return { dias, visitas: t.visitas || 0, unicos: t.unicos || 0, whatsapp: t.whatsapp || 0, formAberto: t.formAberto || 0, chat: t.chat || 0,
    cadastros: c.cadastros || 0, enviados: c.enviados || 0, porDia: porDia.results, origens: origens.results, dispositivos: disp.results, lista: lista.results };
}

/* ---------- painel: clientes ---------- */
async function listaClientes(db) {
  const [cs, ls] = await db.batch([
    db.prepare(`SELECT c.*, COALESCE(c.etapa,1) etapa, (SELECT COUNT(*) FROM visitas_cliente v WHERE v.site = c.site AND v.criado_em >= datetime('now','-30 days')) visitas30 FROM clientes c ORDER BY c.criado_em DESC`),
    db.prepare('SELECT id, cliente_id, titulo, url FROM links ORDER BY id'),
  ]);
  return cs.results.map(c => ({ ...c, links: ls.results.filter(l => l.cliente_id === c.id) }));
}

/* ---------- roteador da API do painel ---------- */
async function api(req, db, env, caminho) {
  const m = req.method, seg = caminho.split('/').filter(Boolean).slice(1); // ['clientes','3','links']
  const [rec, id, sub] = [seg[0], seg[1] ? Number(seg[1]) : null, seg[2]];

  if (rec === 'login' && m === 'POST') {
    const b = await corpo(req);
    if (!env.ADMIN_SENHA) return erro('Configure a variável ADMIN_SENHA no Worker.', 500);
    if (!iguais(String(b.senha || ''), env.ADMIN_SENHA)) { await new Promise(r => setTimeout(r, 600)); return erro('Senha errada.', 401); }
    const t = aleatorio(40);
    await db.batch([db.prepare("INSERT INTO sessoes (token, criado_em) VALUES (?, datetime('now'))").bind(t), db.prepare("DELETE FROM sessoes WHERE criado_em < datetime('now','-30 days')")]);
    return json({ ok: true }, 200, { 'Set-Cookie': `bsess=${t}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` });
  }
  if (rec === 'sessao') return json({ papel: await logado(req, db) ? 'admin' : null });
  if (rec === 'sair') {
    const t = cookie(req, 'bsess'); if (t) await db.prepare('DELETE FROM sessoes WHERE token = ?').bind(t).run();
    return json({ ok: true }, 200, { 'Set-Cookie': 'bsess=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' });
  }
  if (!await logado(req, db)) return erro('Faça login.', 401);
  const b = ['POST', 'PATCH', 'PUT'].includes(m) ? await corpo(req) : {};

  // números do site
  if (rec === 'dados') return json(await dados(db, inteiro(new URL(req.url).searchParams.get('dias'), 1, 730) || 30));

  // configurações (aviso de manutenção)
  if (rec === 'config') {
    if (m === 'PUT') await db.batch([['manutencao', b.manutencao ? '1' : '0'], ['mensagem', txt(b.mensagem, 300) || '']]
      .map(x => db.prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').bind(...x)));
    return rotaStatus(db);
  }

  // clientes
  if (rec === 'clientes') {
    if (m === 'GET' && !id) return json(await listaClientes(db));
    if (m === 'POST' && !id) {
      const nome = txt(b.nome, 100); if (!nome) return erro('Coloque o nome do cliente.');
      await db.prepare("INSERT INTO clientes (nome, email, projeto, site_url, site, token, etapa, criado_em) VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))")
        .bind(nome, txt(b.email, 160)?.toLowerCase() ?? null, txt(b.projeto, 120), urlOk(b.site_url), aleatorio(10), aleatorio(24)).run();
      return json({ ok: true });
    }
    if (id && sub === 'links' && m === 'POST') {
      const titulo = txt(b.titulo, 100), url = urlOk(b.url); if (!titulo || !url) return erro('Coloque um título e um link começando com https://');
      await db.prepare("INSERT INTO links (cliente_id, titulo, url, criado_em) VALUES (?, ?, ?, datetime('now'))").bind(id, titulo, url).run(); return json({ ok: true });
    }
    if (id && m === 'PATCH') {
      const campos = [], val = [];
      if ('nome' in b) { const n = txt(b.nome, 100); if (!n) return erro('O nome não pode ficar vazio.'); campos.push('nome = ?'); val.push(n); }
      if ('email' in b) { campos.push('email = ?'); val.push(txt(b.email, 160)?.toLowerCase() ?? null); }
      if ('projeto' in b) { campos.push('projeto = ?'); val.push(txt(b.projeto, 120)); }
      if ('site_url' in b) { campos.push('site_url = ?'); val.push(urlOk(b.site_url)); }
      if ('etapa' in b) { campos.push('etapa = ?'); val.push(inteiro(b.etapa, 1, 5) || 1); }
      if ('recado' in b) { campos.push('recado = ?'); val.push(txt(b.recado, 3000)); }
      if (campos.length) await db.prepare(`UPDATE clientes SET ${campos.join(', ')} WHERE id = ?`).bind(...val, id).run();
      return json({ ok: true });
    }
    if (id && m === 'DELETE') {
      const c = await db.prepare('SELECT site FROM clientes WHERE id = ?').bind(id).first();
      await db.batch([db.prepare('DELETE FROM links WHERE cliente_id = ?').bind(id), db.prepare('DELETE FROM clientes WHERE id = ?').bind(id),
        db.prepare('DELETE FROM visitas_cliente WHERE site = ?').bind(c?.site || '')]);
      return json({ ok: true });
    }
  }
  if (rec === 'links' && id && m === 'DELETE') { await db.prepare('DELETE FROM links WHERE id = ?').bind(id).run(); return json({ ok: true }); }

  // follow-up
  if (rec === 'followup' && m === 'GET') {
    const [c, mo] = await db.batch([
      db.prepare(`SELECT id, nome, empresa, telefone, projeto, mensagem, COALESCE(status,'enviado') status, origem, COALESCE(venda,'novo') venda, COALESCE(contatos,0) contatos,
        ultimo_contato, proximo_contato, notas, proposta, criado_em FROM contatos ORDER BY (COALESCE(venda,'novo') IN ('fechou','perdido')), COALESCE(proximo_contato, '0000'), criado_em DESC`),
      db.prepare('SELECT id, titulo, texto FROM modelos ORDER BY id')]);
    return json({ contatos: c.results, modelos: mo.results });
  }
  if (rec === 'contatos') {
    if (m === 'POST' && !id) {
      const nome = txt(b.nome, 100); if (!nome) return erro('Coloque o nome.');
      await db.prepare("INSERT INTO contatos (lid, nome, telefone, projeto, notas, status, origem, venda, contatos, criado_em) VALUES (?, ?, ?, ?, ?, 'enviado', 'manual', 'novo', 0, datetime('now'))")
        .bind('m-' + aleatorio(16), nome, digitos(b.telefone), txt(b.projeto, 80), txt(b.notas, 2000)).run();
      return json({ ok: true });
    }
    if (id && sub === 'enviei' && m === 'POST') {
      const c = await db.prepare('SELECT contatos FROM contatos WHERE id = ?').bind(id).first(); if (!c) return erro('Contato não encontrado.', 404);
      const n = (c.contatos || 0) + 1, hoje = dataOk(b.hoje) || new Date().toISOString().slice(0, 10), dias = LEMBRETES[n - 1];
      await db.prepare(`UPDATE contatos SET contatos = ?, ultimo_contato = datetime('now'), proximo_contato = ${dias ? "date(?, '+' || ? || ' days')" : 'NULL'},
        venda = CASE WHEN COALESCE(venda,'novo') = 'novo' THEN 'conversando' ELSE venda END WHERE id = ?`).bind(...(dias ? [n, hoje, dias, id] : [n, id])).run();
      return json({ ok: true });
    }
    if (id && m === 'PATCH') {
      const campos = [], val = [];
      if ('venda' in b && ETAPAS_VENDA.includes(b.venda)) { campos.push('venda = ?'); val.push(b.venda); }
      if ('proximo_contato' in b) { campos.push('proximo_contato = ?'); val.push(dataOk(b.proximo_contato)); }
      if ('notas' in b) { campos.push('notas = ?'); val.push(txt(b.notas, 2000)); }
      if ('proposta' in b) { campos.push('proposta = ?'); val.push(b.proposta == null ? null : inteiro(b.proposta, 0, 1e11)); }
      if (campos.length) await db.prepare(`UPDATE contatos SET ${campos.join(', ')}, atualizado_em = datetime('now') WHERE id = ?`).bind(...val, id).run();
      return json({ ok: true });
    }
    if (id && m === 'DELETE') { await db.prepare('DELETE FROM contatos WHERE id = ?').bind(id).run(); return json({ ok: true }); }
  }
  if (rec === 'modelos') {
    if (m === 'GET') return json((await db.prepare('SELECT id, titulo, texto FROM modelos ORDER BY id').all()).results);
    const titulo = txt(b.titulo, 60), texto = txt(b.texto, 1000);
    if (m === 'POST' && !id) { if (!titulo || !texto) return erro('Coloque título e texto.'); await db.prepare("INSERT INTO modelos (titulo, texto, criado_em) VALUES (?, ?, datetime('now'))").bind(titulo, texto).run(); return json({ ok: true }); }
    if (id && m === 'PATCH') { if (!titulo || !texto) return erro('Coloque título e texto.'); await db.prepare('UPDATE modelos SET titulo = ?, texto = ? WHERE id = ?').bind(titulo, texto, id).run(); return json({ ok: true }); }
    if (id && m === 'DELETE') { await db.prepare('DELETE FROM modelos WHERE id = ?').bind(id).run(); return json({ ok: true }); }
  }

  // financeiro
  if (rec === 'vendas') {
    if (m === 'GET') {
      const [v, ng] = await db.batch([db.prepare('SELECT * FROM vendas ORDER BY data DESC, id DESC'),
        db.prepare("SELECT COUNT(*) qtd, COALESCE(SUM(proposta),0) total FROM contatos WHERE COALESCE(venda,'novo') = 'proposta'")]);
      return json({ vendas: v.results.map(x => ({ ...x, valor: x.valor || 0, mensal: x.mensal || 0, pago: !!x.pago })), negociacao: ng.results[0] });
    }
    if (id && m === 'DELETE') { await db.prepare('DELETE FROM vendas WHERE id = ?').bind(id).run(); return json({ ok: true }); }
    if (id && m === 'PATCH' && Object.keys(b).length === 1 && 'pago' in b) { await db.prepare('UPDATE vendas SET pago = ? WHERE id = ?').bind(b.pago ? 1 : 0, id).run(); return json({ ok: true }); }
    if (m === 'POST' || (id && m === 'PATCH')) {
      const cliente = txt(b.cliente, 120), data = dataOk(b.data);
      if (!cliente) return erro('Coloque o nome do cliente.'); if (!data) return erro('Coloque a data da venda.');
      const val = [cliente, txt(b.servico, 80), inteiro(b.valor, 0, 1e11) || 0, inteiro(b.mensal, 0, 1e11) || 0, data, dataOk(b.fim), b.pago ? 1 : 0, txt(b.notas, 1000), inteiro(b.contato_id, 1, 1e12)];
      if (id) await db.prepare('UPDATE vendas SET cliente=?, servico=?, valor=?, mensal=?, data=?, fim=?, pago=?, notas=?, contato_id=? WHERE id = ?').bind(...val, id).run();
      else await db.prepare("INSERT INTO vendas (cliente, servico, valor, mensal, data, fim, pago, notas, contato_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))").bind(...val).run();
      return json({ ok: true });
    }
  }
  return erro('Rota não encontrada.', 404);
}

/* ---------- área do cliente (link secreto) ---------- */
async function apiCliente(db, token, dias) {
  if (!token || token.length < 10) return erro('Link inválido.', 404);
  const c = await db.prepare('SELECT id, nome, projeto, site_url, COALESCE(etapa,1) etapa, recado, site FROM clientes WHERE token = ?').bind(token).first();
  if (!c) return erro('Link inválido.', 404);
  const desde = `-${dias} days`, q = sql => db.prepare(sql).bind(c.site, desde);
  const [ls, porDia, tot, orig, disp, pag] = await db.batch([
    db.prepare('SELECT titulo, url FROM links WHERE cliente_id = ? ORDER BY id').bind(c.id),
    q("SELECT date(criado_em) dia, COUNT(*) visitas, COUNT(DISTINCT v) pessoas FROM visitas_cliente WHERE site = ? AND criado_em >= datetime('now', ?) GROUP BY dia ORDER BY dia"),
    q("SELECT COUNT(*) visitas, COUNT(DISTINCT v) pessoas FROM visitas_cliente WHERE site = ? AND criado_em >= datetime('now', ?)"),
    q("SELECT COALESCE(o,'direto') origem, COUNT(*) n FROM visitas_cliente WHERE site = ? AND criado_em >= datetime('now', ?) GROUP BY origem ORDER BY n DESC LIMIT 8"),
    q("SELECT COALESCE(d,'—') d, COUNT(*) n FROM visitas_cliente WHERE site = ? AND criado_em >= datetime('now', ?) GROUP BY d ORDER BY n DESC"),
    q("SELECT COALESCE(p,'/') pagina, COUNT(*) n FROM visitas_cliente WHERE site = ? AND criado_em >= datetime('now', ?) GROUP BY pagina ORDER BY n DESC LIMIT 6"),
  ]);
  const t = tot.results[0] || {};
  return json({ nome: c.nome, projeto: c.projeto, site_url: c.site_url, etapa: c.etapa, recado: c.recado, links: ls.results, dias,
    visitas: t.visitas || 0, pessoas: t.pessoas || 0, porDia: porDia.results, origens: orig.results, dispositivos: disp.results, paginas: pag.results, contador: !!(t.visitas) });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), p = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (!env.DB) return new Response('Falta ligar o banco D1 com o nome DB neste Worker.', { status: 500 });
    try {
      await prepara(env.DB);
      if (p === '/t' && req.method === 'POST') return await rotaEvento(req, env.DB);
      if (p === '/lead' && req.method === 'POST') return await rotaLead(req, env.DB);
      if (p === '/c' && req.method === 'POST') return await rotaVisitaCliente(req, env.DB);
      if (p === '/status') return await rotaStatus(env.DB);
      if (p === '/c.js') return js(contadorCliente(url.origin));
      if (p === '/chat.js') return js('/* assistente: desativado nesta versão */');
      if (p === '/admin') return html(PAINEL_HTML);
      if (p.startsWith('/api/cliente/')) { // usado também pela área do cliente dentro do site (outro domínio)
        const r = await apiCliente(env.DB, p.split('/')[3] || '', inteiro(url.searchParams.get('dias'), 1, 365) || 30);
        Object.entries(CORS).forEach(([k, v]) => r.headers.set(k, v)); return r;
      }
      if (p.startsWith('/api/')) return await api(req, env.DB, env, p);
      if (p.startsWith('/cliente/')) return html(CLIENTE_HTML);
      if (p === '/') return Response.redirect(url.origin + '/admin', 302);
      return new Response('Não encontrado', { status: 404 });
    } catch (e) {
      console.error(e);
      return p.startsWith('/api/') ? erro('Erro no servidor. Tente de novo.', 500) : new Response('Erro no servidor', { status: 500, headers: CORS });
    }
  },
};
