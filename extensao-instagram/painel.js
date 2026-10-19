// no painel: avisa que a extensão está instalada e guarda a mensagem que o painel manda antes de abrir o direct
document.documentElement.dataset.brancoIg = '1';
window.addEventListener('message', e => {
  if (e.source !== window || e.data?.tipo !== 'branco-ig' || typeof e.data.txt !== 'string') return;
  chrome.storage.local.set({ brancoIg: { txt: e.data.txt.slice(0, 2000), user: String(e.data.user || '').toLowerCase(), em: Date.now() } });
});
