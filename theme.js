/* BRANCO — tema claro / escuro
   Fica no <head> (sem "defer") para o site já abrir na cor certa, sem piscar. */
(function () {
  var KEY = 'brancoTema', root = document.documentElement, tema = 'escuro';
  try { tema = localStorage.getItem(KEY) || 'escuro'; } catch (e) {}
  if (tema === 'claro') root.setAttribute('data-theme', 'light');

  /* cores do tema claro (o escuro é o original do site) */
  var L = 'html[data-theme=light]';
  var css = [
    L + '{--bg:#f4f4f1;--fg:#0e0e10;--mute:#6c6c74;--line:#dddde0;--card:#fff;color-scheme:light}',
    L + ' .hero{background:radial-gradient(90% 60% at 82% 105%,#e2e2e4 0,transparent 70%),var(--bg)}',
    L + '.dim-on .hero{background:radial-gradient(90% 60% at 82% 105%,rgba(214,214,218,.85) 0,transparent 70%)}',
    L + ' .mq__row{color:#e4e4e6}' + L + ' .mq__row--hot{color:var(--fg)}' + L + ' .mq__row--out{-webkit-text-stroke-color:#c4c4ca}',
    L + ' .sv__list button{color:#b9b9c0}' + L + ' .sv__list button:hover{color:var(--mute)}' + L + ' .sv__list button[aria-selected=true]{color:var(--fg)}',
    L + ' .card--cta{border-color:#c9c9cf}',
    L + ' .card__fig--soon{background:radial-gradient(80% 70% at 50% 100%,#ececee 0,transparent 75%),var(--card)}' + L + ' .card__fig--soon span{-webkit-text-stroke-color:#c4c4ca}',
    L + ' .step input[type=text],' + L + ' .step textarea{border-bottom-color:#c9c9cf}' + L + ' .chip span{border-color:#c9c9cf}',
    L + ' .err{color:#c62828}',
    L + ' .nm,' + L + ' .nm__i+.nm__i,' + L + ' .ct,' + L + ' .ct__item{border-color:var(--line)!important}',
    L + ' .nm__i:nth-child(n+3){border-top-color:var(--line)}',
    L + ' #warp{filter:invert(1)}',                     /* estrelas do fundo ficam escuras */
    L + ' .grain{opacity:.035}',
    /* a galáxia continua escura: vira uma "janela para o espaço" */
    L + ' .gx{--bg:#0a0a0b;--fg:#ececee;--mute:#8e8e96;--line:#242427;--card:#111113;background:#0a0a0b;color:var(--fg);overflow:hidden;border-radius:clamp(18px,3vw,36px);margin:0 clamp(8px,1.5vw,20px)}',
    /* botão do tema */
    '.tema{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:50%;border:1px solid currentColor;color:inherit;transition:transform .5s cubic-bezier(.2,.7,.2,1)}',
    '.tema:hover{transform:rotate(180deg)}.tema svg{width:16px;height:16px;display:block}',
    L + ' .tema svg{transform:rotate(180deg)}',
    '.top__act{display:flex;align-items:center;gap:18px}'
  ].join('\n');
  var st = document.createElement('style'); st.id = 'tema-css'; st.textContent = css;
  document.head.appendChild(st);

  /* botão no topo, ao lado do MENU */
  function botao() {
    var menu = document.querySelector('.top__menu'); if (!menu || document.querySelector('.tema')) return;
    var wrap = document.createElement('div'); wrap.className = 'top__act';
    var b = document.createElement('button'); b.type = 'button'; b.className = 'tema';
    b.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 1.5a6.5 6.5 0 0 1 0 13z" fill="currentColor"/></svg>';
    function rotulo() {
      var claro = root.getAttribute('data-theme') === 'light';
      b.setAttribute('aria-label', claro ? 'Mudar para tema escuro' : 'Mudar para tema claro');
      b.title = claro ? 'Tema escuro' : 'Tema claro';
      var m = document.querySelector('meta[name=theme-color]'); if (m) m.content = claro ? '#f4f4f1' : '#0a0a0b';
    }
    b.addEventListener('click', function () {
      var claro = root.getAttribute('data-theme') !== 'light';
      if (claro) root.setAttribute('data-theme', 'light'); else root.removeAttribute('data-theme');
      try { localStorage.setItem(KEY, claro ? 'claro' : 'escuro'); } catch (e) {}
      rotulo();
    });
    menu.parentNode.insertBefore(wrap, menu); wrap.appendChild(b); wrap.appendChild(menu); rotulo();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', botao); else botao();
})();
