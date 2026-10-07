/* BRANCO — contador do painel admin
   Troque o endereço abaixo pelo link do seu Worker na Cloudflare. */
(() => {
  const API = 'https://branco-admin.brancowebs.workers.dev';

  // identifica o visitante (anônimo) para contar pessoas diferentes
  let v; try { v = localStorage.getItem('bv') || (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)); localStorage.setItem('bv', v); } catch (e) { v = null; }

  const q = new URLSearchParams(location.search);
  const ref = document.referrer && !document.referrer.includes(location.host) ? new URL(document.referrer).hostname.replace('www.', '') : null;
  const origem = q.get('utm_source') || ref || null;
  const disp = /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'Celular' : 'Computador';

  const envia = (rota, dados) => {
    try {
      fetch(API + rota, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ v, ...dados }) });
    } catch (e) {}
  };
  const evento = tipo => envia('/t', { tipo, p: location.pathname, o: origem, d: disp });

  // 1) visita (1 por aba aberta)
  try { if (!sessionStorage.getItem('bvis')) { sessionStorage.setItem('bvis', '1'); evento('visita'); } } catch (e) { evento('visita'); }

  document.addEventListener('click', e => {
    // 2) formulário aberto
    if (e.target.closest('[data-open]')) return evento('form_aberto');

    // 3) formulário enviado → salva o cadastro
    if (e.target.closest('#f-wa')) {
      const val = id => (document.getElementById(id) || {}).value || '';
      const tipo = document.querySelector('input[name=t]:checked');
      envia('/lead', { nome: val('f-n'), empresa: val('f-e'), projeto: tipo ? tipo.value : '', mensagem: val('f-m') });
      return evento('form_enviado');
    }

    // 4) cliques no WhatsApp (botões fora do formulário)
    if (e.target.closest('a[href*="wa.me"]')) return evento('whatsapp');
  }, true);
})();
