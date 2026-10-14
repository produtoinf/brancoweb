/* BRANCO — Worker do painel (servidor + banco de dados + páginas)
 *
 * Precisa de:
 *   - banco D1 ligado com o nome  DB
 *   - variável secreta            ADMIN_SENHA   (senha do dono: entra na conta 1 sem e-mail)
 *   - opcionais: BREVO_KEY (ou RESEND_KEY) + EMAIL_DE para enviar e-mails; CADASTRO_ABERTO=0 fecha o cadastro
 *   - cobrança: MP_ACCESS_TOKEN (Mercado Pago) e MP_WEBHOOK_SECRET (assinatura dos webhooks, opcional mas recomendado)
 * As tabelas são criadas sozinhas no primeiro acesso.
 *
 * Multi-conta: cada registro tem conta_id e toda consulta do painel filtra pela conta da sessão.
 * A conta 1 é a da Branco (recebe os eventos e leads do site).
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
  `CREATE TABLE IF NOT EXISTS limites (chave TEXT PRIMARY KEY, n INTEGER NOT NULL, ate TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS extrato (id INTEGER PRIMARY KEY, ext_id TEXT UNIQUE NOT NULL, data TEXT NOT NULL, valor INTEGER NOT NULL, descricao TEXT,
     venda_id INTEGER, ignorar INTEGER NOT NULL DEFAULT 0, criado_em TEXT NOT NULL DEFAULT (datetime('now')))`,
  // contas (SaaS): cada assinante é uma conta; usuários entram em contas com um papel
  `CREATE TABLE IF NOT EXISTS contas (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, plano TEXT NOT NULL DEFAULT 'start', status TEXT NOT NULL DEFAULT 'ativa', criado_em TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, senha TEXT NOT NULL, nome TEXT, verificado INTEGER NOT NULL DEFAULT 0, admin_saas INTEGER NOT NULL DEFAULT 0, criado_em TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS membros (conta_id INTEGER NOT NULL, usuario_id INTEGER NOT NULL, papel TEXT NOT NULL DEFAULT 'membro', criado_em TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (conta_id, usuario_id))`,
  `CREATE TABLE IF NOT EXISTS tokens_email (token TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL, tipo TEXT NOT NULL, expira TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS config_conta (conta_id INTEGER NOT NULL, chave TEXT NOT NULL, valor TEXT, PRIMARY KEY (conta_id, chave))`,
  `CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY, nivel TEXT NOT NULL, conta_id INTEGER, texto TEXT NOT NULL, criado_em TEXT NOT NULL DEFAULT (datetime('now')))`,
  // consumo: empresas encontradas por conta e por ciclo (mês), e quais já foram contadas (não cobra 2x a mesma empresa)
  `CREATE TABLE IF NOT EXISTS uso (conta_id INTEGER NOT NULL, ciclo TEXT NOT NULL, encontradas INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (conta_id, ciclo))`,
  `CREATE TABLE IF NOT EXISTS empresas_vistas (conta_id INTEGER NOT NULL, chave TEXT NOT NULL, criado_em TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (conta_id, chave))`,
  // cobrança (Mercado Pago): uma assinatura por conta; cada cobrança mensal vira uma linha em cobrancas
  `CREATE TABLE IF NOT EXISTS assinaturas (id INTEGER PRIMARY KEY, conta_id INTEGER NOT NULL, plano TEXT NOT NULL, gateway TEXT NOT NULL DEFAULT 'mp', gateway_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'pendente',
     valor INTEGER NOT NULL DEFAULT 0, proximo_pagamento TEXT, ultimo_pagamento TEXT, criado_em TEXT NOT NULL DEFAULT (datetime('now')), atualizado_em TEXT)`,
  `CREATE TABLE IF NOT EXISTS cobrancas (id INTEGER PRIMARY KEY, conta_id INTEGER NOT NULL, assinatura_id INTEGER, gateway_id TEXT UNIQUE NOT NULL, status TEXT NOT NULL, valor INTEGER NOT NULL DEFAULT 0, data TEXT, criado_em TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS webhooks (chave TEXT PRIMARY KEY, recebido_em TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS ex_data ON extrato (data)`,
];
const MODELOS_INICIAIS = [
  ['Primeiro contato', 'Oi, {nome}! Aqui é da Branco 👋 Vi que você se interessou por {projeto}. Posso te fazer umas perguntas rápidas para montar sua proposta?'],
  ['Lembrete · 2 dias', 'Oi, {nome}! Passando para saber se ficou alguma dúvida sobre {projeto}. Fico à disposição 😊'],
  ['Lembrete · 7 dias', 'Oi, {nome}! Ainda pensando em {projeto} para {empresa}? Se quiser, te mostro alguns projetos parecidos que já fizemos.'],
  ['Último contato · 15 dias', 'Oi, {nome}! Vou encerrar seu atendimento por aqui, tudo bem? Quando quiser retomar {projeto}, é só me chamar.'],
];
const ETAPAS_VENDA = ['novo', 'enviada', 'conversando', 'proposta', 'fechou', 'perdido']; // conversando = respondeu
const LEMBRETES = [2, 7, 15]; // dias até o próximo lembrete depois de cada mensagem
const CONTA_SITE = 1; // conta da Branco: dona do site, dos eventos (/t) e dos leads (/lead)
// planos: empresas encontradas por mês (a etapa dos planos deixa isso editável no painel admin)
const PLANOS = { teste: { nome: 'Teste grátis', empresas: 30, preco: 0 }, start: { nome: 'Branco Start', empresas: 200, preco: 2990 }, pro: { nome: 'Branco Pro', empresas: 1500, preco: 5990 }, agency: { nome: 'Branco Agency', empresas: 4000, preco: 11990 } };
const TESTE_DIAS = 7;

// colunas que cada tabela precisa ter: se o banco veio de uma versão antiga, as que faltam são criadas (nada é apagado)
const COLUNAS = {
  eventos: ['tipo', 'v', 'p', 'o', 'd', 'criado_em', 'conta_id INTEGER'],
  contatos: ['lid', 'v', 'nome', 'telefone', 'empresa', 'projeto', 'mensagem', 'status', 'origem', 'venda', 'contatos INTEGER', 'ultimo_contato', 'proximo_contato', 'notas', 'proposta INTEGER', 'criado_em', 'atualizado_em',
    'site', 'instagram', 'endereco', 'cidade', 'nicho', 'maps', 'conta_id INTEGER', 'usuario_id INTEGER'],
  modelos: ['titulo', 'texto', 'criado_em', 'conta_id INTEGER'],
  vendas: ['cliente', 'servico', 'valor INTEGER', 'mensal INTEGER', 'data', 'fim', 'pago INTEGER', 'notas', 'contato_id INTEGER', 'criado_em', 'conta_id INTEGER', 'usuario_id INTEGER'],
  clientes: ['nome', 'email', 'projeto', 'site_url', 'etapa INTEGER', 'recado', 'site', 'token', 'criado_em', 'conta_id INTEGER'],
  links: ['cliente_id INTEGER', 'titulo', 'url', 'criado_em', 'conta_id INTEGER'],
  visitas_cliente: ['site', 'v', 'p', 'o', 'd', 'criado_em', 'conta_id INTEGER'],
  extrato: ['ext_id', 'data', 'valor INTEGER', 'descricao', 'venda_id INTEGER', 'ignorar INTEGER', 'criado_em', 'conta_id INTEGER'],
  sessoes: ['token', 'criado_em', 'usuario_id INTEGER', 'conta_id INTEGER'],
  contas: ['nome', 'plano', 'status', 'criado_em', 'teste_ate'],
  assinaturas: ['conta_id INTEGER', 'plano', 'gateway', 'gateway_id', 'status', 'valor INTEGER', 'proximo_pagamento', 'ultimo_pagamento', 'criado_em', 'atualizado_em'],
  cobrancas: ['conta_id INTEGER', 'assinatura_id INTEGER', 'gateway_id', 'status', 'valor INTEGER', 'data', 'criado_em'],
  usuarios: ['email', 'senha', 'nome', 'verificado INTEGER', 'admin_saas INTEGER', 'criado_em'],
  membros: ['conta_id INTEGER', 'usuario_id INTEGER', 'papel', 'criado_em'],
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
  // multi-conta: tudo que existia passa a ser da conta 1 (Branco). Nada é apagado.
  await db.prepare("INSERT OR IGNORE INTO contas (id, nome, plano, status) VALUES (?, 'Branco', 'agency', 'ativa')").bind(CONTA_SITE).run();
  await db.batch(['eventos', 'contatos', 'modelos', 'vendas', 'clientes', 'links', 'visitas_cliente', 'extrato', 'sessoes']
    .map(t => db.prepare(`UPDATE ${t} SET conta_id = ? WHERE conta_id IS NULL`).bind(CONTA_SITE)));
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO config_conta (conta_id, chave, valor) SELECT ?, chave, valor FROM config WHERE chave IN ('msg_semsite','msg_comsite')").bind(CONTA_SITE),
    db.prepare('CREATE INDEX IF NOT EXISTS ct_conta ON contatos (conta_id, criado_em)'), db.prepare('CREATE INDEX IF NOT EXISTS ev_conta ON eventos (conta_id, criado_em)'),
    db.prepare('CREATE INDEX IF NOT EXISTS vd_conta ON vendas (conta_id, data)'), db.prepare('CREATE INDEX IF NOT EXISTS cl_conta ON clientes (conta_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS ex_conta ON extrato (conta_id, data)'), db.prepare('CREATE INDEX IF NOT EXISTS vc_conta ON visitas_cliente (conta_id, criado_em)'),
    db.prepare('CREATE INDEX IF NOT EXISTS mb_usuario ON membros (usuario_id)')]);
  // o id do banco no extrato só precisa ser único dentro da conta: vira "conta:id" (roda uma vez)
  if (!(await db.prepare("SELECT 1 FROM config WHERE chave = 'mig_extrato_conta'").first())) await db.batch([
    db.prepare("UPDATE extrato SET ext_id = conta_id || ':' || ext_id"),
    db.prepare("INSERT INTO config (chave, valor) VALUES ('mig_extrato_conta', '1') ON CONFLICT(chave) DO NOTHING")]);
  // etapa nova "mensagem enviada": quem foi para "conversando" só por ter recebido mensagem (nunca editado à mão) volta para ela — roda uma vez
  if (!(await db.prepare("SELECT 1 FROM config WHERE chave = 'mig_enviada'").first())) await db.batch([
    db.prepare("UPDATE contatos SET venda = 'enviada' WHERE venda = 'conversando' AND atualizado_em IS NULL"),
    db.prepare("INSERT INTO config (chave, valor) VALUES ('mig_enviada', '1') ON CONFLICT(chave) DO NOTHING")]);
}

let pronto = null;
async function prepara(db) {
  if (!pronto) pronto = (async () => {
    await db.batch(SCHEMA.map(s => db.prepare(s)));
    await migra(db);
    const { n } = await db.prepare('SELECT COUNT(*) n FROM modelos WHERE conta_id = ?').bind(CONTA_SITE).first();
    if (!n) await db.batch(MODELOS_INICIAIS.map(m => db.prepare('INSERT INTO modelos (titulo, texto, conta_id) VALUES (?, ?, ?)').bind(...m, CONTA_SITE)));
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
const emailOk = e => { e = String(e || '').trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 160 ? e : null; };
// senha guardada como pbkdf2$voltas$sal$hash (o número de voltas fica gravado para poder subir depois)
const PBKDF2_VOLTAS = 20000;
async function hashSenha(senha, sal = aleatorio(16), voltas = PBKDF2_VOLTAS) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(sal), iterations: voltas }, k, 256);
  return `pbkdf2$${voltas}$${sal}$${btoa(String.fromCharCode(...new Uint8Array(bits)))}`;
}
async function confereSenha(senha, guardada) {
  const [tipo, voltas, sal] = String(guardada || '').split('$');
  if (tipo !== 'pbkdf2' || !sal) return false;
  return iguais(await hashSenha(senha, sal, Number(voltas)), guardada);
}
const senhaFraca = s => !s || s.length < 8 ? 'A senha precisa ter pelo menos 8 caracteres.' : null;
// e-mail transacional: Brevo (BREVO_KEY — aceita remetente Gmail) ou Resend (RESEND_KEY — precisa de domínio próprio).
// EMAIL_DE = 'Branco <brancowebs@gmail.com>'. Sem chave nenhuma, só registra no log do Worker.
async function enviaEmail(env, para, assunto, texto) {
  const de = (env.EMAIL_DE || 'Branco <brancowebs@gmail.com>').match(/^(.*?)\s*<([^>]+)>$/) || [null, 'Branco', env.EMAIL_DE || 'brancowebs@gmail.com'];
  let r = null;
  if (env.BREVO_KEY) r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': env.BREVO_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: { name: de[1].trim() || 'Branco', email: de[2].trim() }, to: [{ email: para }], subject: assunto, textContent: texto }), signal: AbortSignal.timeout(10000) }).catch(() => null);
  else if (env.RESEND_KEY) r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_DE || 'Branco <onboarding@resend.dev>', to: [para], subject: assunto, text: texto }), signal: AbortSignal.timeout(10000) }).catch(() => null);
  else { console.log('[e-mail não enviado — falta BREVO_KEY ou RESEND_KEY]', para, assunto, texto); return false; }
  if (!r?.ok) console.error('[e-mail falhou]', r?.status, await r?.text().catch(() => ''));
  return !!r?.ok;
}
async function novoToken(db, usuarioId, tipo, horas) {
  const t = aleatorio(40);
  await db.batch([db.prepare("DELETE FROM tokens_email WHERE expira < datetime('now') OR (usuario_id = ? AND tipo = ?)").bind(usuarioId, tipo),
    db.prepare("INSERT INTO tokens_email (token, usuario_id, tipo, expira) VALUES (?, ?, ?, datetime('now', ?))").bind(t, usuarioId, tipo, `+${horas} hours`)]);
  return t;
}
const registra = (db, nivel, conta, texto) => db.prepare("INSERT INTO log (nivel, conta_id, texto, criado_em) VALUES (?, ?, ?, datetime('now'))").bind(nivel, conta, String(texto).slice(0, 500)).run().catch(() => {});

/* ---------- segurança ---------- */
const ip = req => req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For')?.split(',')[0].trim() || 'local';
// conta pedidos por chave numa janela de tempo; devolve true quando passou do máximo
async function excedeu(db, chave, max, minutos) {
  const r = await db.prepare(`INSERT INTO limites (chave, n, ate) VALUES (?, 1, datetime('now', ?))
      ON CONFLICT(chave) DO UPDATE SET n = CASE WHEN ate < datetime('now') THEN 1 ELSE n + 1 END,
      ate = CASE WHEN ate < datetime('now') THEN excluded.ate ELSE ate END RETURNING n`).bind(chave, `+${minutos} minutes`).first();
  return r.n > max;
}
const bloqueadoLogin = async (db, req) => {
  const r = await db.prepare("SELECT n FROM limites WHERE chave = ? AND ate >= datetime('now')").bind('login:' + ip(req)).first();
  return (r?.n || 0) >= 8; // 8 senhas erradas → espera 15 minutos
};
const CSP_PAINEL = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
const SEGURANCA = { 'Content-Security-Policy': CSP_PAINEL, 'X-Content-Type-Options': 'nosniff', 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' };

// quem está logado: usuário (ou o dono via ADMIN_SENHA, sem usuário) + a conta em que está + o papel
async function sessao(req, db) {
  const t = cookie(req, 'bsess'); if (!t || t.length !== 40) return null;
  const s = await db.prepare(`SELECT s.usuario_id, s.conta_id, u.email, u.nome unome, u.admin_saas, u.verificado, m.papel, c.nome cnome, c.plano, c.status, c.teste_ate
    FROM sessoes s LEFT JOIN usuarios u ON u.id = s.usuario_id LEFT JOIN membros m ON m.usuario_id = s.usuario_id AND m.conta_id = s.conta_id LEFT JOIN contas c ON c.id = s.conta_id
    WHERE s.token = ? AND s.criado_em > datetime('now','-30 days')`).bind(t).first();
  if (!s || !s.conta_id || !s.cnome) return null;
  if (s.usuario_id && !s.papel) return null; // usuário removido da conta
  const dono = !s.usuario_id; // sessão antiga pela ADMIN_SENHA: dono da conta 1
  return { conta: s.conta_id, contaNome: s.cnome, plano: s.plano, status: s.status, testeAte: s.teste_ate, usuario: s.usuario_id, email: s.email, nome: s.unome,
    papel: dono ? 'dono' : s.papel, admin: dono ? s.conta_id === CONTA_SITE : !!s.admin_saas, verificado: dono ? true : !!s.verificado };
}
const cicloAtual = () => new Date().toISOString().slice(0, 7); // 'AAAA-MM'
// quanto a conta já usou no ciclo e qual é o limite (a conta da Branco não tem limite)
async function consumo(db, S) {
  const r = await db.prepare('SELECT encontradas FROM uso WHERE conta_id = ? AND ciclo = ?').bind(S.conta, cicloAtual()).first();
  const plano = PLANOS[S.plano] || PLANOS.teste, testeAcabou = S.plano === 'teste' && S.testeAte && S.testeAte < new Date().toISOString().slice(0, 19).replace('T', ' ');
  return { usado: r?.encontradas || 0, limite: S.conta === CONTA_SITE ? null : plano.empresas, plano: S.plano, planoNome: S.conta === CONTA_SITE ? 'Branco' : plano.nome, testeAte: S.testeAte, testeAcabou: !!testeAcabou, inadimplente: S.status === 'inadimplente' };
}
// desconta do plano só as empresas que a conta ainda não tinha visto (chave: telefone, senão nome+cidade)
async function descontaEmpresas(db, S, itens) {
  if (S.conta === CONTA_SITE) return itens;
  const c = await consumo(db, S);
  if (c.testeAcabou) throw Object.assign(new Error('Seu teste grátis terminou. Assine um plano para continuar buscando.'), { status: 402 });
  if (S.status === 'inadimplente') throw Object.assign(new Error('O pagamento da sua assinatura não foi confirmado. Regularize em "Assinatura" para continuar buscando.'), { status: 402 });
  const chave = x => 'e:' + (digitos(x.telefone) || (String(x.nome || '').toLowerCase().trim() + '|' + String(x.cidade || '').toLowerCase().trim()));
  const novos = [], vistas = new Set();
  for (const x of itens) { const k = chave(x); if (vistas.has(k)) continue; vistas.add(k);
    if (!await db.prepare('SELECT 1 FROM empresas_vistas WHERE conta_id = ? AND chave = ?').bind(S.conta, k).first()) novos.push([x, k]); }
  const restante = Math.max(0, c.limite - c.usado), conhecidas = itens.length - novos.length;
  // nada cabe e nada já era conhecido: avisa. Se tem conhecidas, devolve só elas (sem cobrar) com um aviso.
  if (novos.length && !restante && !conhecidas) throw Object.assign(new Error(`Você já usou as ${c.limite} empresas do seu plano neste mês. Faça upgrade para continuar.`), { status: 402 });
  const cabem = new Set(novos.slice(0, restante).map(n => n[1]));
  itens.aviso = novos.length > cabem.size ? `${novos.length - cabem.size} empresa(s) nova(s) ficaram de fora: o limite do seu plano neste mês acabou.` : null;
  if (cabem.size) await db.batch([
    ...[...cabem].map(k => db.prepare("INSERT OR IGNORE INTO empresas_vistas (conta_id, chave, criado_em) VALUES (?, ?, datetime('now'))").bind(S.conta, k)),
    db.prepare('INSERT INTO uso (conta_id, ciclo, encontradas) VALUES (?, ?, ?) ON CONFLICT(conta_id, ciclo) DO UPDATE SET encontradas = encontradas + excluded.encontradas').bind(S.conta, cicloAtual(), cabem.size)]);
  // devolve o que já era conhecido + o que coube no plano
  const out = itens.filter(x => { const k = chave(x); return !novos.some(n => n[1] === k) || cabem.has(k); }); out.aviso = itens.aviso; return out;
}
async function abreSessao(db, usuarioId, contaId) {
  const t = aleatorio(40);
  await db.batch([db.prepare("INSERT INTO sessoes (token, usuario_id, conta_id, criado_em) VALUES (?, ?, ?, datetime('now'))").bind(t, usuarioId, contaId),
    db.prepare("DELETE FROM sessoes WHERE criado_em < datetime('now','-30 days')")]);
  return { 'Set-Cookie': `bsess=${t}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` };
}

/* ---------- rotas públicas ---------- */
const TIPOS = new Set(['visita', 'whatsapp', 'form_aberto', 'form_enviado', 'chat']);
async function rotaEvento(req, db) {
  const b = await corpo(req);
  if (!TIPOS.has(b.tipo)) return new Response(null, { status: 204, headers: CORS });
  await db.prepare("INSERT INTO eventos (tipo, v, p, o, d, conta_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))")
    .bind(b.tipo, txt(b.v, 40), txt(b.p, 200), txt(b.o, 60)?.toLowerCase() ?? null, txt(b.d, 20), CONTA_SITE).run();
  return new Response(null, { status: 204, headers: CORS });
}
async function rotaLead(req, db) {
  const b = await corpo(req), lid = txt(b.lid, 40), nome = txt(b.nome, 100);
  if (!lid || !nome) return new Response(null, { status: 204, headers: CORS });
  const status = b.status === 'enviado' ? 'enviado' : 'parcial';
  const val = [nome, digitos(b.telefone), txt(b.empresa, 120), txt(b.projeto, 80), txt(b.mensagem, 2000)];
  const ja = await db.prepare('SELECT id FROM contatos WHERE lid = ? AND conta_id = ?').bind(lid, CONTA_SITE).first();
  if (ja) await db.prepare(`UPDATE contatos SET nome = ?, telefone = COALESCE(?, telefone), empresa = COALESCE(?, empresa), projeto = COALESCE(?, projeto),
      mensagem = COALESCE(?, mensagem), atualizado_em = datetime('now'), status = CASE WHEN status = 'enviado' THEN 'enviado' ELSE ? END WHERE id = ?`).bind(...val, status, ja.id).run();
  else await db.prepare(`INSERT INTO contatos (lid, v, nome, telefone, empresa, projeto, mensagem, status, origem, venda, contatos, conta_id, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'site', 'novo', 0, ?, datetime('now'))`).bind(lid, txt(b.v, 40), ...val, status, CONTA_SITE).run();
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
  const cl = s && await db.prepare('SELECT conta_id FROM clientes WHERE site = ?').bind(s).first();
  if (cl) await db.prepare("INSERT INTO visitas_cliente (site, v, p, o, d, conta_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))").bind(s, txt(b.v, 40), txt(b.p, 200), txt(b.o, 60)?.toLowerCase() ?? null, txt(b.d, 20), cl.conta_id).run();
  return new Response(null, { status: 204, headers: CORS });
}

/* ---------- painel: números do site ---------- */
async function dados(db, conta, dias) {
  const desde = `-${dias} days`, q = sql => db.prepare(sql).bind(conta, desde);
  const [tot, porDia, origens, disp, cads, lista] = await db.batch([
    q(`SELECT SUM(tipo='visita') visitas, COUNT(DISTINCT CASE WHEN tipo='visita' THEN v END) unicos, SUM(tipo='whatsapp') whatsapp,
       SUM(tipo='form_aberto') formAberto, SUM(tipo='chat') chat FROM eventos WHERE conta_id = ? AND criado_em >= datetime('now', ?)`),
    q(`SELECT date(criado_em) dia, SUM(tipo='visita') visitas, SUM(tipo='whatsapp') whats FROM eventos WHERE conta_id = ? AND criado_em >= datetime('now', ?) GROUP BY dia ORDER BY dia`),
    q(`SELECT COALESCE(o,'direto') origem, COUNT(*) n FROM eventos WHERE conta_id = ? AND tipo='visita' AND criado_em >= datetime('now', ?) GROUP BY origem ORDER BY n DESC LIMIT 12`),
    q(`SELECT COALESCE(d,'—') d, COUNT(*) n FROM eventos WHERE conta_id = ? AND tipo='visita' AND criado_em >= datetime('now', ?) GROUP BY d ORDER BY n DESC`),
    q(`SELECT COUNT(*) cadastros, SUM(COALESCE(status,'enviado')<>'parcial') enviados FROM contatos WHERE conta_id = ? AND COALESCE(origem,'site')='site' AND criado_em >= datetime('now', ?)`),
    q(`SELECT id, nome, empresa, telefone, projeto, mensagem, COALESCE(status,'enviado') status, criado_em FROM contatos WHERE conta_id = ? AND COALESCE(origem,'site')='site' AND criado_em >= datetime('now', ?) ORDER BY criado_em DESC LIMIT 500`),
  ]);
  const t = tot.results[0] || {}, c = cads.results[0] || {};
  return { dias, visitas: t.visitas || 0, unicos: t.unicos || 0, whatsapp: t.whatsapp || 0, formAberto: t.formAberto || 0, chat: t.chat || 0,
    cadastros: c.cadastros || 0, enviados: c.enviados || 0, porDia: porDia.results, origens: origens.results, dispositivos: disp.results, lista: lista.results };
}

/* ---------- painel: clientes ---------- */
async function listaClientes(db, conta) {
  const [cs, ls] = await db.batch([
    db.prepare(`SELECT c.*, COALESCE(c.etapa,1) etapa, (SELECT COUNT(*) FROM visitas_cliente v WHERE v.site = c.site AND v.criado_em >= datetime('now','-30 days')) visitas30 FROM clientes c WHERE c.conta_id = ? ORDER BY c.criado_em DESC`).bind(conta),
    db.prepare('SELECT id, cliente_id, titulo, url FROM links WHERE conta_id = ? ORDER BY id').bind(conta),
  ]);
  return cs.results.map(c => ({ ...c, links: ls.results.filter(l => l.cliente_id === c.id) }));
}

/* ---------- roteador da API do painel ---------- */
async function api(req, db, env, caminho) {
  const m = req.method, seg = caminho.split('/').filter(Boolean).slice(1); // ['clientes','3','links']
  const [rec, id, sub] = [seg[0], seg[1] ? Number(seg[1]) : null, seg[2]];

  const cadastroAberto = env.CADASTRO_ABERTO !== '0'; // CADASTRO_ABERTO=0 fecha o cadastro
  // login: com e-mail + senha (usuário) ou só a senha do Worker (dono da conta 1, como antes)
  if (rec === 'login' && m === 'POST') {
    const b = await corpo(req), email = emailOk(b.email), senha = String(b.senha || '');
    if (await bloqueadoLogin(db, req)) return erro('Muitas tentativas. Espere 15 minutos e tente de novo.', 429);
    const falhou = async () => { await excedeu(db, 'login:' + ip(req), 8, 15); await new Promise(r => setTimeout(r, 600)); return erro(email ? 'E-mail ou senha errados.' : 'Senha errada.', 401); };
    let usuario = null, conta = CONTA_SITE;
    if (email) {
      const u = await db.prepare('SELECT id, senha FROM usuarios WHERE email = ?').bind(email).first();
      if (!u || !await confereSenha(senha, u.senha)) return await falhou();
      const mb = await db.prepare("SELECT conta_id FROM membros WHERE usuario_id = ? ORDER BY papel = 'dono' DESC, criado_em LIMIT 1").bind(u.id).first();
      if (!mb) return erro('Este usuário não faz parte de nenhuma conta.', 403);
      usuario = u.id; conta = mb.conta_id;
    } else {
      if (!env.ADMIN_SENHA) return erro('Configure a variável ADMIN_SENHA no Worker.', 500);
      if (!iguais(senha, env.ADMIN_SENHA)) return await falhou();
    }
    await db.batch([db.prepare('DELETE FROM limites WHERE chave = ?').bind('login:' + ip(req)), db.prepare("DELETE FROM limites WHERE ate < datetime('now')")]);
    return json({ ok: true }, 200, await abreSessao(db, usuario, conta));
  }
  const S = await sessao(req, db);
  if (rec === 'sessao') return json(S ? { papel: 'admin', conta: { id: S.conta, nome: S.contaNome, plano: S.plano }, usuario: S.usuario ? { nome: S.nome, email: S.email, verificado: S.verificado } : null,
    meuPapel: S.papel, site: S.conta === CONTA_SITE, admin: S.admin, cadastro: cadastroAberto, uso: await consumo(db, S) } : { papel: null, cadastro: cadastroAberto });
  if (rec === 'sair') {
    const t = cookie(req, 'bsess'); if (t) await db.prepare('DELETE FROM sessoes WHERE token = ?').bind(t).run();
    return json({ ok: true }, 200, { 'Set-Cookie': 'bsess=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' });
  }
  // conta: criar, verificar e-mail, recuperar senha (sem estar logado)
  if (rec === 'conta' && m === 'POST' && ['cadastro', 'verificar', 'esqueci', 'redefinir'].includes(seg[1])) return await rotaConta(req, db, env, seg[1], S, cadastroAberto);
  if (!S) return erro('Faça login.', 401);
  if (S.status === 'bloqueada' && S.conta !== CONTA_SITE) return erro('Esta conta está bloqueada. Fale com o suporte.', 403);
  const conta = S.conta, b = ['POST', 'PATCH', 'PUT'].includes(m) ? await corpo(req) : {};
  // painel do dono do SaaS (só admin): assinantes, planos, consumo, log
  if (rec === 'saas') return S.admin ? await rotaSaas(req, db, env, m, seg, b) : erro('Só o administrador do Branco pode ver isso.', 403);
  // assinatura do assinante (Mercado Pago)
  if (rec === 'assinatura') { try { return await rotaAssinatura(req, db, env, m, seg, b, S); } catch (e) { await registra(db, 'erro', conta, 'assinatura: ' + e.message); return erro(e.message, e.status || 502); } }

  // conta: dados, equipe, trocar senha, criar o login do dono
  if (rec === 'conta') {
    if (m === 'GET' && !seg[1]) {
      const eq = await db.prepare('SELECT u.id, u.nome, u.email, u.verificado, m.papel FROM membros m JOIN usuarios u ON u.id = m.usuario_id WHERE m.conta_id = ? ORDER BY m.criado_em').bind(conta).all();
      return json({ conta: { id: conta, nome: S.contaNome, plano: S.plano, status: S.status }, uso: await consumo(db, S), usuario: S.usuario ? { id: S.usuario, nome: S.nome, email: S.email, verificado: S.verificado } : null, meuPapel: S.papel, equipe: eq.results });
    }
    if (seg[1] === 'dono' && m === 'POST') { // dono entrou pela ADMIN_SENHA e quer um login por e-mail
      if (S.usuario || S.papel !== 'dono') return erro('Você já tem um login por e-mail.');
      const email = emailOk(b.email), f = senhaFraca(b.senha); if (!email) return erro('Coloque um e-mail válido.'); if (f) return erro(f);
      if (await db.prepare('SELECT 1 FROM usuarios WHERE email = ?').bind(email).first()) return erro('Este e-mail já está em uso.');
      const r = await db.prepare("INSERT INTO usuarios (email, senha, nome, verificado, admin_saas, criado_em) VALUES (?, ?, ?, 1, ?, datetime('now'))").bind(email, await hashSenha(b.senha), txt(b.nome, 80), conta === CONTA_SITE ? 1 : 0).run();
      await db.prepare("INSERT INTO membros (conta_id, usuario_id, papel, criado_em) VALUES (?, ?, 'dono', datetime('now'))").bind(conta, r.meta.last_row_id).run();
      return json({ ok: true }, 200, await abreSessao(db, r.meta.last_row_id, conta));
    }
    if (m === 'PATCH' && !seg[1]) {
      if ('nome_conta' in b && S.papel === 'dono') { const n = txt(b.nome_conta, 80); if (!n) return erro('O nome da conta não pode ficar vazio.'); await db.prepare('UPDATE contas SET nome = ? WHERE id = ?').bind(n, conta).run(); }
      if (S.usuario) {
        if ('nome' in b) await db.prepare('UPDATE usuarios SET nome = ? WHERE id = ?').bind(txt(b.nome, 80), S.usuario).run();
        if (b.senha_nova) {
          const u = await db.prepare('SELECT senha FROM usuarios WHERE id = ?').bind(S.usuario).first(), f = senhaFraca(b.senha_nova);
          if (!await confereSenha(String(b.senha_atual || ''), u.senha)) return erro('A senha atual está errada.'); if (f) return erro(f);
          await db.batch([db.prepare('UPDATE usuarios SET senha = ? WHERE id = ?').bind(await hashSenha(b.senha_nova), S.usuario),
            db.prepare('DELETE FROM sessoes WHERE usuario_id = ? AND token <> ?').bind(S.usuario, cookie(req, 'bsess'))]); // derruba as outras sessões
        }
      }
      return json({ ok: true });
    }
    if (seg[1] === 'reenviar' && m === 'POST' && S.usuario && !S.verificado) {
      const t = await novoToken(db, S.usuario, 'verificar', 48);
      await enviaEmail(env, S.email, 'Confirme seu e-mail no Branco', `Olá! Confirme seu e-mail abrindo este link:\n${new URL(req.url).origin}/admin?verificar=${t}\n\nSe não foi você, ignore esta mensagem.`);
      return json({ ok: true });
    }
    return erro('Rota não encontrada.', 404);
  }

  // assinantes usam só Follow-up e Prospecção; números do site, clientes e financeiro são da conta da Branco
  if (['dados', 'clientes', 'links', 'vendas', 'extrato'].includes(rec) && conta !== CONTA_SITE) return erro('Essa parte não faz parte do seu plano.', 403);
  if (rec === 'dados') return json(await dados(db, conta, inteiro(new URL(req.url).searchParams.get('dias'), 1, 730) || 30));

  // configurações: mensagens de prospecção são por conta; o aviso de manutenção é do site da Branco (conta 1)
  if (rec === 'config') {
    if (m === 'PUT') {
      const minhas = [], globais = [];
      for (const k of ['msg_semsite', 'msg_comsite']) if (k in b) minhas.push([k, txt(b[k], 1500) || '']);
      if (conta === CONTA_SITE) {
        if ('manutencao' in b) globais.push(['manutencao', b.manutencao ? '1' : '0']);
        if ('mensagem' in b) globais.push(['mensagem', txt(b.mensagem, 300) || '']);
      }
      if (minhas.length) await db.batch(minhas.map(x => db.prepare('INSERT INTO config_conta (conta_id, chave, valor) VALUES (?, ?, ?) ON CONFLICT(conta_id, chave) DO UPDATE SET valor = excluded.valor').bind(conta, ...x)));
      if (globais.length) await db.batch(globais.map(x => db.prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').bind(...x)));
    }
    const cc = Object.fromEntries((await db.prepare('SELECT chave, valor FROM config_conta WHERE conta_id = ?').bind(conta).all()).results.map(x => [x.chave, x.valor]));
    const c = conta === CONTA_SITE ? Object.fromEntries((await db.prepare("SELECT chave, valor FROM config WHERE chave IN ('manutencao','mensagem')").all()).results.map(x => [x.chave, x.valor])) : {};
    return json({ manutencao: c.manutencao === '1', mensagem: c.mensagem || '', msg_semsite: cc.msg_semsite || '', msg_comsite: cc.msg_comsite || '', google: !!env.GOOGLE_PLACES_KEY, serper: !!env.SERPER_KEY, tomtom: !!env.TOMTOM_KEY, here: !!env.HERE_KEY });
  }

  // cidades de um estado (IBGE), guardadas em cache por 30 dias
  if (rec === 'cidades') {
    const uf = (new URL(req.url).searchParams.get('uf') || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(uf)) return erro('Estado inválido.');
    const chave = new Request('https://cache.branco/cidades/' + uf), cache = caches.default;
    let r = await cache.match(chave);
    if (!r) {
      const ibge = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`, { signal: AbortSignal.timeout(10000) }).catch(() => null);
      if (!ibge?.ok) return erro('Não consegui carregar as cidades agora.', 502);
      const nomes = (await ibge.json()).map(c => c.nome);
      r = new Response(JSON.stringify(nomes), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'max-age=2592000' } });
      await cache.put(chave, r.clone());
    }
    return new Response(r.body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }

  // prospecção: busca estabelecimentos por nicho e cidade
  if (rec === 'prospeccao') {
    if (seg[1] === 'nichos') return json(NICHOS.map(n => ({ id: n.id, nome: n.nome, grupo: n.grupo })));
    if (seg[1] === 'uso') return json(await consumo(db, S));
    if (seg[1] === 'salvar' && m === 'POST') return json(await salvaProspects(db, conta, b.itens, S.usuario));
    if (seg[1] === 'enriquecer' && m === 'POST') {
      if (await excedeu(db, 'enriq:' + ip(req), 120, 60)) return erro('Muitas consultas seguidas. Espere alguns minutos.', 429);
      return json(await enriquece(env, b.itens, txt(b.pais, 60)));
    }
    if (m === 'GET') {
      if (await excedeu(db, 'busca:' + ip(req), 60, 60)) { await registra(db, 'aviso', conta, 'limite de buscas por minuto atingido'); return erro('Muitas buscas seguidas. Espere alguns minutos.', 429); }
      const q = new URL(req.url).searchParams;
      try {
        const r = await buscaProspects(env, { nicho: q.get('nicho'), termo: txt(q.get('termo'), 60), cidade: txt(q.get('cidade'), 80), estado: txt(q.get('estado'), 60), pais: txt(q.get('pais'), 60) || 'Brasil', fonte: q.get('fonte') });
        r.itens = await descontaEmpresas(db, S, r.itens); r.total = r.itens.length; r.uso = await consumo(db, S); r.aviso = r.itens.aviso || null;
        return json(r);
      } catch (e) { await registra(db, e.status === 402 ? 'aviso' : 'erro', conta, 'busca: ' + e.message); return erro(e.message || 'Não foi possível buscar agora.', e.status || 502); } // mostra o motivo real no painel
    }
  }

  // clientes
  if (rec === 'clientes') {
    if (m === 'GET' && !id) return json(await listaClientes(db, conta));
    if (m === 'POST' && !id) {
      const nome = txt(b.nome, 100); if (!nome) return erro('Coloque o nome do cliente.');
      await db.prepare("INSERT INTO clientes (nome, email, projeto, site_url, site, token, etapa, conta_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, 1, ?, datetime('now'))")
        .bind(nome, txt(b.email, 160)?.toLowerCase() ?? null, txt(b.projeto, 120), urlOk(b.site_url), aleatorio(10), aleatorio(24), conta).run();
      return json({ ok: true });
    }
    if (id && !await db.prepare('SELECT 1 FROM clientes WHERE id = ? AND conta_id = ?').bind(id, conta).first()) return erro('Cliente não encontrado.', 404);
    if (id && sub === 'links' && m === 'POST') {
      const titulo = txt(b.titulo, 100), url = urlOk(b.url); if (!titulo || !url) return erro('Coloque um título e um link começando com https://');
      await db.prepare("INSERT INTO links (cliente_id, titulo, url, conta_id, criado_em) VALUES (?, ?, ?, ?, datetime('now'))").bind(id, titulo, url, conta).run(); return json({ ok: true });
    }
    if (id && m === 'PATCH') {
      const campos = [], val = [];
      if ('nome' in b) { const n = txt(b.nome, 100); if (!n) return erro('O nome não pode ficar vazio.'); campos.push('nome = ?'); val.push(n); }
      if ('email' in b) { campos.push('email = ?'); val.push(txt(b.email, 160)?.toLowerCase() ?? null); }
      if ('projeto' in b) { campos.push('projeto = ?'); val.push(txt(b.projeto, 120)); }
      if ('site_url' in b) { campos.push('site_url = ?'); val.push(urlOk(b.site_url)); }
      if ('etapa' in b) { campos.push('etapa = ?'); val.push(inteiro(b.etapa, 1, 5) || 1); }
      if ('recado' in b) { campos.push('recado = ?'); val.push(txt(b.recado, 3000)); }
      if (campos.length) await db.prepare(`UPDATE clientes SET ${campos.join(', ')} WHERE id = ? AND conta_id = ?`).bind(...val, id, conta).run();
      return json({ ok: true });
    }
    if (id && m === 'DELETE') {
      const c = await db.prepare('SELECT site FROM clientes WHERE id = ? AND conta_id = ?').bind(id, conta).first();
      await db.batch([db.prepare('DELETE FROM links WHERE cliente_id = ? AND conta_id = ?').bind(id, conta), db.prepare('DELETE FROM clientes WHERE id = ? AND conta_id = ?').bind(id, conta),
        db.prepare('DELETE FROM visitas_cliente WHERE site = ? AND conta_id = ?').bind(c?.site || '', conta)]);
      return json({ ok: true });
    }
  }
  if (rec === 'links' && id && m === 'DELETE') { await db.prepare('DELETE FROM links WHERE id = ? AND conta_id = ?').bind(id, conta).run(); return json({ ok: true }); }

  // follow-up
  if (rec === 'followup' && m === 'GET') {
    const [c, mo] = await db.batch([
      db.prepare(`SELECT id, nome, empresa, telefone, projeto, mensagem, COALESCE(status,'enviado') status, origem, site, instagram, endereco, cidade, nicho, maps, COALESCE(venda,'novo') venda, COALESCE(contatos,0) contatos,
        ultimo_contato, proximo_contato, notas, proposta, usuario_id, criado_em FROM contatos WHERE conta_id = ? ORDER BY (COALESCE(venda,'novo') IN ('fechou','perdido')), COALESCE(proximo_contato, '0000'), criado_em DESC`).bind(conta),
      db.prepare('SELECT id, titulo, texto FROM modelos WHERE conta_id = ? ORDER BY id').bind(conta)]);
    return json({ contatos: c.results, modelos: mo.results });
  }
  if (rec === 'contatos') {
    if (m === 'POST' && !id) {
      const nome = txt(b.nome, 100); if (!nome) return erro('Coloque o nome.');
      await db.prepare("INSERT INTO contatos (lid, nome, telefone, projeto, notas, status, origem, venda, contatos, conta_id, usuario_id, criado_em) VALUES (?, ?, ?, ?, ?, 'enviado', 'manual', 'novo', 0, ?, ?, datetime('now'))")
        .bind('m-' + aleatorio(16), nome, digitos(b.telefone), txt(b.projeto, 80), txt(b.notas, 2000), conta, S.usuario).run();
      return json({ ok: true });
    }
    if (id && !await db.prepare('SELECT 1 FROM contatos WHERE id = ? AND conta_id = ?').bind(id, conta).first()) return erro('Contato não encontrado.', 404);
    if (id && sub === 'enviei' && m === 'POST') {
      const c = await db.prepare('SELECT contatos FROM contatos WHERE id = ?').bind(id).first();
      const n = (c.contatos || 0) + 1, hoje = dataOk(b.hoje) || new Date().toISOString().slice(0, 10), dias = LEMBRETES[n - 1];
      await db.prepare(`UPDATE contatos SET contatos = ?, ultimo_contato = datetime('now'), proximo_contato = ${dias ? "date(?, '+' || ? || ' days')" : 'NULL'},
        venda = CASE WHEN COALESCE(venda,'novo') = 'novo' THEN 'enviada' ELSE venda END, usuario_id = COALESCE(usuario_id, ?) WHERE id = ?`).bind(...(dias ? [n, hoje, dias, S.usuario, id] : [n, S.usuario, id])).run();
      return json({ ok: true });
    }
    if (id && m === 'PATCH') {
      const campos = [], val = [];
      if ('venda' in b && ETAPAS_VENDA.includes(b.venda)) { campos.push('venda = ?'); val.push(b.venda); }
      if ('proximo_contato' in b) { campos.push('proximo_contato = ?'); val.push(dataOk(b.proximo_contato)); }
      if ('notas' in b) { campos.push('notas = ?'); val.push(txt(b.notas, 2000)); }
      if ('proposta' in b) { campos.push('proposta = ?'); val.push(b.proposta == null ? null : inteiro(b.proposta, 0, 1e11)); }
      if (campos.length) await db.prepare(`UPDATE contatos SET ${campos.join(', ')}, atualizado_em = datetime('now') WHERE id = ? AND conta_id = ?`).bind(...val, id, conta).run();
      return json({ ok: true });
    }
    if (id && m === 'DELETE') { await db.prepare('DELETE FROM contatos WHERE id = ? AND conta_id = ?').bind(id, conta).run(); return json({ ok: true }); }
  }
  if (rec === 'modelos') {
    if (m === 'GET') return json((await db.prepare('SELECT id, titulo, texto FROM modelos WHERE conta_id = ? ORDER BY id').bind(conta).all()).results);
    const titulo = txt(b.titulo, 60), texto = txt(b.texto, 1000);
    if (m === 'POST' && !id) { if (!titulo || !texto) return erro('Coloque título e texto.'); await db.prepare("INSERT INTO modelos (titulo, texto, conta_id, criado_em) VALUES (?, ?, ?, datetime('now'))").bind(titulo, texto, conta).run(); return json({ ok: true }); }
    if (id && m === 'PATCH') { if (!titulo || !texto) return erro('Coloque título e texto.'); await db.prepare('UPDATE modelos SET titulo = ?, texto = ? WHERE id = ? AND conta_id = ?').bind(titulo, texto, id, conta).run(); return json({ ok: true }); }
    if (id && m === 'DELETE') { await db.prepare('DELETE FROM modelos WHERE id = ? AND conta_id = ?').bind(id, conta).run(); return json({ ok: true }); }
  }

  // extrato do banco (Nubank): entradas importadas de um arquivo CSV/OFX e ligadas às vendas
  if (rec === 'extrato') {
    if (m === 'GET') return json((await db.prepare('SELECT id, data, valor, descricao, venda_id, ignorar FROM extrato WHERE conta_id = ? ORDER BY data DESC, id DESC LIMIT 2000').bind(conta).all()).results);
    if (m === 'POST' && !id) {
      const itens = (Array.isArray(b.itens) ? b.itens : []).slice(0, 3000).map(x => ({ ext: txt(x.ext_id, 120), data: dataOk(x.data), valor: inteiro(x.valor, 1, 1e11), desc: txt(x.descricao, 300) }))
        .filter(x => x.ext && x.data && x.valor);
      if (!itens.length) return erro('Nenhuma entrada de dinheiro encontrada no arquivo.');
      const antes = (await db.prepare('SELECT COUNT(*) n FROM extrato WHERE conta_id = ?').bind(conta).first()).n;
      for (let i = 0; i < itens.length; i += 50) // em lotes, ignorando o que já foi importado (o id do banco é único por conta)
        await db.batch(itens.slice(i, i + 50).map(x => db.prepare("INSERT OR IGNORE INTO extrato (ext_id, data, valor, descricao, conta_id, criado_em) VALUES (?, ?, ?, ?, ?, datetime('now'))").bind(conta + ':' + x.ext, x.data, x.valor, x.desc, conta)));
      const depois = (await db.prepare('SELECT COUNT(*) n FROM extrato WHERE conta_id = ?').bind(conta).first()).n;
      return json({ ok: true, novos: depois - antes, repetidos: itens.length - (depois - antes) });
    }
    if (id && m === 'PATCH') {
      const q = [];
      if ('venda_id' in b) {
        const v = b.venda_id == null ? null : inteiro(b.venda_id, 1, 1e12);
        q.push(db.prepare('UPDATE extrato SET venda_id = ?, ignorar = 0 WHERE id = ? AND conta_id = ?').bind(v, id, conta));
        if (v) q.push(db.prepare('UPDATE vendas SET pago = 1 WHERE id = ? AND conta_id = ?').bind(v, conta)); // recebeu → venda marcada como recebida
      }
      if ('ignorar' in b) q.push(db.prepare('UPDATE extrato SET ignorar = ? WHERE id = ? AND conta_id = ?').bind(b.ignorar ? 1 : 0, id, conta));
      if (q.length) await db.batch(q);
      return json({ ok: true });
    }
    if (id && m === 'DELETE') { await db.prepare('DELETE FROM extrato WHERE id = ? AND conta_id = ?').bind(id, conta).run(); return json({ ok: true }); }
  }

  // financeiro
  if (rec === 'vendas') {
    if (m === 'GET') {
      const [v, ng] = await db.batch([db.prepare('SELECT * FROM vendas WHERE conta_id = ? ORDER BY data DESC, id DESC').bind(conta),
        db.prepare("SELECT COUNT(*) qtd, COALESCE(SUM(proposta),0) total FROM contatos WHERE conta_id = ? AND COALESCE(venda,'novo') = 'proposta'").bind(conta)]);
      return json({ vendas: v.results.map(x => ({ ...x, valor: x.valor || 0, mensal: x.mensal || 0, pago: !!x.pago })), negociacao: ng.results[0] });
    }
    if (id && m === 'DELETE') { await db.prepare('DELETE FROM vendas WHERE id = ? AND conta_id = ?').bind(id, conta).run(); return json({ ok: true }); }
    if (id && m === 'PATCH' && Object.keys(b).length === 1 && 'pago' in b) { await db.prepare('UPDATE vendas SET pago = ? WHERE id = ? AND conta_id = ?').bind(b.pago ? 1 : 0, id, conta).run(); return json({ ok: true }); }
    if (m === 'POST' || (id && m === 'PATCH')) {
      const cliente = txt(b.cliente, 120), data = dataOk(b.data);
      if (!cliente) return erro('Coloque o nome do cliente.'); if (!data) return erro('Coloque a data da venda.');
      const val = [cliente, txt(b.servico, 80), inteiro(b.valor, 0, 1e11) || 0, inteiro(b.mensal, 0, 1e11) || 0, data, dataOk(b.fim), b.pago ? 1 : 0, txt(b.notas, 1000), inteiro(b.contato_id, 1, 1e12)];
      if (id) await db.prepare('UPDATE vendas SET cliente=?, servico=?, valor=?, mensal=?, data=?, fim=?, pago=?, notas=?, contato_id=? WHERE id = ? AND conta_id = ?').bind(...val, id, conta).run();
      else { const r = await db.prepare("INSERT INTO vendas (cliente, servico, valor, mensal, data, fim, pago, notas, contato_id, conta_id, usuario_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))").bind(...val, conta, S.usuario).run();
        return json({ ok: true, id: r.meta?.last_row_id }); }
      return json({ ok: true });
    }
  }
  return erro('Rota não encontrada.', 404);
}

/* ---------- conta: cadastro, verificação de e-mail e recuperação de senha ---------- */
async function rotaConta(req, db, env, acao, S, cadastroAberto) {
  const b = await corpo(req), origem = new URL(req.url).origin;
  if (await excedeu(db, 'conta:' + ip(req), 20, 60)) return erro('Muitas tentativas. Espere alguns minutos.', 429);
  if (acao === 'cadastro') {
    if (!cadastroAberto && !S?.admin) return erro('O cadastro ainda não está aberto.', 403);
    const email = emailOk(b.email), nome = txt(b.nome, 80), empresa = txt(b.empresa, 80) || nome, f = senhaFraca(b.senha);
    if (!email) return erro('Coloque um e-mail válido.'); if (!nome) return erro('Coloque seu nome.'); if (f) return erro(f);
    if (await db.prepare('SELECT 1 FROM usuarios WHERE email = ?').bind(email).first()) return erro('Este e-mail já tem conta. Faça login ou recupere a senha.');
    const c = await db.prepare("INSERT INTO contas (nome, plano, status, criado_em, teste_ate) VALUES (?, 'teste', 'ativa', datetime('now'), datetime('now', ?))").bind(empresa, `+${TESTE_DIAS} days`).run();
    const u = await db.prepare("INSERT INTO usuarios (email, senha, nome, verificado, admin_saas, criado_em) VALUES (?, ?, ?, 0, 0, datetime('now'))").bind(email, await hashSenha(b.senha), nome).run();
    const contaId = c.meta.last_row_id, usuarioId = u.meta.last_row_id;
    await db.batch([db.prepare("INSERT INTO membros (conta_id, usuario_id, papel, criado_em) VALUES (?, ?, 'dono', datetime('now'))").bind(contaId, usuarioId),
      ...MODELOS_INICIAIS.map(m => db.prepare("INSERT INTO modelos (titulo, texto, conta_id, criado_em) VALUES (?, ?, ?, datetime('now'))").bind(...m, contaId))]);
    const t = await novoToken(db, usuarioId, 'verificar', 48);
    await enviaEmail(env, email, 'Confirme seu e-mail no Branco', `Olá, ${nome}! Confirme seu e-mail abrindo este link:\n${origem}/admin?verificar=${t}\n\nSe não foi você, ignore esta mensagem.`);
    await registra(db, 'info', contaId, 'conta criada: ' + email);
    return json({ ok: true, verificar: !env.RESEND_KEY && !env.BREVO_KEY ? t : undefined }, 200, await abreSessao(db, usuarioId, contaId)); // sem e-mail configurado, devolve o código para testes
  }
  if (acao === 'verificar') {
    const t = await db.prepare("SELECT usuario_id FROM tokens_email WHERE token = ? AND tipo = 'verificar' AND expira > datetime('now')").bind(String(b.token || '')).first();
    if (!t) return erro('Link inválido ou vencido. Peça um novo no painel.');
    await db.batch([db.prepare('UPDATE usuarios SET verificado = 1 WHERE id = ?').bind(t.usuario_id), db.prepare('DELETE FROM tokens_email WHERE token = ?').bind(String(b.token))]);
    return json({ ok: true });
  }
  if (acao === 'esqueci') {
    const email = emailOk(b.email), u = email && await db.prepare('SELECT id, nome FROM usuarios WHERE email = ?').bind(email).first();
    if (u) { // resposta igual com ou sem conta, para não revelar quem tem cadastro
      const t = await novoToken(db, u.id, 'senha', 2);
      await enviaEmail(env, email, 'Redefinir sua senha no Branco', `Olá, ${u.nome || ''}! Para criar uma senha nova abra este link (vale por 2 horas):\n${origem}/admin?redefinir=${t}\n\nSe não foi você, ignore esta mensagem.`);
    }
    return json({ ok: true });
  }
  if (acao === 'redefinir') {
    const f = senhaFraca(b.senha); if (f) return erro(f);
    const t = await db.prepare("SELECT usuario_id FROM tokens_email WHERE token = ? AND tipo = 'senha' AND expira > datetime('now')").bind(String(b.token || '')).first();
    if (!t) return erro('Link inválido ou vencido. Peça outro em "Esqueci a senha".');
    await db.batch([db.prepare('UPDATE usuarios SET senha = ?, verificado = 1 WHERE id = ?').bind(await hashSenha(b.senha), t.usuario_id),
      db.prepare('DELETE FROM tokens_email WHERE usuario_id = ?').bind(t.usuario_id), db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').bind(t.usuario_id)]);
    return json({ ok: true });
  }
  return erro('Rota não encontrada.', 404);
}

/* ---------- cobrança: Mercado Pago (assinaturas = "preapproval") ---------- */
// Regra de ouro: o Worker nunca confia no corpo do webhook. Ele só pega o id e consulta o Mercado Pago com o token.
const MP = 'https://api.mercadopago.com';
async function mp(env, caminho, opcoes = {}) {
  if (!env.MP_ACCESS_TOKEN) throw Object.assign(new Error('Pagamento ainda não configurado (falta MP_ACCESS_TOKEN no Worker).'), { status: 503 });
  const r = await fetch(MP + caminho, { ...opcoes, headers: { Authorization: 'Bearer ' + env.MP_ACCESS_TOKEN, 'Content-Type': 'application/json', ...(opcoes.headers || {}) }, signal: AbortSignal.timeout(15000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error('Mercado Pago: ' + (d.message || d.error || r.status)), { status: 502, codigo: r.status });
  return d;
}
const mpData = s => s ? String(s).replace('T', ' ').slice(0, 19) : null;
// aplica no banco o estado real de uma assinatura do Mercado Pago
async function sincronizaAssinatura(db, env, preId) {
  const pre = await mp(env, '/preapproval/' + encodeURIComponent(preId));
  let a = await db.prepare('SELECT * FROM assinaturas WHERE gateway_id = ?').bind(String(pre.id)).first();
  const contaId = a?.conta_id || Number(String(pre.external_reference || '').split(':')[0]) || null;
  if (!contaId) return null;
  const plano = a?.plano || String(pre.external_reference || '').split(':')[1] || 'start';
  const status = { authorized: 'ativa', pending: 'pendente', paused: 'pausada', cancelled: 'cancelada' }[pre.status] || pre.status;
  if (!a) { const r = await db.prepare("INSERT INTO assinaturas (conta_id, plano, gateway, gateway_id, status, valor, criado_em) VALUES (?, ?, 'mp', ?, ?, ?, datetime('now'))").bind(contaId, plano, String(pre.id), status, Math.round((pre.auto_recurring?.transaction_amount || 0) * 100)).run(); a = { id: r.meta.last_row_id, conta_id: contaId, plano }; }
  await db.prepare("UPDATE assinaturas SET status = ?, proximo_pagamento = ?, atualizado_em = datetime('now') WHERE id = ?").bind(status, mpData(pre.next_payment_date), a.id).run();
  if (status === 'ativa') {
    // plano ativo: libera a conta e cancela outras assinaturas ativas (troca de plano)
    await db.prepare("UPDATE contas SET plano = ?, status = CASE WHEN status = 'bloqueada' THEN 'bloqueada' ELSE 'ativa' END, teste_ate = NULL WHERE id = ?").bind(plano, contaId).run();
    const outras = (await db.prepare("SELECT gateway_id FROM assinaturas WHERE conta_id = ? AND id <> ? AND status IN ('ativa','pendente','pausada')").bind(contaId, a.id).all()).results;
    for (const o of outras) { await mp(env, '/preapproval/' + encodeURIComponent(o.gateway_id), { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) }).catch(() => {}); await db.prepare("UPDATE assinaturas SET status = 'cancelada', atualizado_em = datetime('now') WHERE gateway_id = ?").bind(o.gateway_id).run(); }
    await registra(db, 'info', contaId, `assinatura ativa: ${plano}`);
  } else if (status === 'pausada') { // pagamentos recusados seguidos: trava as buscas, mantém os dados
    await db.prepare("UPDATE contas SET status = CASE WHEN status = 'bloqueada' THEN 'bloqueada' ELSE 'inadimplente' END WHERE id = ?").bind(contaId).run();
    await registra(db, 'aviso', contaId, 'assinatura pausada pelo Mercado Pago (pagamento recusado)');
  } else if (status === 'cancelada') {
    const atual = await db.prepare("SELECT 1 FROM assinaturas WHERE conta_id = ? AND status = 'ativa'").bind(contaId).first();
    if (!atual) { // sem outra ativa: volta para "teste" valendo até o fim do período já pago
      const ate = mpData(pre.next_payment_date) || new Date().toISOString().slice(0, 19).replace('T', ' ');
      await db.prepare("UPDATE contas SET plano = 'teste', teste_ate = ?, status = CASE WHEN status = 'bloqueada' THEN 'bloqueada' ELSE 'ativa' END WHERE id = ?").bind(ate, contaId).run();
      await registra(db, 'aviso', contaId, 'assinatura cancelada; acesso até ' + ate);
    }
  }
  return a;
}
// registra uma cobrança mensal (pagamento autorizado da assinatura)
async function sincronizaCobranca(db, env, pagId) {
  const c = await mp(env, '/authorized_payments/' + encodeURIComponent(pagId));
  const a = await db.prepare('SELECT id, conta_id FROM assinaturas WHERE gateway_id = ?').bind(String(c.preapproval_id)).first();
  if (!a) return null;
  const st = c.payment?.status || c.status || 'desconhecido', valor = Math.round((c.transaction_amount || 0) * 100);
  await db.prepare(`INSERT INTO cobrancas (conta_id, assinatura_id, gateway_id, status, valor, data, criado_em) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(gateway_id) DO UPDATE SET status = excluded.status, valor = excluded.valor, data = excluded.data`).bind(a.conta_id, a.id, String(c.id), st, valor, mpData(c.debit_date || c.date_created)).run();
  if (st === 'approved') { await db.prepare("UPDATE assinaturas SET ultimo_pagamento = ?, atualizado_em = datetime('now') WHERE id = ?").bind(mpData(c.debit_date || c.date_created), a.id).run();
    await db.prepare("UPDATE contas SET status = 'ativa' WHERE id = ? AND status = 'inadimplente'").bind(a.conta_id).run(); }
  else if (['rejected', 'cancelled'].includes(st)) await registra(db, 'aviso', a.conta_id, 'cobrança ' + st + ' (' + (valor / 100).toFixed(2) + ')');
  return a;
}
// confere a assinatura do webhook (x-signature) quando MP_WEBHOOK_SECRET está configurado
async function webhookAssinado(req, env, dataId) {
  if (!env.MP_WEBHOOK_SECRET) return true;
  const sig = Object.fromEntries((req.headers.get('x-signature') || '').split(',').map(p => p.trim().split('=')));
  if (!sig.ts || !sig.v1) return false;
  const manifesto = `id:${String(dataId).toLowerCase()};request-id:${req.headers.get('x-request-id') || ''};ts:${sig.ts};`;
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.MP_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const h = [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(manifesto)))].map(b => b.toString(16).padStart(2, '0')).join('');
  return iguais(h, sig.v1);
}
async function rotaWebhookMP(req, db, env) {
  const url = new URL(req.url), b = await corpo(req);
  const tipo = b.type || url.searchParams.get('type') || url.searchParams.get('topic') || '', dataId = b.data?.id || url.searchParams.get('data.id') || url.searchParams.get('id') || '';
  if (!dataId) return new Response('ok', { status: 200 });
  if (!await webhookAssinado(req, env, dataId)) { await registra(db, 'aviso', null, 'webhook MP com assinatura inválida'); return new Response('assinatura inválida', { status: 401 }); }
  const chave = b.id ? 'mp:' + b.id : null; // o MP numera cada aviso; o mesmo pode chegar várias vezes (sem número, processa — a sincronização é idempotente)
  if (chave && await db.prepare('SELECT 1 FROM webhooks WHERE chave = ?').bind(chave).first()) return new Response('ok', { status: 200 });
  try {
    if (tipo === 'subscription_preapproval') await sincronizaAssinatura(db, env, dataId);
    else if (tipo === 'subscription_authorized_payment') await sincronizaCobranca(db, env, dataId);
    else return new Response('ok', { status: 200 }); // outros tipos (payment, plan) não interessam
    if (chave) await db.batch([db.prepare("INSERT OR IGNORE INTO webhooks (chave, recebido_em) VALUES (?, datetime('now'))").bind(chave), db.prepare("DELETE FROM webhooks WHERE recebido_em < datetime('now','-30 days')")]);
  } catch (e) {
    if (e.codigo === 404) return new Response('ok', { status: 200 }); // id que não existe no MP: nada a fazer
    await registra(db, 'erro', null, 'webhook MP ' + tipo + ' ' + dataId + ': ' + e.message); return new Response('erro', { status: 500 }); // 500 faz o MP tentar de novo
  }
  return new Response('ok', { status: 200 });
}
async function rotaAssinatura(req, db, env, m, seg, b, S) {
  const conta = S.conta, origem = new URL(req.url).origin;
  if (conta === CONTA_SITE) return erro('A conta da Branco não paga assinatura.');
  if (m === 'GET') {
    const [a, cs] = await db.batch([db.prepare("SELECT id, plano, status, valor, proximo_pagamento, ultimo_pagamento, criado_em FROM assinaturas WHERE conta_id = ? ORDER BY (status = 'ativa') DESC, id DESC LIMIT 1").bind(conta),
      db.prepare('SELECT status, valor, data FROM cobrancas WHERE conta_id = ? ORDER BY data DESC, id DESC LIMIT 24').bind(conta)]);
    const planos = Object.fromEntries(Object.entries(PLANOS).filter(([id]) => id !== 'teste'));
    return json({ planos, atual: a.results[0] || null, cobrancas: cs.results, uso: await consumo(db, S), configurado: !!env.MP_ACCESS_TOKEN, contaStatus: S.status });
  }
  if (seg[1] === 'criar' && m === 'POST') { // gera o link de pagamento do Mercado Pago para o plano escolhido
    if (S.papel !== 'dono') return erro('Só o dono da conta pode assinar.', 403);
    const plano = PLANOS[b.plano] && b.plano !== 'teste' ? b.plano : null; if (!plano) return erro('Escolha um plano.');
    if (await excedeu(db, 'assin:' + conta, 10, 60)) return erro('Muitas tentativas. Espere alguns minutos.', 429);
    const pre = await mp(env, '/preapproval', { method: 'POST', body: JSON.stringify({ reason: 'Branco — ' + PLANOS[plano].nome, external_reference: conta + ':' + plano, payer_email: S.email || undefined,
      auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: PLANOS[plano].preco / 100, currency_id: 'BRL' }, back_url: origem + '/admin?pagamento=voltou', status: 'pending' }) });
    await db.prepare("INSERT INTO assinaturas (conta_id, plano, gateway, gateway_id, status, valor, criado_em) VALUES (?, ?, 'mp', ?, 'pendente', ?, datetime('now'))").bind(conta, plano, String(pre.id), PLANOS[plano].preco).run();
    await registra(db, 'info', conta, 'link de pagamento criado: ' + plano);
    return json({ ok: true, url: pre.init_point });
  }
  if (seg[1] === 'sincronizar' && m === 'POST') { // o painel chama ao voltar do Mercado Pago (o webhook pode demorar)
    const pend = (await db.prepare("SELECT gateway_id FROM assinaturas WHERE conta_id = ? AND status IN ('pendente','ativa','pausada') ORDER BY id DESC LIMIT 3").bind(conta).all()).results;
    for (const p of pend) await sincronizaAssinatura(db, env, p.gateway_id).catch(() => {});
    return json({ ok: true });
  }
  if (seg[1] === 'cancelar' && m === 'POST') {
    if (S.papel !== 'dono') return erro('Só o dono da conta pode cancelar.', 403);
    const a = await db.prepare("SELECT gateway_id FROM assinaturas WHERE conta_id = ? AND status IN ('ativa','pausada','pendente') ORDER BY id DESC LIMIT 1").bind(conta).first();
    if (!a) return erro('Não há assinatura ativa.');
    await mp(env, '/preapproval/' + encodeURIComponent(a.gateway_id), { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) });
    await sincronizaAssinatura(db, env, a.gateway_id);
    return json({ ok: true });
  }
  return erro('Rota não encontrada.', 404);
}

/* ---------- painel do SaaS (só para o administrador do Branco) ---------- */
async function rotaSaas(req, db, env, m, seg, b) {
  const id = seg[1] === 'contas' && seg[2] ? Number(seg[2]) : null, ciclo = cicloAtual();
  if (m === 'GET' && !seg[1]) {
    const [cs, lg, rec] = await db.batch([
      db.prepare(`SELECT c.id, c.nome, c.plano, c.status, c.teste_ate, c.criado_em, u.email dono_email, u.nome dono_nome,
          (SELECT encontradas FROM uso WHERE conta_id = c.id AND ciclo = ?) usado,
          (SELECT COUNT(*) FROM contatos WHERE conta_id = c.id) contatos,
          (SELECT COUNT(*) FROM membros WHERE conta_id = c.id) usuarios,
          (SELECT MAX(criado_em) FROM sessoes WHERE conta_id = c.id) ultimo_login
        FROM contas c LEFT JOIN membros mb ON mb.conta_id = c.id AND mb.papel = 'dono' LEFT JOIN usuarios u ON u.id = mb.usuario_id
        WHERE c.id <> ? GROUP BY c.id ORDER BY c.criado_em DESC`).bind(ciclo, CONTA_SITE),
      db.prepare('SELECT nivel, conta_id, texto, criado_em FROM log ORDER BY id DESC LIMIT 60'),
      db.prepare("SELECT COALESCE(SUM(valor),0) v, COUNT(*) n FROM cobrancas WHERE status = 'approved' AND substr(data,1,7) = ?").bind(ciclo)]);
    const contas = cs.results.map(c => ({ ...c, usado: c.usado || 0, limite: (PLANOS[c.plano] || PLANOS.teste).empresas, preco: (PLANOS[c.plano] || PLANOS.teste).preco }));
    const agora = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const ativas = contas.filter(c => c.status === 'ativa'), pagantes = ativas.filter(c => c.plano !== 'teste'), teste = ativas.filter(c => c.plano === 'teste');
    return json({ ciclo, planos: PLANOS, kpis: { contas: contas.length, pagantes: pagantes.length, teste: teste.filter(c => !c.teste_ate || c.teste_ate >= agora).length, testeVencido: teste.filter(c => c.teste_ate && c.teste_ate < agora).length,
      bloqueadas: contas.filter(c => c.status === 'bloqueada').length, inadimplentes: contas.filter(c => c.status === 'inadimplente').length, mrr: pagantes.reduce((a, c) => a + c.preco, 0), recebidoMes: rec.results[0]?.v || 0, cobrancasMes: rec.results[0]?.n || 0, buscasMes: contas.reduce((a, c) => a + c.usado, 0) }, contas, log: lg.results });
  }
  if (seg[1] === 'contas' && m === 'POST' && !id) { // criar conta na mão (ex.: cliente que pagou por fora)
    const email = emailOk(b.email), nome = txt(b.nome, 80), plano = PLANOS[b.plano] ? b.plano : 'start', senha = txt(b.senha, 80) || aleatorio(10);
    if (!email || !nome) return erro('Coloque o nome da conta e o e-mail do dono.');
    if (await db.prepare('SELECT 1 FROM usuarios WHERE email = ?').bind(email).first()) return erro('Este e-mail já tem conta.');
    const c = await db.prepare("INSERT INTO contas (nome, plano, status, criado_em, teste_ate) VALUES (?, ?, 'ativa', datetime('now'), ?)").bind(nome, plano, plano === 'teste' ? new Date(Date.now() + TESTE_DIAS * 864e5).toISOString().slice(0, 19).replace('T', ' ') : null).run();
    const u = await db.prepare("INSERT INTO usuarios (email, senha, nome, verificado, admin_saas, criado_em) VALUES (?, ?, ?, 1, 0, datetime('now'))").bind(email, await hashSenha(senha), txt(b.dono, 80) || nome).run();
    await db.batch([db.prepare("INSERT INTO membros (conta_id, usuario_id, papel, criado_em) VALUES (?, ?, 'dono', datetime('now'))").bind(c.meta.last_row_id, u.meta.last_row_id),
      ...MODELOS_INICIAIS.map(x => db.prepare("INSERT INTO modelos (titulo, texto, conta_id, criado_em) VALUES (?, ?, ?, datetime('now'))").bind(...x, c.meta.last_row_id))]);
    const enviado = await enviaEmail(env, email, 'Seu acesso ao Branco', `Olá! Sua conta "${nome}" está pronta.\n\nAcesse: ${new URL(req.url).origin}/admin\nE-mail: ${email}\nSenha: ${senha}\n\nTroque a senha em Conta > Trocar senha.`);
    await registra(db, 'info', c.meta.last_row_id, `conta criada pelo admin: ${email} (${plano})`);
    return json({ ok: true, id: c.meta.last_row_id, senha: enviado ? undefined : senha }); // sem e-mail configurado, mostra a senha para você repassar
  }
  if (id && id === CONTA_SITE) return erro('A conta da Branco não pode ser alterada por aqui.');
  if (id && m === 'PATCH') {
    const q = [];
    if (b.plano && PLANOS[b.plano]) q.push(db.prepare('UPDATE contas SET plano = ? WHERE id = ?').bind(b.plano, id));
    if (['ativa', 'bloqueada', 'inadimplente'].includes(b.status)) q.push(db.prepare('UPDATE contas SET status = ? WHERE id = ?').bind(b.status, id));
    if (b.teste_mais_dias) q.push(db.prepare("UPDATE contas SET plano = 'teste', status = 'ativa', teste_ate = datetime(MAX(COALESCE(teste_ate, datetime('now')), datetime('now')), ?) WHERE id = ?").bind(`+${inteiro(b.teste_mais_dias, 1, 365)} days`, id));
    if (b.zerar_uso) q.push(db.prepare('DELETE FROM uso WHERE conta_id = ? AND ciclo = ?').bind(id, ciclo));
    if (!q.length) return erro('Nada para alterar.');
    await db.batch(q); await registra(db, 'info', id, 'admin alterou a conta: ' + JSON.stringify(b).slice(0, 200));
    return json({ ok: true });
  }
  if (id && m === 'DELETE') { // apaga a conta e tudo dela
    const us = (await db.prepare('SELECT usuario_id FROM membros WHERE conta_id = ?').bind(id).all()).results.map(x => x.usuario_id);
    await db.batch([...['contatos', 'modelos', 'vendas', 'clientes', 'links', 'extrato', 'eventos', 'visitas_cliente', 'sessoes', 'config_conta', 'uso', 'empresas_vistas', 'membros', 'assinaturas', 'cobrancas'].map(t => db.prepare(`DELETE FROM ${t} WHERE conta_id = ?`).bind(id)),
      ...us.map(u => db.prepare('DELETE FROM usuarios WHERE id = ? AND NOT EXISTS (SELECT 1 FROM membros WHERE usuario_id = ? AND conta_id <> ?)').bind(u, u, id)),
      ...us.map(u => db.prepare('DELETE FROM tokens_email WHERE usuario_id = ?').bind(u)), db.prepare('DELETE FROM contas WHERE id = ?').bind(id)]);
    await registra(db, 'aviso', id, 'conta excluída pelo admin');
    return json({ ok: true });
  }
  return erro('Rota não encontrada.', 404);
}

/* ---------- prospecção ---------- */
// nicho → etiquetas do OpenStreetMap e termo de busca do Google
const NICHOS = [
  ['restaurante', 'Restaurante', 'Alimentação', 'amenity=restaurant'], ['pizzaria', 'Pizzaria', 'Alimentação', 'amenity=restaurant&cuisine=pizza'],
  ['hamburgueria', 'Hamburgueria / lanchonete', 'Alimentação', 'amenity=fast_food'], ['cafeteria', 'Cafeteria', 'Alimentação', 'amenity=cafe'],
  ['bar', 'Bar / pub', 'Alimentação', 'amenity=bar|amenity=pub'], ['padaria', 'Padaria', 'Alimentação', 'shop=bakery'],
  ['confeitaria', 'Confeitaria / doceria', 'Alimentação', 'shop=confectionery|shop=pastry'], ['sorveteria', 'Sorveteria / açaí', 'Alimentação', 'amenity=ice_cream'],
  ['mercado', 'Mercado / conveniência', 'Alimentação', 'shop=supermarket|shop=convenience'], ['acougue', 'Açougue', 'Alimentação', 'shop=butcher'],
  ['salao', 'Salão de beleza', 'Beleza', 'shop=hairdresser'], ['barbearia', 'Barbearia', 'Beleza', 'shop=barber|hairdresser=barber'],
  ['estetica', 'Clínica de estética', 'Beleza', 'shop=beauty'], ['manicure', 'Manicure / nail designer', 'Beleza', 'beauty=nails'],
  ['tatuagem', 'Estúdio de tatuagem', 'Beleza', 'shop=tattoo'], ['cosmeticos', 'Loja de cosméticos', 'Beleza', 'shop=cosmetics|shop=perfumery'],
  ['dentista', 'Dentista', 'Saúde', 'amenity=dentist|healthcare=dentist'], ['clinica', 'Clínica médica', 'Saúde', 'amenity=clinic|amenity=doctors'],
  ['psicologo', 'Psicólogo', 'Saúde', 'healthcare=psychotherapist|healthcare:speciality=psychology'], ['fisioterapia', 'Fisioterapia', 'Saúde', 'healthcare=physiotherapist'],
  ['nutricionista', 'Nutricionista', 'Saúde', 'healthcare=nutrition_counselling|healthcare:speciality=nutrition'], ['farmacia', 'Farmácia', 'Saúde', 'amenity=pharmacy'],
  ['otica', 'Ótica', 'Saúde', 'shop=optician'], ['veterinario', 'Veterinário', 'Pet', 'amenity=veterinary'], ['petshop', 'Pet shop', 'Pet', 'shop=pet|shop=pet_grooming'],
  ['academia', 'Academia', 'Esporte', 'leisure=fitness_centre'], ['pilates', 'Pilates / yoga', 'Esporte', 'sport=pilates|sport=yoga'],
  ['crossfit', 'Crossfit / luta', 'Esporte', 'sport=crossfit|sport=martial_arts'],
  ['advogado', 'Advogado', 'Serviços', 'office=lawyer'], ['contador', 'Contador', 'Serviços', 'office=accountant'], ['imobiliaria', 'Imobiliária', 'Serviços', 'office=estate_agent'],
  ['arquiteto', 'Arquiteto', 'Serviços', 'office=architect'], ['construtora', 'Construtora / reformas', 'Serviços', 'craft=builder|office=construction_company'],
  ['fotografo', 'Fotógrafo', 'Serviços', 'craft=photographer|shop=photo'], ['eventos', 'Buffet / eventos', 'Serviços', 'amenity=events_venue|craft=caterer'],
  ['lavanderia', 'Lavanderia', 'Serviços', 'shop=laundry|shop=dry_cleaning'], ['autoescola', 'Autoescola', 'Educação', 'amenity=driving_school'],
  ['idiomas', 'Escola de idiomas', 'Educação', 'amenity=language_school'], ['escola', 'Escola / cursos', 'Educação', 'amenity=school|amenity=college'],
  ['oficina', 'Oficina mecânica', 'Automotivo', 'shop=car_repair'], ['lavacar', 'Lava-car / estética automotiva', 'Automotivo', 'amenity=car_wash'],
  ['autopecas', 'Autopeças', 'Automotivo', 'shop=car_parts'], ['concessionaria', 'Loja de carros', 'Automotivo', 'shop=car'],
  ['roupas', 'Loja de roupas', 'Comércio', 'shop=clothes|shop=boutique'], ['calcados', 'Loja de calçados', 'Comércio', 'shop=shoes'],
  ['joalheria', 'Joalheria / acessórios', 'Comércio', 'shop=jewelry'], ['moveis', 'Loja de móveis / decoração', 'Comércio', 'shop=furniture|shop=interior_decoration'],
  ['construcao', 'Material de construção', 'Comércio', 'shop=hardware|shop=doityourself'], ['eletronicos', 'Celulares / eletrônicos', 'Comércio', 'shop=mobile_phone|shop=electronics'],
  ['floricultura', 'Floricultura', 'Comércio', 'shop=florist'], ['papelaria', 'Papelaria / gráfica', 'Comércio', 'shop=stationery|shop=copyshop'],
  ['hotel', 'Hotel / pousada', 'Turismo', 'tourism=hotel|tourism=guest_house|tourism=hostel'], ['agencia', 'Agência de viagens', 'Turismo', 'shop=travel_agency'],
].map(([id, nome, grupo, osm]) => ({ id, nome, grupo, osm: osm.split('|').map(t => t.split('&').map(kv => kv.split('='))) }));
// nome do nicho em inglês: usado nas buscas quando o país é os Estados Unidos
const NICHO_EN = { restaurante: 'restaurant', pizzaria: 'pizza restaurant', hamburgueria: 'burger restaurant', cafeteria: 'coffee shop', bar: 'bar', padaria: 'bakery', confeitaria: 'cake shop', sorveteria: 'ice cream shop',
  mercado: 'grocery store', acougue: 'butcher shop', salao: 'hair salon', barbearia: 'barber shop', estetica: 'med spa', manicure: 'nail salon', tatuagem: 'tattoo studio', cosmeticos: 'beauty supply store',
  dentista: 'dentist', clinica: 'medical clinic', psicologo: 'psychologist', fisioterapia: 'physical therapy', nutricionista: 'nutritionist', farmacia: 'pharmacy', otica: 'optical store', veterinario: 'veterinarian',
  petshop: 'pet store', academia: 'gym', pilates: 'pilates studio', crossfit: 'crossfit gym', advogado: 'law firm', contador: 'accountant', imobiliaria: 'real estate agency', arquiteto: 'architect',
  construtora: 'general contractor', fotografo: 'photographer', eventos: 'event venue', lavanderia: 'laundromat', autoescola: 'driving school', idiomas: 'language school', escola: 'school',
  oficina: 'auto repair shop', lavacar: 'car wash', autopecas: 'auto parts store', concessionaria: 'car dealer', roupas: 'clothing store', calcados: 'shoe store', joalheria: 'jewelry store',
  moveis: 'furniture store', construcao: 'hardware store', eletronicos: 'electronics store', floricultura: 'florist', papelaria: 'print shop', hotel: 'hotel', agencia: 'travel agency' };

const UA = { 'User-Agent': 'BrancoPainel/1.0 (+https://produtoinf.github.io/brancoweb)' };
function telefone(t, pais) { // devolve número com DDI e se parece celular (WhatsApp)
  let d = String(t || '').split(/[;,/]/)[0].replace(/\D/g, ''); if (!d) return null;
  const br = /bra[sz]il/i.test(pais || ''), us = ehEUA(pais);
  if (br) { d = d.replace(/^0+/, ''); if (d.length === 10 || d.length === 11) d = '55' + d; }
  if (us) { d = d.replace(/^0+/, ''); if (d.length === 10) d = '1' + d; if (d.length !== 11 || d[0] !== '1') return null; }
  const cel = br ? /^55\d{2}9\d{8}$/.test(d) : null; // nos EUA não dá para saber se é celular pelo número
  return { num: d, cel };
}
async function buscaOSM({ nicho, termo, cidade, estado, pais }) {
  const p = new URLSearchParams({ format: 'jsonv2', limit: '1', country: pais }); if (cidade) p.set('city', cidade); if (estado) p.set('state', estado);
  let geo = [];
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?' + p, { headers: UA, signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error('Serviço de mapas ocupado (OpenStreetMap). Tente de novo em 1 minuto ou use o Google Maps.');
    geo = await r.json();
  } catch (e) { throw new Error(e.message.startsWith('Serviço') ? e.message : 'O OpenStreetMap não respondeu. Tente de novo ou use o Google Maps.'); }
  const g = geo[0]; if (!g) throw new Error('Não encontrei essa cidade. Confira o nome, o estado e o país.');
  const area = g.osm_type === 'relation' ? 3600000000 + Number(g.osm_id) : g.osm_type === 'way' ? 2400000000 + Number(g.osm_id) : null;
  const onde = area ? '(area.a)' : `(around:8000,${g.lat},${g.lon})`;
  const n = NICHOS.find(x => x.id === nicho), esc = s => s.replace(/[\\"]/g, '');
  const filtros = n ? n.osm.map(t => 'nwr' + t.map(([k, v]) => `["${k}"="${v}"]`).join('') + onde + ';') : [];
  if (termo) filtros.push(`nwr["name"~"${esc(termo)}",i]["shop"]${onde};`, `nwr["name"~"${esc(termo)}",i]["amenity"]${onde};`, `nwr["name"~"${esc(termo)}",i]["office"]${onde};`, `nwr["name"~"${esc(termo)}",i]["craft"]${onde};`, `nwr["name"~"${esc(termo)}",i]["healthcare"]${onde};`);
  if (!filtros.length) throw new Error('Escolha um nicho ou digite uma palavra.');
  const ql = `[out:json][timeout:25];${area ? `area(id:${area})->.a;` : ''}(${filtros.join('')});out center tags 400;`;
  let dados = null;
  // vários servidores públicos: se um recusar ou demorar, tenta o próximo
  for (const u of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']) {
    try {
      const r = await fetch(u, { method: 'POST', headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(ql), signal: AbortSignal.timeout(15000) });
      if (r.ok) { dados = await r.json(); break; }
    } catch {}
  }
  if (!dados) throw new Error('Os servidores do OpenStreetMap não responderam agora (eles são gratuitos e às vezes ficam lotados). Tente de novo em 1 minuto ou use o Google Maps.');
  const lugar = g.display_name.split(',').slice(0, 3).join(',');
  const itens = dados.elements.filter(e => e.tags?.name).map(e => {
    const t = e.tags, a = k => t[k] || t['contact:' + k], lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    const tel = telefone(a('mobile') || a('whatsapp') || a('phone'), pais);
    const end = [t['addr:street'] && (t['addr:street'] + (t['addr:housenumber'] ? ', ' + t['addr:housenumber'] : '')), t['addr:suburb'], t['addr:city'] || cidade].filter(Boolean).join(' · ');
    return { id: 'osm:' + e.type[0] + e.id, nome: t.name, categoria: n?.nome || t.shop || t.amenity || t.office || t.craft || '', telefone: tel?.num || null, celular: tel?.cel ?? null,
      whatsapp: !!a('whatsapp'), site: a('website') || t.url || null, instagram: a('instagram') || null, email: a('email') || null, endereco: end || null,
      maps: lat ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.name)}%20${lat},${lon}` : null };
  });
  return { fonte: 'osm', lugar, itens };
}
async function buscaGoogle(env, { nicho, termo, cidade, estado, pais }) {
  const n = NICHOS.find(x => x.id === nicho), oque = termo || (ehEUA(pais) ? NICHO_EN[nicho] : null) || n?.nome; if (!oque) throw new Error('Escolha um nicho ou digite uma palavra.');
  const us = ehEUA(pais), textQuery = us ? `${oque} in ${[cidade, estado, 'USA'].filter(Boolean).join(', ')}` : `${oque} em ${[cidade, estado, pais].filter(Boolean).join(', ')}`, itens = [];
  let token = '';
  for (let i = 0; i < 3; i++) { // até 60 resultados (3 páginas)
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_PLACES_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.googleMapsUri,places.rating,places.userRatingCount,places.primaryTypeDisplayName,places.businessStatus,nextPageToken' },
      body: JSON.stringify({ textQuery, languageCode: idioma(pais), pageSize: 20, ...(token ? { pageToken: token } : {}) }) });
    const d = await r.json(); if (!r.ok) throw new Error('Google: ' + (d.error?.message || 'erro na busca'));
    for (const pl of d.places || []) {
      if (pl.businessStatus && pl.businessStatus !== 'OPERATIONAL') continue;
      const tel = telefone(pl.internationalPhoneNumber || pl.nationalPhoneNumber, pais);
      itens.push({ id: 'g:' + pl.id, nome: pl.displayName?.text, categoria: pl.primaryTypeDisplayName?.text || n?.nome || '', telefone: tel?.num || null, celular: tel?.cel ?? null, whatsapp: false,
        site: pl.websiteUri || null, instagram: /instagram\.com/.test(pl.websiteUri || '') ? pl.websiteUri : null, email: null, endereco: pl.formattedAddress || null, maps: pl.googleMapsUri || null,
        avaliacao: pl.rating || null, avaliacoes: pl.userRatingCount || 0 });
    }
    token = d.nextPageToken; if (!token) break;
  }
  return { fonte: 'google', lugar: [cidade, estado, pais].filter(Boolean).join(', '), itens };
}
const PAISES = { brasil: ['BR', 'BRA'], brazil: ['BR', 'BRA'], portugal: ['PT', 'PRT'], argentina: ['AR', 'ARG'], paraguai: ['PY', 'PRY'], uruguai: ['UY', 'URY'], chile: ['CL', 'CHL'],
  'estados unidos': ['US', 'USA'], eua: ['US', 'USA'], espanha: ['ES', 'ESP'], mexico: ['MX', 'MEX'], colombia: ['CO', 'COL'] };
const codPais = p => PAISES[String(p || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()] || [];
const ehEUA = p => codPais(p)[0] === 'US' || /^(usa|united states)$/i.test(String(p || '').trim());
const idioma = p => ehEUA(p) ? 'en-US' : 'pt-BR'; // idioma pedido às fontes (TomTom, HERE, Google)
const raioBusca = f => f.cidade ? 15000 : 60000; // só estado → raio maior em volta da capital/centro
const oQue = f => { const n = NICHOS.find(x => x.id === f.nicho); const q = f.termo || (ehEUA(f.pais) ? NICHO_EN[f.nicho] : null) || n?.nome?.split(' / ')[0]; if (!q) throw new Error('Escolha um nicho ou digite uma palavra.'); return { q, n }; };
const mapaLink = (nome, lat, lon) => lat != null ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(nome)}%20${lat},${lon}` : null;

// TomTom: 2.500 buscas grátis por dia, sem cartão (chave em TOMTOM_KEY)
async function buscaTomTom(env, f) {
  const { q, n } = oQue(f), [cc] = codPais(f.pais), lugar = [f.cidade, f.estado, f.pais].filter(Boolean).join(', '), k = encodeURIComponent(env.TOMTOM_KEY);
  const pega = async u => { const r = await fetch(u, { signal: AbortSignal.timeout(15000) }); const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(r.status === 403 ? 'TomTom: chave inválida ou limite diário atingido.' : 'TomTom: ' + (d.errorText || d.detailedError?.message || 'erro na busca')); return d; };
  const g = await pega(`https://api.tomtom.com/search/2/geocode/${encodeURIComponent(lugar)}.json?key=${k}&limit=1&language=${idioma(f.pais)}${cc ? '&countrySet=' + cc : ''}`);
  const pos = g.results?.[0]?.position; if (!pos) throw new Error('Não encontrei essa cidade. Confira o nome, o estado e o país.');
  const itens = [];
  for (const ofs of [0, 100]) { // até 200 resultados
    const d = await pega(`https://api.tomtom.com/search/2/search/${encodeURIComponent(q)}.json?key=${k}&lat=${pos.lat}&lon=${pos.lon}&radius=${raioBusca(f)}&limit=100&ofs=${ofs}&idxSet=POI&language=${idioma(f.pais)}${cc ? '&countrySet=' + cc : ''}`);
    for (const x of d.results || []) {
      const p = x.poi || {}, a = x.address || {}, tel = telefone(p.phone, f.pais);
      itens.push({ id: 't:' + x.id, nome: p.name, categoria: n?.nome || p.classifications?.[0]?.names?.[0]?.name || p.categories?.[0] || '', // nicho em português; a categoria da TomTom vem em inglês telefone: tel?.num || null, celular: tel?.cel ?? null,
        whatsapp: false, site: p.url ? (/^https?:/i.test(p.url) ? p.url : 'https://' + p.url) : null, instagram: null, email: null,
        endereco: a.freeformAddress || null, cidade: a.municipality || null, maps: mapaLink(p.name, x.position?.lat, x.position?.lon) });
    }
    if ((d.results || []).length < 100) break;
  }
  return { fonte: 'tomtom', lugar, itens };
}

// HERE: plano gratuito com 1.000 buscas por dia (chave em HERE_KEY)
async function buscaHere(env, f) {
  const { q, n } = oQue(f), lugar = [f.cidade, f.estado, f.pais].filter(Boolean).join(', '), k = encodeURIComponent(env.HERE_KEY);
  const pega = async u => { const r = await fetch(u, { signal: AbortSignal.timeout(15000) }); const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'HERE: chave inválida.' : r.status === 429 ? 'HERE: limite de buscas atingido. Tente mais tarde.' : 'HERE: ' + (d.title || 'erro na busca')); return d; };
  const g = await pega(`https://geocode.search.hereapi.com/v1/geocode?q=${encodeURIComponent(lugar)}&limit=1&lang=${idioma(f.pais)}&apiKey=${k}`);
  const pos = g.items?.[0]?.position; if (!pos) throw new Error('Não encontrei essa cidade. Confira o nome, o estado e o país.');
  const d = await pega(`https://discover.search.hereapi.com/v1/discover?q=${encodeURIComponent(q)}&in=circle:${pos.lat},${pos.lng};r=${raioBusca(f)}&limit=100&lang=${idioma(f.pais)}&apiKey=${k}`);
  const itens = (d.items || []).filter(x => !x.resultType || x.resultType === 'place').map(x => {
    const cs = Array.isArray(x.contacts) ? x.contacts : [x.contacts || {}], pick = k => cs.flatMap(c => c?.[k] || []).map(v => v.value).filter(Boolean);
    const tel = telefone(pick('mobile')[0] || pick('phone')[0], f.pais), www = pick('www');
    const insta = www.find(u => /instagram\.com/i.test(u)), site = www.find(u => !/instagram\.com|facebook\.com/i.test(u));
    return { id: 'h:' + x.id, nome: x.title, categoria: (x.categories || []).find(c => c.primary)?.name || x.categories?.[0]?.name || n?.nome || '', telefone: tel?.num || null, celular: tel?.cel ?? null,
      whatsapp: false, site: site || null, instagram: insta || null, email: pick('email')[0] || null, endereco: x.address?.label || null, cidade: x.address?.city || null,
      maps: mapaLink(x.title, x.position?.lat, x.position?.lng) };
  });
  return { fonte: 'here', lugar, itens };
}

async function buscaProspects(env, f) {
  if (!f.cidade && !f.estado) throw new Error('Coloque a cidade ou o estado.');
  const r = f.fonte === 'google' && env.GOOGLE_PLACES_KEY ? await buscaGoogle(env, f)
    : f.fonte === 'tomtom' && env.TOMTOM_KEY ? await buscaTomTom(env, f)
    : f.fonte === 'here' && env.HERE_KEY ? await buscaHere(env, f) : await buscaOSM(f);
  const vistos = new Set(); r.itens = r.itens.filter(x => x.nome && !vistos.has(x.id) && vistos.add(x.id)); // sem repetidos
  // sites que são só Instagram/Facebook/Linktree contam como "sem site próprio"
  r.itens.forEach(x => { if (x.site && /instagram\.com|facebook\.com|linktr\.ee|wa\.me|whatsapp/i.test(x.site)) { x.instagram = x.instagram || (/instagram/.test(x.site) ? x.site : null); x.redeSocial = x.site; x.site = null; } });
  return { ...r, nicho: NICHOS.find(x => x.id === f.nicho)?.nome || f.termo, total: r.itens.length };
}
// procura WhatsApp/telefone/Instagram/e-mail no site do estabelecimento (só sites próprios; plataformas são ignoradas)
const PLATAFORMAS = /tuaagenda|booksy|linktr\.ee|wa\.me|whatsapp|instagram\.com|facebook\.com|negocio\.site|ifood|goomer|agendor|calendly|google\.|anota\.ai|cardapioweb|beacons\.ai/i;
const normBR = d => { d = String(d || '').replace(/\D/g, '').replace(/^0+/, ''); return d.length === 10 || d.length === 11 ? '55' + d : d; };
const normUS = d => { d = String(d || '').replace(/\D/g, '').replace(/^0+/, ''); return d.length === 10 ? '1' + d : d; };
const ehCel = d => /^55\d{2}9\d{8}$/.test(d);
// número completo e válido para o país (Brasil: 55 + DDD + número · EUA: 1 + 10 dígitos)
const foneOk = (d, pais) => ehEUA(pais) ? /^1[2-9]\d{9}$/.test(d) : d.length >= 12 && d.length <= 13;
async function contatosDoSite(url, pais) {
  const us = ehEUA(pais), norm = us ? normUS : normBR;
  let h;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol) || /^(localhost|\d+\.\d+\.\d+\.\d+|\[)/i.test(u.hostname) || PLATAFORMAS.test(u.hostname)) return null;
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BrancoPainel/1.0)', Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(8000), cf: { cacheTtl: 86400 } });
    if (!r.ok || !/html/i.test(r.headers.get('content-type') || '')) return null;
    h = (await r.text()).slice(0, 500000);
  } catch { return null; }
  const wa = [...h.matchAll(/(?:wa\.me\/|whatsapp\.com\/send\/?\?(?:[^"'\s]*?&(?:amp;)?)?phone=)\+?(\d{10,15})/gi)].map(m => norm(m[1]));
  const tel = [...h.matchAll(/href=["']tel:([+\d\s().-]{8,22})/gi)].map(m => norm(m[1]));
  const txt = h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
  const vis = us
    ? [...txt.matchAll(/(?:\+?1[\s.-]?)?\(?\b([2-9]\d{2})\)?[\s.-]?([2-9]\d{2})[\s.-]?(\d{4})\b/g)].map(m => normUS(m[1] + m[2] + m[3]))
    : [...txt.matchAll(/(?:\+?55[\s.-]?)?\(?\b([1-9]{2})\)?[\s.-]?(9[\s.-]?\d{4}|[2-5]\d{3})[\s.-]?(\d{4})\b/g)].map(m => normBR(m[1] + m[2] + m[3]));
  const todos = [...wa, ...tel, ...vis].filter(d => foneOk(d, pais));
  const whats = wa.find(d => foneOk(d, pais)), telefone = whats || (us ? null : todos.find(ehCel)) || todos[0] || null;
  const ig = [...h.matchAll(/instagram\.com\/([A-Za-z0-9_.]{2,30})/gi)].map(m => m[1]).find(x => !/^(p|explore|reel|reels|stories|accounts|sharer|tv)$/i.test(x));
  const email = (h.match(/mailto:([\w.+-]+@[\w-]+\.[\w.-]+)/i) || [])[1] || null;
  if (!telefone && !ig && !email) return null;
  return { telefone, celular: telefone && !us ? ehCel(telefone) : null, whatsapp: !!whats, instagram: ig ? 'https://instagram.com/' + ig : null, email };
}
// pega o telefone (e o site) de um estabelecimento no Google pelo nome + endereço/cidade
// SERPER_KEY = pesquisa normal do Google (serper.dev) · GOOGLE_PLACES_KEY = API oficial do Google Maps
const foneDe = (v, pais) => { const d = (ehEUA(pais) ? normUS : normBR)(String(v || '').replace(/^\+/, '')); return foneOk(d, pais) ? d : null; };
async function telDoGoogle(env, x, pais) {
  const us = ehEUA(pais), q = [x.nome, x.endereco || x.cidade].filter(Boolean).join(' ').slice(0, 200);
  try {
    if (env.SERPER_KEY) {
      const h = { 'Content-Type': 'application/json', 'X-API-KEY': env.SERPER_KEY }, corpo = JSON.stringify(us ? { q, gl: 'us', hl: 'en' } : { q, gl: 'br', hl: 'pt-br' });
      const r = await fetch('https://google.serper.dev/places', { method: 'POST', headers: h, body: corpo, signal: AbortSignal.timeout(8000) });
      const pl = r.ok ? (await r.json()).places?.[0] : null;
      if (pl && (pl.phoneNumber || pl.website)) return { telefone: foneDe(pl.phoneNumber, pais), site: pl.website || null };
      const s = await fetch('https://google.serper.dev/search', { method: 'POST', headers: h, body: corpo, signal: AbortSignal.timeout(8000) });
      const kg = s.ok ? (await s.json()).knowledgeGraph : null; if (!kg) return null;
      const at = Object.entries(kg.attributes || {}).find(([k]) => /telefone|phone/i.test(k));
      return { telefone: foneDe(kg.phoneNumber || at?.[1], pais), site: kg.website || null };
    }
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', { method: 'POST', signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_PLACES_KEY, 'X-Goog-FieldMask': 'places.internationalPhoneNumber,places.nationalPhoneNumber,places.websiteUri' },
      body: JSON.stringify({ textQuery: q, languageCode: idioma(pais), pageSize: 1 }) });
    const pl = r.ok ? (await r.json()).places?.[0] : null; if (!pl) return null;
    return { telefone: foneDe(pl.internationalPhoneNumber || pl.nationalPhoneNumber, pais), site: pl.websiteUri || null };
  } catch { return null; }
}
async function enriquece(env, itens, pais) {
  const google = !!(env.SERPER_KEY || env.GOOGLE_PLACES_KEY), us = ehEUA(pais);
  itens = (Array.isArray(itens) ? itens : []).slice(0, 25).filter(x => x && x.id && (urlOk(x.site) || (google && x.nome)));
  const out = {};
  for (let i = 0; i < itens.length; i += 6) // 6 por vez
    await Promise.all(itens.slice(i, i + 6).map(async x => {
      let c = urlOk(x.site) ? await contatosDoSite(urlOk(x.site), pais) : null;
      if (google && !c?.whatsapp && !c?.celular && (us ? !c?.telefone : true) && x.nome) { // site não tinha celular (nos EUA: nenhum telefone): pergunta ao Google
        const g = await telDoGoogle(env, x, pais);
        const s = g?.site && !urlOk(x.site) ? await contatosDoSite(urlOk(g.site), pais) : null; // site novo achado pelo Google
        if (s?.telefone && (s.whatsapp || s.celular || !c?.telefone)) c = { ...c, ...s, google: false };
        else if (g?.telefone && (!c?.telefone || (!us && ehCel(g.telefone)))) c = { ...c, telefone: g.telefone, celular: us ? null : ehCel(g.telefone), whatsapp: false, google: true };
        if (c && g?.site && !urlOk(x.site)) c.site = g.site;
      }
      if (c) out[x.id] = c;
    }));
  return out;
}

async function salvaProspects(db, conta, itens, usuario) {
  itens = (Array.isArray(itens) ? itens : []).slice(0, 500);
  const ids = [];
  let novos = 0;
  for (const x of itens) {
    const nome = txt(x.nome, 100); if (!nome) { ids.push(null); continue; }
    const tel = digitos(x.telefone), cidade = txt(x.cidade, 80);
    const ja = await db.prepare('SELECT id FROM contatos WHERE conta_id = ? AND ((? IS NOT NULL AND telefone = ?) OR (lower(nome) = lower(?) AND COALESCE(cidade,\'\') = COALESCE(?,\'\'))) LIMIT 1').bind(conta, tel, tel, nome, cidade).first();
    if (ja) { ids.push(ja.id); continue; }
    const r = await db.prepare(`INSERT INTO contatos (lid, nome, empresa, telefone, projeto, status, origem, venda, contatos, site, instagram, endereco, cidade, nicho, maps, notas, conta_id, usuario_id, criado_em)
        VALUES (?, ?, ?, ?, ?, 'enviado', 'prospeccao', 'novo', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
      .bind('p-' + aleatorio(16), nome, nome, tel, txt(x.nicho, 80), urlOk(x.site), txt(x.instagram, 200), txt(x.endereco, 300), cidade, txt(x.nicho, 80), urlOk(x.maps), txt(x.notas, 500), conta, usuario).run();
    ids.push(r.meta?.last_row_id ?? null); novos++;
  }
  return { ok: true, novos, repetidos: itens.length - novos, ids };
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
    const publica = ['/t', '/lead', '/c', '/status', '/c.js', '/chat.js'].includes(p) || p.startsWith('/api/cliente/');
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: publica ? CORS : {} });
    // o painel só aceita alterações vindas dele mesmo (proteção contra pedidos forjados por outros sites)
    if (p.startsWith('/api/') && !publica && req.method !== 'GET') {
      const o = req.headers.get('Origin');
      if (o && o !== url.origin) return erro('Origem não permitida.', 403);
    }
    if (!env.DB) return new Response('Falta ligar o banco D1 com o nome DB neste Worker.', { status: 500 });
    try {
      await prepara(env.DB);
      // rotas que o site chama: limite por IP para robôs não lotarem o banco
      const LIM = { '/t': 400, '/lead': 20, '/c': 400 };
      if (LIM[p] && req.method === 'POST' && await excedeu(env.DB, p + ':' + ip(req), LIM[p], 60)) return new Response(null, { status: 429, headers: CORS });
      if (p === '/t' && req.method === 'POST') return await rotaEvento(req, env.DB);
      if (p === '/lead' && req.method === 'POST') return await rotaLead(req, env.DB);
      if (p === '/c' && req.method === 'POST') return await rotaVisitaCliente(req, env.DB);
      if (p === '/status') return await rotaStatus(env.DB);
      if (p === '/webhook/mp' && req.method === 'POST') return await rotaWebhookMP(req, env.DB, env);
      if (p === '/c.js') return js(contadorCliente(url.origin));
      if (p === '/chat.js') return js('/* assistente: desativado nesta versão */');
      if (p === '/admin') return html(PAINEL_HTML, SEGURANCA);
      if (p.startsWith('/api/cliente/')) { // usado também pela área do cliente dentro do site (outro domínio)
        const r = await apiCliente(env.DB, p.split('/')[3] || '', inteiro(url.searchParams.get('dias'), 1, 365) || 30);
        Object.entries(CORS).forEach(([k, v]) => r.headers.set(k, v)); return r;
      }
      if (p.startsWith('/api/')) return await api(req, env.DB, env, p);
      if (p.startsWith('/cliente/')) return html(CLIENTE_HTML, SEGURANCA);
      if (p === '/') return Response.redirect(url.origin + '/admin', 302);
      return new Response('Não encontrado', { status: 404 });
    } catch (e) {
      console.error(e);
      return p.startsWith('/api/') ? erro('Erro no servidor. Tente de novo.', 500) : new Response('Erro no servidor', { status: 500, headers: CORS });
    }
  },
};
