/* BRANCO — contador do painel + campo de WhatsApp no formulário
   Envia visitas e cadastros pro painel. */
(() => {
  const API = 'https://branco-admin.brancowebs.workers.dev';

  // identifica o visitante (anônimo) para contar pessoas diferentes
  let v; try { v = localStorage.getItem('bv') || (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)); localStorage.setItem('bv', v); } catch (e) { v = null; }

  const q = new URLSearchParams(location.search);
  const ref = document.referrer && !document.referrer.includes(location.host) ? new URL(document.referrer).hostname.replace('www.', '') : null;
  const curtos = { ig: 'instagram', fb: 'facebook', gg: 'google', wa: 'whatsapp', tt: 'tiktok', yt: 'youtube' };
  const curto = Object.keys(curtos).find(k => q.has(k));
  const origem = q.get('utm_source') || (curto && curtos[curto]) || ref || null;
  const disp = /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'Celular' : 'Computador';

  const envia = (rota, dados) => {
    try {
      fetch(API + rota, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ v, ...dados }) }).catch(() => {});
    } catch (e) {}
  };
  const evento = tipo => envia('/t', { tipo, p: location.pathname, o: origem, d: disp });

  // 1) visita (1 por aba aberta)
  try { if (!sessionStorage.getItem('bvis')) { sessionStorage.setItem('bvis', '1'); evento('visita'); } } catch (e) { evento('visita'); }

  /* ---------- campo "Seu WhatsApp" na 1ª etapa do formulário ---------- */
  const $ = id => document.getElementById(id);
  const digitos = s => (s || '').replace(/\D/g, '');
  const mascara = s => {
    const d = digitos(s).slice(0, 11);
    if (d.length <= 2) return d.length ? '(' + d : '';
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  };
  let lid = null; // identifica este preenchimento, para atualizar em vez de duplicar
  const novoLid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).slice(0, 36);

  function campo() {
    const nome = $('f-n'); if (!nome || $('f-w')) return;
    const err = nome.parentNode.querySelector('.err'), depois = err || nome;
    const lab = document.createElement('label'); lab.htmlFor = 'f-w'; lab.textContent = 'Seu WhatsApp';
    const inp = document.createElement('input');
    Object.assign(inp, { type: 'text', id: 'f-w', inputMode: 'tel', autocomplete: 'tel', maxLength: 15, placeholder: '(41) 99999-9999' });
    const e2 = document.createElement('p'); e2.className = 'err'; e2.id = 'f-w-err'; e2.hidden = true; e2.textContent = 'Coloque seu WhatsApp com DDD.';
    depois.after(lab, inp, e2);
    inp.addEventListener('input', () => { inp.value = mascara(inp.value); e2.hidden = true; });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const n = document.querySelector('[data-next]'); if (n) n.click(); } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', campo); else campo();

  const dados = () => {
    const val = id => ($(id) || {}).value || '';
    const tipo = document.querySelector('input[name=t]:checked');
    return { lid, nome: val('f-n'), telefone: digitos(val('f-w')), empresa: val('f-e'), projeto: tipo ? tipo.value : '', mensagem: val('f-m') };
  };
  const naEtapa1 = () => { const s = document.querySelector('.step[data-s="1"]'); return s && !s.hidden; };

  document.addEventListener('click', e => {
    // 2) formulário aberto
    if (e.target.closest('[data-open]')) { lid = novoLid(); return evento('form_aberto'); }

    // "Avançar" na 1ª etapa: confere o WhatsApp e já salva o contato
    if (e.target.closest('[data-next]') && naEtapa1()) {
      const w = $('f-w'); if (!w) return;
      if (!($('f-n').value || '').trim()) return; // o próprio site avisa do nome
      const d = digitos(w.value);
      if (d.length < 10 || d.length > 11) { e.preventDefault(); e.stopImmediatePropagation(); $('f-w-err').hidden = false; w.focus(); return; }
      if (!lid) lid = novoLid();
      envia('/lead', { ...dados(), status: 'parcial' });
      return;
    }

    // 3) formulário enviado → completa o cadastro
    if (e.target.closest('#f-wa')) {
      if (!lid) lid = novoLid();
      envia('/lead', { ...dados(), status: 'enviado' });
      return evento('form_enviado');
    }

    // 4) cliques no WhatsApp (botões fora do formulário)
    if (e.target.closest('a[href*="wa.me"]')) return evento('whatsapp');
  }, true);
})();
