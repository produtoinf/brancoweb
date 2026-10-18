/* ---------- site demo: templates, conteúdo (IA ou padrão) e página pronta ----------
 * Este arquivo é colado dentro do index.js pelo build (no lugar de // @@DEMO@@).
 * Os templates são fixos: a IA só devolve textos em JSON, que são validados e escapados antes de entrar no HTML.
 * A página da demo não tem nenhum <script> e roda com CSP "script-src 'none'".
 */
const DEMO_TEMPLATES = {
  premium: { nome: 'Premium', desc: 'Sofisticado, tipografia marcante e imagem em destaque.', modo: 'escuro', cor: '#c8a96a', cor2: '#141210' },
  moderno: { nome: 'Moderno', desc: 'Minimalista, seções organizadas e botões em destaque.', modo: 'claro', cor: '#2563eb', cor2: '#0f172a' },
  comercial: { nome: 'Comercial', desc: 'Foco em conversão: benefícios, contato e localização.', modo: 'claro', cor: '#e4572e', cor2: '#1b1b1f' },
};
// estilos prontos que o usuário escolhe no modal ("auto" = o que o template ou a IA sugerir)
const DEMO_ESTILOS = {
  elegante: { modo: 'escuro', cor: '#c8a96a', cor2: '#141210' },
  clean: { modo: 'claro', cor: '#2563eb', cor2: '#0f172a' },
  vibrante: { modo: 'claro', cor: '#e4572e', cor2: '#1b1b1f' },
  natural: { modo: 'claro', cor: '#2f855a', cor2: '#13241a' },
};
const DEMO_STATUS = ['draft', 'generating', 'ready', 'published', 'failed'];
const DEMO_TPL_PREMIUM = /barbearia|salao|estetica|manicure|tatuagem|massagem|dentista|clinica|psicologo|nutricionista|fisioterapia|advogado|arquiteto|joalheria|imobiliaria|fotografo|eventos|hotel/;
const DEMO_TPL_COMERCIAL = /restaurante|pizzaria|hamburgueria|churrascaria|japones|padaria|acougue|mercado|bar|oficina|funilaria|lavacar|autopecas|pneus|motos|limpeza|dedetizacao|chaveiro|eletricista|encanador|pintor|arcondicionado|solar|jardinagem|mudancas|construcao|construtora|vidracaria|metalurgica|marcenaria|gas|bebidas|distribuidora/;

// imagens genéricas do Unsplash (licença Unsplash: uso livre, comercial inclusive, sem atribuição obrigatória)
const DEMO_IMG = id => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1600&q=70`;
const DEMO_IMG_NICHO = { barbearia: '1503951914875-452162b0f3f1', tatuagem: '1503951914875-452162b0f3f1', dentista: '1606811971618-4486d14f3f99',
  padaria: '1509440159596-0249088772ff', confeitaria: '1509440159596-0249088772ff', cafeteria: '1555396273-367ea4eb4db5', construtora: '1503387762-592deb58ef4e',
  arquiteto: '1503387762-592deb58ef4e', engenharia: '1503387762-592deb58ef4e', marcenaria: '1503387762-592deb58ef4e', limpeza: '1581578731548-c64695cc6952',
  dedetizacao: '1581578731548-c64695cc6952', concessionaria: '1492144534655-ae79c964c9d7', lavacar: '1492144534655-ae79c964c9d7', funilaria: '1492144534655-ae79c964c9d7', hotel: '1566073771259-6a8506099945' };
const DEMO_IMG_GRUPO = { 'Alimentação': ['1517248135467-4c7edcad34c4', '1555396273-367ea4eb4db5'], Beleza: ['1560066984-138dadb4c035', null], 'Saúde': ['1519494026892-80bbd2d6fd0d', '1576091160399-112ba8d25d1d'],
  Pet: ['1548199973-03cce0bbc87b', null], Esporte: ['1534438327276-14e5300c3a48', null], Automotivo: ['1486262715619-67b85e0b08d3', '1492144534655-ae79c964c9d7'],
  'Comércio': ['1441986300917-64674bd600d8', null], Turismo: ['1566073771259-6a8506099945', null], 'Educação': ['1497366216548-37526070297c', '1521791136064-7986c2920216'],
  'Indústria': ['1497366216548-37526070297c', '1521791136064-7986c2920216'], 'Serviços': ['1497366811353-6870744d04b2', '1521791136064-7986c2920216'] };

const semAcentoS = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
// identifica o nicho do prospect (pelo nome do nicho da busca ou pela categoria da fonte)
function demoNicho(nicho, categoria) {
  const alvo = [nicho, categoria].map(semAcentoS);
  const n = NICHOS.find(x => alvo.includes(semAcentoS(x.nome)) || alvo.includes(x.id)) || NICHOS.find(x => alvo.some(a => a && semAcentoS(x.nome).split(' / ').some(p => a.includes(p))));
  return { id: n?.id || null, nome: n?.nome || txt(nicho, 80) || txt(categoria, 80) || 'Negócio local', grupo: n?.grupo || 'Serviços' };
}
const demoTemplateSugerido = nichoId => DEMO_TPL_PREMIUM.test(nichoId || '') ? 'premium' : DEMO_TPL_COMERCIAL.test(nichoId || '') ? 'comercial' : 'moderno';
function demoImagens(nichoId, grupo) {
  const g = DEMO_IMG_GRUPO[grupo] || DEMO_IMG_GRUPO['Serviços'], hero = DEMO_IMG_NICHO[nichoId] || g[0];
  const sobre = g[1] && g[1] !== hero ? g[1] : g[0] !== hero ? g[0] : null;
  return { imagem: DEMO_IMG(hero), imagem2: sobre ? DEMO_IMG(sobre) : null };
}

/* ---------- validação: só entra no banco o que tem a forma certa ---------- */
const DEMO_SUGESTOES = ['apresentacao', 'sobre', 'servicos', 'diferenciais']; // textos genéricos do nicho: o painel mostra como "sugestão editável"
const s0 = (v, max) => txt(v, max) || '';
const corOk = (v, pad) => /^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : pad;
const httpsOk = v => { const u = urlOk(v); return u && u.startsWith('https://') ? u : null; };
const itensOk = (L, max, mt, mx) => (Array.isArray(L) ? L : []).slice(0, max).map(x => ({ titulo: s0(x?.titulo, mt), texto: s0(x?.texto, mx) })).filter(x => x.titulo || x.texto);
function limpaConteudo(c) {
  c = c && typeof c === 'object' ? c : {};
  const ct = c.contato && typeof c.contato === 'object' ? c.contato : {};
  return {
    titulo: s0(c.titulo, 100), subtitulo: s0(c.subtitulo, 240), apresentacao: s0(c.apresentacao, 700), sobre: s0(c.sobre, 1000),
    cta: s0(c.cta, 40), cta2: s0(c.cta2, 40), servicos_titulo: s0(c.servicos_titulo, 70),
    servicos: itensOk(c.servicos, 6, 70, 240), diferenciais: itensOk(c.diferenciais, 4, 70, 200),
    contato: { telefone: digitos(ct.telefone) || '', whatsapp: digitos(ct.whatsapp) || '', endereco: s0(ct.endereco, 220), instagram: s0(ct.instagram, 120).replace(/[<>"'\s]/g, ''),
      email: emailOk(ct.email) || '', horario: s0(ct.horario, 140) },
    whatsapp_msg: s0(c.whatsapp_msg, 300),
    sugestoes: (Array.isArray(c.sugestoes) ? c.sugestoes : DEMO_SUGESTOES).filter(k => DEMO_SUGESTOES.includes(k)),
  };
}
function limpaTema(t, template) {
  t = t && typeof t === 'object' ? t : {}; const p = DEMO_TEMPLATES[template] || DEMO_TEMPLATES.moderno;
  return { modo: t.modo === 'escuro' || t.modo === 'claro' ? t.modo : p.modo, cor: corOk(t.cor, p.cor), cor2: corOk(t.cor2, p.cor2), imagem: httpsOk(t.imagem), imagem2: httpsOk(t.imagem2) };
}
const demoJSON = s => { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } };

/* ---------- textos padrão (sem IA, ou quando o usuário prefere): genéricos e editáveis ---------- */
const DEMO_L = {
  pt: { inicio: 'Início', servicos: 'Serviços', sobre: 'Sobre', contato: 'Contato', whats: 'Falar no WhatsApp', ligar: 'Ligar', mapa: 'Ver no mapa', endereco: 'Endereço', telefone: 'Telefone',
    instagram: 'Instagram', email: 'E-mail', horario: 'Horário', diferenciais: 'Por que escolher', menu: 'Menu', selo: 'Demonstração conceitual — site não oficial',
    aviso: 'Este é um exemplo conceitual criado para apresentação. Não é o site oficial de {nome} e não é operado por esse estabelecimento.', contatoT: 'Fale com a gente', ondeT: 'Onde estamos' },
  en: { inicio: 'Home', servicos: 'Services', sobre: 'About', contato: 'Contact', whats: 'Message on WhatsApp', ligar: 'Call', mapa: 'View on map', endereco: 'Address', telefone: 'Phone',
    instagram: 'Instagram', email: 'Email', horario: 'Hours', diferenciais: 'Why choose us', menu: 'Menu', selo: 'Concept demo — not the official website',
    aviso: 'This is a concept example made for presentation purposes. It is not the official website of {nome} and is not operated by this business.', contatoT: 'Get in touch', ondeT: 'Where to find us' },
  es: { inicio: 'Inicio', servicos: 'Servicios', sobre: 'Nosotros', contato: 'Contacto', whats: 'Hablar por WhatsApp', ligar: 'Llamar', mapa: 'Ver en el mapa', endereco: 'Dirección', telefone: 'Teléfono',
    instagram: 'Instagram', email: 'Correo', horario: 'Horario', diferenciais: 'Por qué elegirnos', menu: 'Menú', selo: 'Demostración conceptual — sitio no oficial',
    aviso: 'Este es un ejemplo conceptual creado para una presentación. No es el sitio oficial de {nome} y no es operado por este negocio.', contatoT: 'Contáctanos', ondeT: 'Dónde estamos' },
};
function conteudoPadrao(d) {
  const n = d.nome, cid = d.cidade || '', em = cid ? ' em ' + cid : '';
  const T = {
    pt: { titulo: n, subtitulo: `${d.nicho || 'Atendimento'}${em}. Fale com a gente e tire suas dúvidas.`,
      apresentacao: `Bem-vindo à ${n}. Aqui você encontra atendimento próximo e atencioso${em}. Entre em contato para saber mais.`,
      sobre: `A ${n} atende${em}. Este espaço é para contar a história do negócio, o jeito de trabalhar e o que torna o atendimento especial. (Texto de exemplo para editar.)`,
      cta: 'Falar no WhatsApp', cta2: 'Ver serviços', servicos_titulo: 'Como podemos ajudar',
      servicos: [{ titulo: 'Atendimento', texto: 'Descreva aqui o principal serviço oferecido. (Sugestão editável)' }, { titulo: 'Orçamento', texto: 'Explique como o cliente pode pedir um orçamento ou agendar. (Sugestão editável)' },
        { titulo: 'Localização', texto: `Atendimento${em}. Veja o endereço e como chegar na seção de contato.` }],
      diferenciais: [{ titulo: 'Atendimento próximo', texto: 'Fale direto pelo WhatsApp.' }, { titulo: 'Fácil de encontrar', texto: 'Endereço e mapa logo abaixo.' }, { titulo: 'Tire suas dúvidas', texto: 'Respondemos o quanto antes.' }],
      whatsapp_msg: `Olá! Vi o site da ${n} e gostaria de mais informações.` },
    en: { titulo: n, subtitulo: `${d.nicho || 'Local business'}${cid ? ' in ' + cid : ''}. Get in touch and ask us anything.`,
      apresentacao: `Welcome to ${n}. Friendly, attentive service${cid ? ' in ' + cid : ''}. Contact us to learn more.`,
      sobre: `${n} serves${cid ? ' ' + cid : ' the local area'}. Use this space to tell the story of the business and what makes it special. (Sample text to edit.)`,
      cta: 'Message on WhatsApp', cta2: 'See services', servicos_titulo: 'How we can help',
      servicos: [{ titulo: 'Service', texto: 'Describe the main service here. (Editable suggestion)' }, { titulo: 'Quotes', texto: 'Explain how customers can request a quote or book. (Editable suggestion)' },
        { titulo: 'Location', texto: 'Find the address and directions in the contact section.' }],
      diferenciais: [{ titulo: 'Personal service', texto: 'Talk to us directly on WhatsApp.' }, { titulo: 'Easy to find', texto: 'Address and map below.' }, { titulo: 'Questions?', texto: 'We reply as soon as we can.' }],
      whatsapp_msg: `Hi! I saw the ${n} website and would like more information.` },
    es: { titulo: n, subtitulo: `${d.nicho || 'Negocio local'}${cid ? ' en ' + cid : ''}. Escríbenos y resuelve tus dudas.`,
      apresentacao: `Bienvenido a ${n}. Atención cercana${cid ? ' en ' + cid : ''}. Contáctanos para saber más.`,
      sobre: `${n} atiende${cid ? ' en ' + cid : ''}. Este espacio es para contar la historia del negocio y lo que lo hace especial. (Texto de ejemplo para editar.)`,
      cta: 'Hablar por WhatsApp', cta2: 'Ver servicios', servicos_titulo: 'Cómo podemos ayudar',
      servicos: [{ titulo: 'Atención', texto: 'Describe aquí el servicio principal. (Sugerencia editable)' }, { titulo: 'Presupuesto', texto: 'Explica cómo pedir un presupuesto o agendar. (Sugerencia editable)' },
        { titulo: 'Ubicación', texto: 'Mira la dirección y cómo llegar en la sección de contacto.' }],
      diferenciais: [{ titulo: 'Atención cercana', texto: 'Habla directo por WhatsApp.' }, { titulo: 'Fácil de encontrar', texto: 'Dirección y mapa abajo.' }, { titulo: '¿Dudas?', texto: 'Respondemos lo antes posible.' }],
      whatsapp_msg: `¡Hola! Vi el sitio de ${n} y me gustaría más información.` },
  }[d.idioma] || null;
  return limpaConteudo({ ...(T || conteudoPadrao({ ...d, idioma: 'pt' })), contato: contatoDe(d) });
}
// contato vem só dos dados reais do prospect (a IA nunca inventa telefone, endereço ou e-mail)
const contatoDe = d => ({ telefone: d.telefone || '', whatsapp: d.celular || d.whatsapp ? d.telefone || '' : '', endereco: d.endereco || '', instagram: d.instagram || '', email: d.email || '', horario: '' });

/* ---------- IA (Claude, pela Messages API) ---------- */
// ANTHROPIC_API_KEY liga a IA. DEMO_MODELO troca o modelo (padrão: claude-opus-5-5).
const DEMO_ITEM = { type: 'object', additionalProperties: false, required: ['titulo', 'texto'], properties: { titulo: { type: 'string' }, texto: { type: 'string' } } };
const DEMO_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['titulo', 'subtitulo', 'apresentacao', 'sobre', 'cta', 'cta2', 'servicos_titulo', 'servicos', 'diferenciais', 'whatsapp_msg', 'estilo'],
  properties: { titulo: { type: 'string' }, subtitulo: { type: 'string' }, apresentacao: { type: 'string' }, sobre: { type: 'string' }, cta: { type: 'string' }, cta2: { type: 'string' },
    servicos_titulo: { type: 'string' }, servicos: { type: 'array', items: DEMO_ITEM }, diferenciais: { type: 'array', items: DEMO_ITEM }, whatsapp_msg: { type: 'string' },
    estilo: { type: 'object', additionalProperties: false, required: ['modo', 'cor'], properties: { modo: { type: 'string', enum: ['claro', 'escuro'] }, cor: { type: 'string' } } } } };
const DEMO_IDIOMA_IA = { pt: 'português do Brasil', en: 'inglês dos EUA', es: 'espanhol' };
const DEMO_SISTEMA = `Você escreve os textos de um site DEMONSTRATIVO para um pequeno negócio local. O site é só um exemplo conceitual para apresentar ao dono; ele vai revisar e editar tudo.
Regras obrigatórias:
- Use apenas os dados recebidos (nome, nicho, cidade, estado, país). Não invente nada que pareça fato sobre a empresa.
- Proibido: avaliações, notas, depoimentos, número de clientes, anos de experiência, prêmios, certificações, registros profissionais, preços, promoções, horários, nomes de pessoas, garantias.
- Não afirme que a empresa oferece um serviço específico. Em "servicos" escreva serviços típicos do nicho como possibilidades ("Podemos ajudar com…", "Consulte sobre…"), nunca como certeza.
- Textos curtos, claros e profissionais, sem exageros nem emojis. Título até 60 caracteres; subtítulo até 140; apresentação até 320; sobre até 450; cada serviço: título até 40 e texto até 140; 3 a 6 serviços; 3 diferenciais genéricos (atendimento, localização, contato fácil — nada que exija comprovação).
- cta: chamada principal curta para o WhatsApp; cta2: chamada secundária curta para ver os serviços.
- whatsapp_msg: mensagem que o CLIENTE do negócio enviaria ao clicar no botão do WhatsApp.
- estilo: sugira modo "claro" ou "escuro" e uma cor principal em hexadecimal (#rrggbb) adequada ao nicho.
Escreva tudo no idioma pedido.`;
const DEMO_FALLBACK_OK = /^claude-(opus-5-5|opus-5|fable-5-1|sonnet-5-5)$/; // modelos que aceitam o fallback do servidor em recusas
async function conteudoIA(env, d, template) {
  const modelo = env.DEMO_MODELO || 'claude-opus-5-5', fb = DEMO_FALLBACK_OK.test(modelo);
  const pedido = { empresa: d.nome, nicho: d.nicho, cidade: d.cidade || null, estado: d.estado || null, pais: d.pais || null, idioma: DEMO_IDIOMA_IA[d.idioma] || DEMO_IDIOMA_IA.pt,
    template: DEMO_TEMPLATES[template]?.nome || template, ja_tem_site: !!d.site };
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', ...(fb ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}) },
      body: JSON.stringify({ model: modelo, max_tokens: 8000, system: DEMO_SISTEMA, output_config: { effort: 'low', format: { type: 'json_schema', schema: DEMO_SCHEMA } }, ...(fb ? { fallbacks: 'default' } : {}),
        messages: [{ role: 'user', content: 'Dados do negócio (JSON):\n' + JSON.stringify(pedido) }] }) });
  } catch (e) { throw new Error(e?.name === 'TimeoutError' ? 'a IA demorou demais para responder' : 'não consegui falar com a IA'); }
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 401 ? 'chave ANTHROPIC_API_KEY inválida' : r.status === 429 ? 'limite de uso da IA atingido, tente em instantes' : 'IA: ' + (b.error?.message || r.status));
  if (b.stop_reason === 'refusal') throw new Error('a IA recusou este pedido');
  if (b.stop_reason === 'max_tokens') throw new Error('resposta da IA incompleta');
  const t = (b.content || []).filter(x => x.type === 'text').map(x => x.text).join('');
  let j; try { j = JSON.parse(t); } catch { throw new Error('resposta da IA em formato inválido'); }
  const c = limpaConteudo({ ...j, contato: contatoDe(d) });
  if (!c.titulo || c.servicos.length < 3 || !c.subtitulo) throw new Error('resposta da IA incompleta');
  return { conteudo: c, estilo: { modo: j.estilo?.modo, cor: corOk(j.estilo?.cor, null) } };
}

/* ---------- página pronta ---------- */
const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const foneBonito = (t, idioma) => {
  t = String(t || ''); if (/^1[2-9]\d{9}$/.test(t) && idioma !== 'pt') return `(${t.slice(1, 4)}) ${t.slice(4, 7)}-${t.slice(7)}`;
  const b = t.replace(/^55(?=\d{10,11}$)/, ''); return b.length === 11 ? `(${b.slice(0, 2)}) ${b.slice(2, 7)}-${b.slice(7)}` : b.length === 10 ? `(${b.slice(0, 2)}) ${b.slice(2, 6)}-${b.slice(6)}` : t ? '+' + t : '';
};
const waDe = (t, idioma) => { t = String(t || ''); if (!t) return ''; return (t.length === 10 || t.length === 11) && idioma === 'pt' ? '55' + t : t; };
const instaDe = v => { v = String(v || '').trim(); if (!v) return null; const h = (v.match(/instagram\.com\/([A-Za-z0-9_.]{1,30})/i) || [])[1] || v.replace(/^@/, '').match(/^[A-Za-z0-9_.]{1,30}$/)?.[0]; return h ? { url: 'https://instagram.com/' + h, h: '@' + h } : null; };
// cor do texto em cima da cor principal (preto ou branco, o que tiver mais contraste)
const tintaSobre = hex => { const n = parseInt(hex.slice(1), 16), [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35 ? '#111111' : '#ffffff'; };
const ICONE = {
  whats: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.8-1.4.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.4.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>',
  fone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
  mapa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  insta: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor"/></svg>',
  email: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m4 7 8 6 8-6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m7.5 12.5 3 3 6-6.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
};
const DEMO_FONTES = {
  premium: 'family=Cormorant+Garamond:wght@500;600;700&family=Inter:wght@400;500;600', moderno: 'family=Inter:wght@400;500;600;700;800', comercial: 'family=Archivo:wght@500;600;700;800;900&family=Inter:wght@400;500;600',
};
const DEMO_CSS_BASE = `*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--tx);font:400 1rem/1.65 Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
img{max-width:100%;display:block}a{color:inherit}.w{width:min(1120px,100% - 40px);margin:0 auto}
section{padding:88px 0;scroll-margin-top:64px}h1,h2,h3{margin:0;line-height:1.1;font-family:var(--ft)}h2{font-size:clamp(1.8rem,4vw,2.6rem);letter-spacing:-.02em}
.k{display:inline-block;font:600 .74rem/1 Inter,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:var(--c);margin-bottom:14px}
.mu{color:var(--mu)}.bt{display:inline-flex;align-items:center;gap:10px;padding:15px 26px;border-radius:var(--rb);font:600 .95rem Inter,sans-serif;text-decoration:none;border:1px solid transparent;transition:transform .2s,opacity .2s}
.bt:hover{transform:translateY(-1px);opacity:.92}.bt svg{width:18px;height:18px}.b1{background:var(--c);color:var(--ct)}.b2{border-color:currentColor;color:inherit}
.hd{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--ln)}
.hd .w{display:flex;align-items:center;justify-content:space-between;gap:16px;height:68px}.lg{font:700 1.15rem/1.1 var(--ft);text-decoration:none;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nv{display:flex;align-items:center;gap:26px;font-size:.92rem}.nv a{text-decoration:none;color:var(--mu)}.nv a:hover{color:var(--tx)}.nv .bt{padding:10px 18px;color:var(--ct)}
.mn{display:none;position:relative}.mn summary{list-style:none;cursor:pointer;padding:8px 14px;border:1px solid var(--ln);border-radius:var(--rb);font-size:.88rem}.mn summary::-webkit-details-marker{display:none}
.mn nav{position:absolute;right:0;top:calc(100% + 8px);display:grid;min-width:190px;padding:8px;background:var(--bg);border:1px solid var(--ln);border-radius:12px;box-shadow:0 20px 40px -20px #0006}
.mn nav a{padding:10px 12px;text-decoration:none;border-radius:8px}.mn nav a:hover{background:var(--bg2)}
.gd{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px;margin-top:40px}
.cd{padding:28px;border:1px solid var(--ln);border-radius:var(--rc);background:var(--bg2)}.cd h3{font-size:1.2rem;margin-bottom:8px}.cd p{margin:0;color:var(--mu)}
.cd .n{display:block;font:600 .8rem/1 Inter,sans-serif;color:var(--c);margin-bottom:18px;letter-spacing:.1em}
.sb{display:grid;grid-template-columns:1.1fr .9fr;gap:56px;align-items:center}.sb.so{grid-template-columns:1fr}.sb img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--rc)}
.sb p{white-space:pre-line}.df{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:22px;margin-top:36px}
.df div{display:flex;gap:14px;align-items:flex-start}.df svg{width:26px;height:26px;flex:none;color:var(--c)}.df b{display:block;font-size:1.02rem}.df span{color:var(--mu);font-size:.94rem}
.ct{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px;margin-top:36px}
.ct a,.ct div{display:flex;gap:14px;align-items:flex-start;padding:22px;border:1px solid var(--ln);border-radius:var(--rc);text-decoration:none;background:var(--bg2);min-width:0}
.ct svg{width:22px;height:22px;flex:none;color:var(--c);margin-top:2px}.ct small{display:block;color:var(--mu);font-size:.78rem;text-transform:uppercase;letter-spacing:.08em}.ct b{display:block;font-weight:600;overflow-wrap:anywhere}
.ft{padding:42px 0 90px;border-top:1px solid var(--ln);font-size:.86rem;color:var(--mu)}.ft .w{display:grid;gap:10px}.ft b{color:var(--tx)}
.selo{position:fixed;left:12px;bottom:12px;z-index:30;padding:7px 12px;border-radius:999px;background:#000c;color:#fff;font:500 .7rem/1.2 Inter,sans-serif;letter-spacing:.02em;max-width:calc(100% - 100px)}
.wf{position:fixed;right:16px;bottom:16px;z-index:30;display:grid;place-items:center;width:58px;height:58px;border-radius:50%;background:#25d366;color:#fff;box-shadow:0 12px 30px -10px #0008}.wf svg{width:30px;height:30px}
@media(max-width:820px){section{padding:64px 0}.nv{display:none}.mn{display:block}.sb{grid-template-columns:1fr;gap:28px}}`;
const DEMO_CSS = {
  premium: `:root{--ft:"Cormorant Garamond",Georgia,serif;--rb:2px;--rc:4px}
.hd{background:color-mix(in srgb,var(--bg) 70%,transparent)}.lg{font-size:1.45rem;letter-spacing:.02em}
.hr{position:relative;min-height:min(92vh,820px);display:grid;align-items:end;padding:0;color:#fff;isolation:isolate;overflow:hidden}
.hr img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2}
.hr::after{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(180deg,color-mix(in srgb,var(--c2) 35%,transparent) 0%,color-mix(in srgb,var(--c2) 92%,transparent) 88%)}
.hr .w{padding:120px 0 96px;text-align:center;display:grid;justify-items:center}.hr h1{font-size:clamp(2.8rem,8vw,5.6rem);font-weight:600;letter-spacing:-.01em;max-width:14ch}
.hr p{max-width:56ch;margin:22px auto 34px;color:#ffffffd0;font-size:1.08rem}.hr .ac{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}
.hr .b2{color:#fff}.ap{text-align:center}.ap p{max-width:62ch;margin:18px auto 0;font:500 clamp(1.3rem,2.6vw,1.75rem)/1.5 var(--ft)}
.cd{background:transparent;border-color:var(--ln)}.cd h3{font-size:1.55rem;font-weight:600}
h2{font-weight:600;font-size:clamp(2.2rem,5vw,3.2rem)}.cx{text-align:center}.cx .gd,.cx .ct,.cx .df{text-align:left}`,
  moderno: `:root{--ft:Inter,system-ui,sans-serif;--rb:999px;--rc:20px}
h1,h2{font-weight:800;letter-spacing:-.035em}.lg{font-weight:800;letter-spacing:-.02em}
.hr{padding:72px 0 88px}.hr .w{display:grid;grid-template-columns:1.05fr .95fr;gap:56px;align-items:center}
.hr h1{font-size:clamp(2.5rem,6vw,4.4rem)}.hr p{font-size:1.12rem;color:var(--mu);margin:22px 0 32px;max-width:52ch}.hr .ac{display:flex;gap:12px;flex-wrap:wrap}
.hr img{width:100%;aspect-ratio:5/4;object-fit:cover;border-radius:28px;box-shadow:0 40px 80px -40px #0007}
.tg{display:inline-flex;align-items:center;gap:8px;padding:7px 14px;border-radius:999px;background:var(--bg2);border:1px solid var(--ln);font:500 .8rem Inter,sans-serif;color:var(--mu);margin-bottom:22px}
.tg i{width:8px;height:8px;border-radius:50%;background:var(--c)}.ap{background:var(--bg2)}.ap p{font-size:1.3rem;line-height:1.6;max-width:60ch;margin:14px 0 0}
.cd{background:var(--bg)}.cd .n{width:42px;height:42px;display:grid;place-items:center;border-radius:12px;background:color-mix(in srgb,var(--c) 14%,transparent)}
@media(max-width:820px){.hr .w{grid-template-columns:1fr;gap:32px}}`,
  comercial: `:root{--ft:Archivo,Inter,sans-serif;--rb:10px;--rc:14px}
h1,h2{font-weight:900;letter-spacing:-.03em;text-transform:none}.lg{font-weight:800}
.hr{padding:0;background:var(--c2);color:#fff}.hr .w{display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center;padding:72px 0}
.hr h1{font-size:clamp(2.4rem,6vw,4.2rem)}.hr p{font-size:1.1rem;color:#ffffffcc;margin:20px 0 30px;max-width:50ch}.hr .ac{display:flex;gap:12px;flex-wrap:wrap}
.hr .b2{color:#fff}.hr img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:18px;border:4px solid var(--c)}
.tf{display:flex;gap:14px;flex-wrap:wrap;margin-top:26px;font-size:.9rem;color:#ffffffb0}.tf span{display:inline-flex;align-items:center;gap:8px}.tf svg{width:18px;height:18px;color:var(--c)}
.bn{padding:40px 0;background:var(--bg2);border-bottom:1px solid var(--ln)}.bn .df{margin:0}
.cd{border-left:4px solid var(--c)}.lc{background:var(--c2);color:#fff}.lc .mu{color:#ffffffb0}.lc .ct a,.lc .ct div{background:#ffffff0d;border-color:#ffffff22}.lc .ct small{color:#ffffff99}
.lc .big{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}.lc .big .bt{padding:18px 30px;font-size:1.05rem}.lc .big .b2{color:#fff}
.sc{position:fixed;left:0;right:0;bottom:0;z-index:25;display:none;gap:8px;padding:10px 12px;background:var(--bg);border-top:1px solid var(--ln)}.sc .bt{flex:1;justify-content:center;padding:13px}
@media(max-width:820px){.hr .w{grid-template-columns:1fr;gap:28px;padding:52px 0}.sc{display:flex}.wf{display:none}.selo{bottom:76px}}`,
};
// monta o HTML final da demo (o mesmo na prévia do painel e no link público)
function renderDemo(demo) {
  const tpl = DEMO_TEMPLATES[demo.template] ? demo.template : 'moderno', d = demoJSON(demo.dados), c = limpaConteudo(demoJSON(demo.conteudo));
  const t = limpaTema(demoJSON(demo.tema), tpl), idi = DEMO_L[d.idioma] ? d.idioma : 'pt', L = DEMO_L[idi], e = escH;
  const nome = d.nome || c.titulo || 'Demo', img = t.imagem || demoImagens(d.nichoId, d.grupo).imagem, img2 = t.imagem2;
  const ct = c.contato, wa = waDe(ct.whatsapp, idi), waUrl = wa ? `https://wa.me/${wa}${c.whatsapp_msg ? '?text=' + encodeURIComponent(c.whatsapp_msg) : ''}` : null;
  const tel = ct.telefone, ig = instaDe(ct.instagram), mapa = httpsOk(d.maps) || (ct.endereco ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(nome + ' ' + ct.endereco) : null);
  const claro = t.modo === 'claro';
  const vars = `:root{--c:${t.cor};--c2:${t.cor2};--ct:${tintaSobre(t.cor)};${claro ? '--bg:#ffffff;--bg2:#f6f6f4;--tx:#141417;--mu:#5c5c66;--ln:#e7e7ea' : '--bg:#0c0c0e;--bg2:#141417;--tx:#f3f3f1;--mu:#a6a6ae;--ln:#26262c'}}`;
  const ctaP = waUrl ? `<a class="bt b1" href="${e(waUrl)}" target="_blank" rel="noopener">${ICONE.whats}${e(c.cta || L.whats)}</a>` : tel ? `<a class="bt b1" href="tel:+${e(tel)}">${ICONE.fone}${e(c.cta || L.ligar)}</a>` : `<a class="bt b1" href="#contato">${e(c.cta || L.contato)}</a>`;
  const ctaS = `<a class="bt b2" href="#servicos">${e(c.cta2 || L.servicos)}</a>`;
  const ac = `<div class="ac">${ctaP}${ctaS}</div>`;
  const local = [d.cidade, d.estado].filter(Boolean).join(' · ');
  const hero = {
    premium: `<section class="hr" id="inicio"><img src="${e(img)}" alt="" fetchpriority="high"><div class="w">${local ? `<span class="k">${e(local)}</span>` : ''}<h1>${e(c.titulo || nome)}</h1><p>${e(c.subtitulo)}</p>${ac}</div></section>`,
    moderno: `<section class="hr" id="inicio"><div class="w"><div><span class="tg"><i></i>${e(d.nicho || '')}${local ? ' · ' + e(local) : ''}</span><h1>${e(c.titulo || nome)}</h1><p>${e(c.subtitulo)}</p>${ac}</div><img src="${e(img)}" alt="" fetchpriority="high"></div></section>`,
    comercial: `<section class="hr" id="inicio"><div class="w"><div><span class="k">${e(d.nicho || '')}</span><h1>${e(c.titulo || nome)}</h1><p>${e(c.subtitulo)}</p>${ac}<div class="tf">${local ? `<span>${ICONE.mapa}${e(local)}</span>` : ''}${tel ? `<span>${ICONE.fone}${e(foneBonito(tel, idi))}</span>` : ''}</div></div><img src="${e(img)}" alt="" fetchpriority="high"></div></section>`,
  }[tpl];
  const ap = c.apresentacao ? `<section class="ap"><div class="w"><span class="k">${e(nome)}</span><p>${e(c.apresentacao)}</p></div></section>` : '';
  const serv = c.servicos.length ? `<section id="servicos" class="cx"><div class="w"><span class="k">${e(L.servicos)}</span><h2>${e(c.servicos_titulo || L.servicos)}</h2><div class="gd">${c.servicos.map((s, i) => `<div class="cd"><span class="n">${String(i + 1).padStart(2, '0')}</span><h3>${e(s.titulo)}</h3><p>${e(s.texto)}</p></div>`).join('')}</div></div></section>` : '';
  const sobre = c.sobre ? `<section id="sobre"><div class="w sb${img2 ? '' : ' so'}"><div><span class="k">${e(L.sobre)}</span><h2>${e(nome)}</h2><p class="mu">${e(c.sobre)}</p></div>${img2 ? `<img src="${e(img2)}" alt="" loading="lazy">` : ''}</div></section>` : '';
  const dfItens = c.diferenciais.map(x => `<div>${ICONE.ok}<p style="margin:0"><b>${e(x.titulo)}</b><span>${e(x.texto)}</span></p></div>`).join('');
  const dif = c.diferenciais.length ? (tpl === 'comercial' ? `<div class="bn"><div class="w"><div class="df">${dfItens}</div></div></div>` : `<section class="cx"><div class="w"><span class="k">${e(L.diferenciais)}</span><h2>${e(L.diferenciais)} ${e(nome)}</h2><div class="df">${dfItens}</div></div></section>`) : '';
  const cards = [
    waUrl && `<a href="${e(waUrl)}" target="_blank" rel="noopener">${ICONE.whats}<span><small>WhatsApp</small><b>${e(foneBonito(wa, idi))}</b></span></a>`,
    tel && tel !== wa && `<a href="tel:+${e(tel)}">${ICONE.fone}<span><small>${e(L.telefone)}</small><b>${e(foneBonito(tel, idi))}</b></span></a>`,
    ct.endereco && (mapa ? `<a href="${e(mapa)}" target="_blank" rel="noopener">${ICONE.mapa}<span><small>${e(L.endereco)}</small><b>${e(ct.endereco)}</b></span></a>` : `<div>${ICONE.mapa}<span><small>${e(L.endereco)}</small><b>${e(ct.endereco)}</b></span></div>`),
    ig && `<a href="${e(ig.url)}" target="_blank" rel="noopener">${ICONE.insta}<span><small>${e(L.instagram)}</small><b>${e(ig.h)}</b></span></a>`,
    ct.email && `<a href="mailto:${e(ct.email)}">${ICONE.email}<span><small>${e(L.email)}</small><b>${e(ct.email)}</b></span></a>`,
    ct.horario && `<div>${ICONE.ok}<span><small>${e(L.horario)}</small><b>${e(ct.horario)}</b></span></div>`,
  ].filter(Boolean).join('');
  const contato = tpl === 'comercial'
    ? `<section id="contato" class="lc"><div class="w"><span class="k">${e(L.contato)}</span><h2>${e(L.ondeT)}</h2>${local ? `<p class="mu">${e(local)}</p>` : ''}<div class="big">${ctaP}${mapa ? `<a class="bt b2" href="${e(mapa)}" target="_blank" rel="noopener">${ICONE.mapa}${e(L.mapa)}</a>` : ''}</div>${cards ? `<div class="ct">${cards}</div>` : ''}</div></section>`
    : `<section id="contato" class="cx"><div class="w"><span class="k">${e(L.contato)}</span><h2>${e(L.contatoT)}</h2>${cards ? `<div class="ct">${cards}</div>` : `<p class="mu">${e(local)}</p>`}</div></section>`;
  const ordem = { premium: [hero, ap, sobre, serv, dif, contato], moderno: [hero, serv, ap, sobre, dif, contato], comercial: [hero, dif, serv, contato, sobre] }[tpl];
  const menu = [['inicio', L.inicio], c.servicos.length && ['servicos', L.servicos], c.sobre && ['sobre', L.sobre], ['contato', L.contato]].filter(Boolean);
  const head = `<header class="hd"><div class="w"><a class="lg" href="#inicio">${e(nome)}</a><nav class="nv">${menu.map(m => `<a href="#${m[0]}">${e(m[1])}</a>`).join('')}${waUrl ? `<a class="bt b1" href="${e(waUrl)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</nav>
<details class="mn"><summary>${e(L.menu)}</summary><nav>${menu.map(m => `<a href="#${m[0]}">${e(m[1])}</a>`).join('')}</nav></details></div></header>`;
  const pe = `<footer class="ft"><div class="w"><b>${e(nome)}</b>${local ? `<span>${e(local)}</span>` : ''}<span>${e(L.aviso.replace('{nome}', nome))}</span></div></footer>`;
  const fixos = `<div class="selo">${e(L.selo)}</div>${waUrl ? (tpl === 'comercial' ? `<div class="sc">${ctaP}${tel ? `<a class="bt b2" href="tel:+${e(tel)}">${ICONE.fone}${e(L.ligar)}</a>` : ''}</div>` : '') + `<a class="wf" href="${e(waUrl)}" target="_blank" rel="noopener" aria-label="${e(L.whats)}">${ICONE.whats}</a>` : ''}`;
  return `<!doctype html><html lang="${idi === 'pt' ? 'pt-BR' : idi}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive"><title>${e(nome)} — ${e(L.selo)}</title><meta name="description" content="${e(L.aviso.replace('{nome}', nome))}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://images.unsplash.com"><link href="https://fonts.googleapis.com/css2?${DEMO_FONTES[tpl]}&display=swap" rel="stylesheet">
<style>${vars}${DEMO_CSS_BASE}${DEMO_CSS[tpl]}</style></head><body>${head}<main>${ordem.join('')}</main>${pe}${fixos}</body></html>`;
}
// cabeçalhos da página da demo: sem scripts, sem indexação; a prévia do painel pode ser aberta em iframe do próprio painel
const demoHeaders = publico => ({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': publico ? 'DENY' : 'SAMEORIGIN',
  'Content-Security-Policy': `default-src 'none'; img-src https: data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; base-uri 'none'; form-action 'none'; frame-ancestors ${publico ? "'none'" : "'self'"}` });
const slugDe = nome => (semAcentoS(nome).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'site') + '-' + aleatorio(6);
// endereço público: DEMO_DOMINIO (ex.: demo.seudominio.com, ligado ao Worker como domínio personalizado) ou /d/ no próprio Worker
const dominioDemo = env => String(env.DEMO_DOMINIO || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase() || null;
const linkDemo = (env, origem, slug) => dominioDemo(env) ? `https://${dominioDemo(env)}/${slug}` : `${origem}/d/${slug}`;
