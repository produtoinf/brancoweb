// no Instagram: quando o direct abre, cola a mensagem guardada (vale por 2 minutos e só uma vez). Não envia: você confere e aperta Enviar.
(async () => {
  const { brancoIg: m } = await chrome.storage.local.get('brancoIg');
  if (!m || Date.now() - m.em > 120000) return;
  const caixa = () => [...document.querySelectorAll('div[contenteditable="true"][role="textbox"], textarea')].find(el => el.offsetParent);
  let el = null;
  for (let i = 0; i < 60 && !(el = caixa()); i++) await new Promise(r => setTimeout(r, 500)); // espera o direct carregar (até 30 s)
  if (!el) return;
  await chrome.storage.local.remove('brancoIg'); // usa uma vez só
  el.focus();
  if (el.tagName === 'TEXTAREA') {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(el, m.txt); el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    // colar (mantém as quebras de linha sem disparar o Enter, que enviaria a mensagem)
    const dt = new DataTransfer(); dt.setData('text/plain', m.txt);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 150));
    if (!el.textContent.trim()) document.execCommand('insertText', false, m.txt.replace(/\s*\n\s*/g, ' '));
  }
  const aviso = document.createElement('div');
  aviso.textContent = el.textContent.trim() || el.value ? '✓ Mensagem colada pela Branco. Confira e aperte Enviar.' : 'A Branco não conseguiu colar. Use Ctrl+V (a mensagem está copiada).';
  aviso.style.cssText = 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:99999;background:#111;color:#fff;padding:10px 16px;border-radius:10px;font:500 14px system-ui;box-shadow:0 6px 24px rgba(0,0,0,.35)';
  document.body.appendChild(aviso); setTimeout(() => aviso.remove(), 5000);
})();
