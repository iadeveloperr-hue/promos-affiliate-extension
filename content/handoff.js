// Handoff entre perfis: quando a página é aberta por OUTRO perfil (via native
// host), o candidato vem codificado no ?promosApprove=... da URL (query param,
// que sobrevive ao redirect da Amazon; a Amazon descarta o #fragment).
//
// À prova de redirect e de formato de URL do ML:
//  - O ML pode cair numa tela intermediária /social/ (auto-clica "Ir para produto").
//  - O ML tem 2 formatos de URL (catálogo /p/MLB<id> vs anúncio produto.../MLB-<id>);
//    se a página vier 404, tenta automaticamente o outro formato.
//  - O produto real tem #fragment próprio que sobrescreve o nosso, então o
//    candidato é guardado em chrome.storage.local (pendingHandoff) assim que chega
//    e consumido na página final.
(function () {
  const isML     = /mercadolivre\.com\.br/i.test(location.href);
  const isSocial = /mercadolivre\.com\.br\/social\//i.test(location.href);

  // Lê o candidato do QUERY PARAM ?promosApprove (sobrevive ao redirect da Amazon)
  // ou, por compatibilidade, do #fragment antigo. Codificação base64URL.
  function decodeCandidate() {
    let raw = null;
    try { raw = new URLSearchParams(location.search).get('promosApprove'); } catch (_) {}
    if (!raw) {
      const m = location.hash.match(/promosApprove=([^&]+)/);
      if (m) raw = decodeURIComponent(m[1]);
    }
    if (!raw) return null;
    try {
      let b = raw.replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      return JSON.parse(decodeURIComponent(escape(atob(b))));
    } catch (_) { return null; }
  }

  // Remove o marcador da URL (query + hash), preservando os demais parâmetros.
  function clearMarker() {
    try {
      const u = new URL(location.href);
      u.searchParams.delete('promosApprove');
      u.hash = '';
      history.replaceState(null, '', u.pathname + u.search);
    } catch (_) {}
  }

  function trigger(candidate, grupo) {
    chrome.runtime.sendMessage({ action: 'handoffApprove', candidate, grupo });
  }

  function is404() {
    return /não existe|nao existe|página não encontrada/i.test(
      (document.body && document.body.innerText || '').slice(0, 4000)
    );
  }

  // Formato alternativo de URL do ML (catálogo ↔ anúncio).
  function mlAltUrl() {
    const u = location.href.split('#')[0].split('?')[0];
    let m;
    if ((m = u.match(/\/p\/MLB(\d+)/)))  return `https://produto.mercadolivre.com.br/MLB-${m[1]}`;
    if ((m = u.match(/\/MLB-?(\d+)/)))   return `https://www.mercadolivre.com.br/p/MLB${m[1]}`;
    return null;
  }

  // Botão "Ir para produto" na tela /social/ — SPA, pode demorar a renderizar.
  function clickGoToProduct() {
    const TEXT_RE = /ir\s+(para|ao)\s+o?\s*produto|ver\s+produto|acessar\s+produto/i;
    const PROD_HREF_RE = /\/p\/MLB\d|\/MLB-?\d|produto\.mercadolivre\.com\.br\/MLB/i;
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      const el = [...document.querySelectorAll('a, button, [role="button"]')]
        .find(e => TEXT_RE.test((e.textContent || '').replace(/\s+/g, ' ').trim()));
      if (el) { clearInterval(iv); el.click(); return; }
      const a = [...document.querySelectorAll('a[href]')].find(x => PROD_HREF_RE.test(x.href));
      if (a) { clearInterval(iv); location.href = a.href; return; }
      if (tries >= 60) clearInterval(iv); // ~15s
    }, 250);
  }

  (async () => {
    // 1. Obtém o candidato: da URL (recém-chegado) ou do que foi guardado.
    let payload = decodeCandidate();
    if (payload) clearMarker();
    if (!payload) {
      const { pendingHandoff } = await chrome.storage.local.get('pendingHandoff');
      if (pendingHandoff && Date.now() - pendingHandoff.ts < 90000) payload = pendingHandoff;
    }
    if (!payload || !payload.candidate || !payload.grupo) return;

    // 2. Tela /social/ do ML → guarda e clica "Ir para produto".
    if (isSocial) {
      await chrome.storage.local.set({ pendingHandoff: { ...payload, ts: Date.now() } });
      clickGoToProduct();
      return;
    }

    // 3. Página 404 do ML → tenta o formato alternativo de URL (uma única vez).
    if (isML && !payload.triedAlt && mlAltUrl() && is404()) {
      await chrome.storage.local.set({ pendingHandoff: { ...payload, triedAlt: true, ts: Date.now() } });
      location.href = mlAltUrl();
      return;
    }

    // 4. Página do produto OK → gera o post e limpa o pendente.
    await chrome.storage.local.remove('pendingHandoff');
    trigger(payload.candidate, payload.grupo);
  })();
})();
