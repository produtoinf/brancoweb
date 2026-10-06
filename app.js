'use strict';
(() => {
const $ = (s, c = document) => c.querySelector(s), $$ = (s, c = document) => [...c.querySelectorAll(s)];
const root = document.documentElement, body = document.body;
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
$('#year').textContent = new Date().getFullYear();

/* menu */
const menuBtn = $('.top__menu'), menu = $('#menu');
function setMenu(open) {
  menu.hidden = !open; menuBtn.setAttribute('aria-expanded', open); menuBtn.textContent = open ? 'FECHAR' : 'MENU';
  body.classList.toggle('menu-open', open); body.classList.toggle('lock', open);
}
menuBtn.addEventListener('click', () => setMenu(menu.hidden));
menu.addEventListener('click', e => { if (e.target.closest('a')) setMenu(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!menu.hidden) setMenu(false); else if (!modal.hidden) closeForm(); } });

/* aparecer ao rolar */
if ('IntersectionObserver' in window && !still) {
  const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: .15 });
  $$('.rv').forEach(el => io.observe(el));
} else $$('.rv').forEach(el => el.classList.add('in'));

/* faixas do manifesto */
const rows = $$('.mq__row'); rows.forEach(r => r.textContent = (r.dataset.t + ' ').repeat(5));
/* cortina do tubarão */
const curtain = $('#curtain'), sharkOn = root.classList.contains('shark-on');
const L = $('.l', curtain), R = $('.r', curtain);
let open = 1, tick = false;
function measure() { open = Math.max(1, Math.round(innerHeight * .9)); root.style.setProperty('--open', open + 'px'); }
function update() {
  tick = false;
  if (sharkOn) {
    const p = clamp(scrollY / open), e = p * p * (3 - 2 * p);
    L.style.transform = `translate3d(${(-e * 100).toFixed(2)}%,0,0)`; R.style.transform = `translate3d(${(e * 100).toFixed(2)}%,0,0)`;
    curtain.style.setProperty('--hint', String(Math.max(0, 1 - p * 8))); curtain.toggleAttribute('data-open', p >= 1);
  }
  if (!still) rows.forEach((r, i) => {
    const b = r.getBoundingClientRect(), p = clamp((innerHeight - b.top) / (innerHeight + b.height));
    r.style.transform = `translate3d(${((p - .5) * 46 * (i % 2 ? 1 : -1)).toFixed(2)}vw,0,0)`;
  });
}
const req = () => { if (!tick) { tick = true; requestAnimationFrame(update); } };
addEventListener('scroll', req, { passive: true }); addEventListener('resize', () => { measure(); req(); });
measure(); update();

/* projetos: arrastar com o mouse (no toque a rolagem já é nativa) */
const track = $('#track'); let down = false, sx = 0, sl = 0, moved = 0;
track.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') return; down = true; moved = 0; sx = e.clientX; sl = track.scrollLeft; });
addEventListener('pointermove', e => { if (!down) return; const d = e.clientX - sx; moved = Math.max(moved, Math.abs(d)); if (moved > 5) track.classList.add('drag'); track.scrollLeft = sl - d; });
addEventListener('pointerup', () => { down = false; track.classList.remove('drag'); });
track.addEventListener('click', e => { if (moved > 5) { e.preventDefault(); e.stopPropagation(); moved = 0; } }, true);

/* serviços */
const tabs = $$('[role=tab]'), panels = $$('[role=tabpanel]');
function pick(i, focus) {
  tabs.forEach((t, k) => { t.setAttribute('aria-selected', k === i); t.tabIndex = k === i ? 0 : -1; panels[k].hidden = k !== i; });
  if (focus) tabs[i].focus();
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => pick(i));
  t.addEventListener('keydown', e => {
    const k = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (k) { e.preventDefault(); pick((i + k + tabs.length) % tabs.length, true); }
  });
});

/* formulário em etapas → WhatsApp */
const modal = $('#form'), nameEl = $('#f-n'), err = $('.err', modal), back = $('[data-back]'), next = $('[data-next]');
let step = 1, opener = null;
function show(n) {
  step = n; $$('.step', modal).forEach(s => s.hidden = s.dataset.s != n);
  back.hidden = n === 1; next.hidden = n === 3; $('#fp').textContent = `0${n} / 03`;
  if (n === 3) build();
  const f = $('.step:not([hidden]) input[type=text], .step:not([hidden]) #f-wa', modal); if (f) f.focus();
}
function build() {
  const name = nameEl.value.trim(), company = $('#f-e').value.trim(), details = $('#f-m').value.trim();
  const type = ($('input[name=t]:checked') || {}).value || 'Ainda não sei, quero orientação';
  const msg = [`Olá, Branco! Meu nome é ${name}.`, '', 'Quero conversar sobre um projeto para o meu negócio.', `Tipo de projeto: ${type}.`,
    ...(company ? [`Empresa/projeto: ${company}.`] : []), ...(details ? ['', `Minha ideia: ${details}`] : [])].join('\n');
  $('#f-wa').href = 'https://wa.me/5541998999574?text=' + encodeURIComponent(msg);
  $('#resumo').textContent = [`Nome: ${name}`, company && `Empresa: ${company}`, `Projeto: ${type}`].filter(Boolean).join('\n');
}
function openForm(type, from) {
  opener = from || null; if (type) { const r = $$('input[name=t]').find(x => x.value === type); if (r) r.checked = true; }
  setMenu(false); modal.hidden = false; body.classList.add('lock'); err.hidden = true; show(1);
}
function closeForm() { modal.hidden = true; body.classList.remove('lock'); if (opener) opener.focus(); }
document.addEventListener('click', e => {
  const o = e.target.closest('[data-open]'); if (o) { e.preventDefault(); openForm(o.dataset.type, o); return; }
  if (e.target.closest('[data-close]')) closeForm();
});
next.addEventListener('click', () => {
  if (step === 1 && !nameEl.value.trim()) { err.hidden = false; nameEl.focus(); return; }
  show(step + 1);
});
back.addEventListener('click', () => show(step - 1));
nameEl.addEventListener('input', () => err.hidden = true);
nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') next.click(); });

/* cursor: bolinha branca */
if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
  const dot = document.createElement('div'); dot.className = 'dot'; dot.setAttribute('aria-hidden', 'true'); body.appendChild(dot);
  root.classList.add('dot-on');
  let tx = 0, ty = 0, x = 0, y = 0, seen = false;
  addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    tx = e.clientX; ty = e.clientY; if (!seen) { seen = true; x = tx; y = ty; dot.classList.add('on'); }
    dot.classList.toggle('big', !!e.target.closest('a,button,label,[role=tab],.card__fig'));
  }, { passive: true });
  document.addEventListener('mouseleave', () => dot.classList.remove('on'));
  document.addEventListener('mouseenter', () => { if (seen) dot.classList.add('on'); });
  (function loop() { x += (tx - x) * (still ? 1 : .28); y += (ty - y) * (still ? 1 : .28); dot.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`; requestAnimationFrame(loop); })();
}
})();
