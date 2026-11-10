(function () {
  'use strict';
  window.PromosAffiliate = {};

  // ── Amazon ────────────────────────────────────────────────────────────────

  /**
   * Gera link Amazon via SiteStripe (amzn.to).
   * Fallback: link longo com ?tag=trackingId.
   */
  window.PromosAffiliate.amazon = async function getAmazonLink(asin, group) {
    const trackingId = window.PromosConfig.GROUPS[group].amazonTrackingId;

    // Tracking ID ainda não configurado (placeholder)
    const isPlaceholder = !trackingId || trackingId.startsWith('<');
    const fallback = {
      url: isPlaceholder
        ? `https://www.amazon.com.br/dp/${asin}`    // sem ?tag= para não vazar placeholder
        : `https://www.amazon.com.br/dp/${asin}?tag=${trackingId}`,
      isFallback: true,
      missingTrackingId: isPlaceholder,
    };

    if (!asin || isPlaceholder) return fallback;

    try {
      const longUrl = `https://www.amazon.com.br/dp/${asin}?tag=${trackingId}`;
      const apiUrl  = `https://www.amazon.com.br/associates/sitestripe/getShortUrl` +
                      `?longUrl=${encodeURIComponent(longUrl)}`;

      const resp = await fetch(apiUrl, { credentials: 'include' });
      if (!resp.ok) return fallback;

      const data = await resp.json();
      if (data && !data.isError && data.shortUrl) {
        return { url: data.shortUrl, isFallback: false };
      }
    } catch (err) {
      console.warn('[Promos] SiteStripe erro:', err);
    }

    return fallback;
  };

  // ── Mercado Livre ─────────────────────────────────────────────────────────

  /**
   * Obtém link meli.la clicando no botão "Compartilhar" da barra de afiliado ML.
   * Usa MutationObserver + polling + timeout de 8s.
   * ⚠️ NÃO re-encurta o meli.la — já é o link de afiliado correto.
   *
   * Retorna:
   *   { url: 'https://meli.la/...', isFallback: false }           — sucesso
   *   { url: null, isFallback: true, error: '...' }               — falhou
   */
  window.PromosAffiliate.mercadolivre = function getMeliLink() {
    return new Promise((resolve) => {
      const TIMEOUT_MS = 15000;

      // ── 1. Verifica barra de afiliado ─────────────────────────────────
      if (!hasMeliAffiliateBar()) {
        return resolve({ url: null, isFallback: true, error: motivoSemBarra() });
      }

      const shareBtn = findMeliShareButton();
      if (!shareBtn) {
        return resolve({
          url: null,
          isFallback: true,
          error: 'Botão "Compartilhar" não encontrado na barra de afiliado ML',
        });
      }

      // ── 2. Verifica se link já está no DOM (clique anterior) ──────────
      const existing = extractMeliUrl();
      if (existing) return resolve({ url: existing, isFallback: false });

      let settled = false;
      let pollId;

      function done(result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(pollId);
        observer.disconnect();
        // Tenta fechar o popup ML para não deixar lixo na tela
        closeMeliSharePopup();
        resolve(result);
      }

      // ── 3. Timeout ────────────────────────────────────────────────────
      const timer = setTimeout(() => {
        done({
          url: null,
          isFallback: true,
          error: 'Tempo esgotado aguardando link meli.la (8s) — tente novamente',
        });
      }, TIMEOUT_MS);

      // ── 4. MutationObserver ───────────────────────────────────────────
      const observer = new MutationObserver(() => {
        const url = extractMeliUrl();
        if (url) done({ url, isFallback: false });
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['value', 'href'] });

      // ── 5. Polling como reforço ───────────────────────────────────────
      pollId = setInterval(() => {
        const url = extractMeliUrl();
        if (url) done({ url, isFallback: false });
      }, 150);

      // ── 6. Clica no botão ─────────────────────────────────────────────
      shareBtn.click();
    });
  };

  // ── Helpers ML ────────────────────────────────────────────────────────────

  /** Há um "Compartilhar" dentro deste container? */
  function hasShareInside(el) {
    if (!el) return false;
    if (el.querySelector('.generate_link_button')) return true;
    for (const b of el.querySelectorAll('button, a[role="button"], a')) {
      if (b.closest('.ui-pdp-share')) continue; // ignora share nativo do produto
      if (/^compartilhar/i.test((b.textContent || '').trim())) return true;
    }
    return false;
  }

  /**
   * Localiza o CONTAINER da barra de afiliado do ML.
   * A barra real é a `NAV.stripe` (toolbar fixa) cujo botão de gerar link tem a
   * classe `generate_link_button` — bem diferente do "Compartilhar" nativo do
   * produto (`.ui-pdp-share__link__label`). Mirar nessa classe é o caminho mais
   * confiável; só caímos no marcador genérico se ela não existir.
   */
  function findMeliAffiliateBar() {
    const genBtn = document.querySelector('.generate_link_button');
    if (genBtn) return genBtn.closest('nav.stripe, [class*="toolbar"]') || genBtn.parentElement;

    const marker =
      document.querySelector('nav.stripe, [class*="affiliate"], [class*="afiliado"], [data-testid*="affiliate"], [id*="affiliate"], [id*="afiliado"]') ||
      findElementByText('a, span, div, nav', /programa\s+de\s+afiliado|afiliad/i);
    if (!marker) return null;

    let el = marker;
    for (let i = 0; i < 8 && el; i++) {
      if (hasShareInside(el)) return el;
      el = el.parentElement;
    }
    // Marcador existe mas o botão ainda não renderizou → ainda não está pronto.
    return null;
  }

  /** A barra de afiliado já está pronta (com o Compartilhar) na página? */
  /**
   * Por que não há barra de afiliado nesta página? Verificado ao vivo em
   * 05/11: a página de CATÁLOGO (/up/MLBU...) não mostra a barra, mesmo com
   * o afiliado logado — e produto.mercadolivre.com.br/MLB-... redireciona de
   * volta para ela. Culpar o login nesses casos manda o usuário para o lugar
   * errado; o menu de afiliado no topo diz se ele está logado ou não.
   */
  function motivoSemBarra() {
    const logado = !!document.querySelector(
      'a[href*="afiliados#menu-user"], a[href*="/afiliados/hub"], a[href*="/afiliados/dashboard"]');
    if (!logado) {
      return 'Você não está logado como afiliado no Mercado Livre — entre na conta para gerar o meli.la.';
    }
    if (/\/up\/MLBU/i.test(location.href)) {
      return 'Página de catálogo do ML (/up/): o Mercado Livre não mostra a barra de afiliado aqui. '
           + 'Abra o anúncio de um vendedor específico e gere o link por lá.';
    }
    return 'Este anúncio não tem barra de afiliado (provavelmente fora do programa). '
         + 'Escolha outro anúncio do mesmo produto.';
  }
  function hasMeliAffiliateBar() {
    return !!findMeliAffiliateBar();
  }

  /** Botão "Compartilhar" da barra de afiliado (NUNCA o share nativo do produto). */
  function findMeliShareButton() {
    // 1. Caminho direto e confiável: o botão de gerar link do afiliado.
    const direct = document.querySelector('.generate_link_button');
    if (direct) return direct;

    // 2. Fallback: dentro da barra de afiliado, um "Compartilhar" — mas nunca o
    //    do produto (.ui-pdp-share).
    const bar = findMeliAffiliateBar();
    if (!bar) return null;
    for (const el of bar.querySelectorAll('button, a[role="button"], a, [aria-label]')) {
      if (el.closest('.ui-pdp-share')) continue; // share nativo do produto → ignora
      const text = (el.textContent || '').trim();
      const aria = el.getAttribute('aria-label') || '';
      if (/^compartilhar/i.test(text) || /^compartilhar/i.test(aria)) return el;
    }
    return null;
  }

  /** Extrai a primeira URL meli.la encontrada no DOM */
  // Elementos DA EXTENSÃO (overlay, painéis): nunca podem ser fonte do link —
  // a textarea do overlay contém o post anterior, que costuma ter um meli.la.
  const SELETOR_NOSSO = '#promos-overlay, #promos-card, #promos-coupons-panel, #promos-restore-chip, .promos-queue-panel';
  function ehNosso(el) {
    try { return !!(el && el.closest && el.closest(SELETOR_NOSSO)); } catch (_) { return false; }
  }

  /** Extrai SÓ a URL meli.la de um texto qualquer (null se não houver). */
  function soMeliUrl(txt) {
    const m = String(txt || '').match(/https?:\/\/meli\.la\/[^\s"'<>]+/);
    return m ? cleanUrl(m[0]) : null;
  }
  function extractMeliUrl() {
    // 1. Textarea/input acessível diretamente (light DOM)
    for (const el of document.querySelectorAll('input, textarea')) {
      if (ehNosso(el)) continue;
      const url = soMeliUrl(el.value);
      if (url) return url;
    }

    // 2. Anchor com href meli.la
    for (const el of document.querySelectorAll('a[href*="meli.la/"]')) {
      if (ehNosso(el)) continue;
      return cleanUrl(el.href);
    }

    // 3. Container do campo "Link do produto" do ML
    //    A textarea fica num shadow-root (closed), mas o innerText / textContent
    //    do host expõe o texto renderizado.
    const linkContainerSelectors = [
      '[data-testid="text-field_label_link"]',   // o próprio textarea (se acessível)
      '[class*="textfield-link"]',                // div container do campo
      '[class*="link-generator"]',                // container do modal de link
      '[class*="card__content"]',                 // card interno do modal ML
    ];
    for (const sel of linkContainerSelectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (ehNosso(el)) continue;
        // innerText inclui texto renderizado mesmo de shadow DOM slotado
        const text = el.innerText || el.textContent || '';
        const m = text.match(/https?:\/\/meli\.la\/\S+/);
        if (m) return cleanUrl(m[0]);
      }
    }

    // 4. Data-attributes (data-url, data-clipboard-text, etc.)
    for (const el of document.querySelectorAll('[data-url],[data-clipboard-text],[data-link],[data-href],[data-share-url]')) {
      for (const attr of ['data-url','data-clipboard-text','data-link','data-href','data-share-url']) {
        if (ehNosso(el)) continue;
        const url = soMeliUrl(el.getAttribute(attr));
        if (url) return url;
      }
    }

    // 5. Qualquer nó de texto no documento
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (ehNosso(node.parentElement)) continue;
      const m = node.textContent.match(/https?:\/\/meli\.la\/\S+/);
      if (m) return cleanUrl(m[0]);
    }

    // 6. Varredura total de atributos (cobertura máxima)
    for (const el of document.querySelectorAll('*')) {
      if (ehNosso(el)) continue;
      for (const attr of el.attributes) {
        if (attr.value.includes('meli.la/')) {
          const m = attr.value.match(/https?:\/\/meli\.la\/\S+/);
          if (m) return cleanUrl(m[0]);
        }
      }
    }

    return null;
  }

  // ── Shopee ────────────────────────────────────────────────────────────────

  /**
   * Gera link de afiliado Shopee.
   *
   * A Shopee BR não expõe uma API pública de link curto sem credenciais OAuth.
   * Estratégia:
   *   1. Tenta ler link de afiliado já presente na página (painel/app injetado)
   *   2. Constrói link longo com sub_id como fallback editável
   *
   * O campo de link NO OVERLAY fica sempre editável — o usuário pode colar
   * o link curto gerado no painel Shopee Afiliados manualmente.
   */
  window.PromosAffiliate.shopee = function getShopeeLink(parsed, group) {
    const subId    = window.PromosConfig.GROUPS[group].shopeeSubId;
    const { shopId, itemId } = parsed;

    // 1. Procura link de afiliado já injetado na página (alguns painéis injetam)
    // Usa startsWith para evitar falso positivo em "careers.shopee.com.br" etc.
    for (const el of document.querySelectorAll('a[href]')) {
      const href = el.href || '';
      if (href.startsWith('https://shope.ee/') ||
          href.startsWith('https://s.shopee.com.br/') ||
          href.startsWith('http://s.shopee.com.br/')) {
        return { url: href, isFallback: false };
      }
    }

    // 2. Link fallback: URL canônica da página com sub_id
    //    Tenta ler a URL canônica do JSON-LD (mais limpa que location.href)
    let canonicalUrl = null;
    try {
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        const obj = JSON.parse(s.textContent);
        const nodes = [obj, ...(obj['@graph'] || [])];
        const product = nodes.find(n => n && n['@type'] === 'Product');
        if (product?.url) { canonicalUrl = product.url; break; }
      }
    } catch (_) {}

    const baseUrl = canonicalUrl || location.href.split('?')[0];
    const linkObj = new URL(baseUrl);
    linkObj.searchParams.set('sub_id', subId);
    const url = linkObj.toString();

    return { url, isFallback: true };
  };

  function cleanUrl(url) {
    return String(url).trim().replace(/[.,;)>"'\s]+$/, '');
  }

  /** Tenta fechar o popup de compartilhamento do ML */
  function closeMeliSharePopup() {
    try {
      const closeBtn = document.querySelector(
        '[class*="modal"] [aria-label*="fechar" i], ' +
        '[class*="modal"] button[class*="close"], ' +
        '[class*="dialog"] button[class*="close"]'
      );
      if (closeBtn) closeBtn.click();
    } catch (_) {}
  }

  /** Procura elemento pelo texto usando regex */
  function findElementByText(selector, regex) {
    for (const el of document.querySelectorAll(selector)) {
      if (regex.test(el.textContent)) return el;
    }
    return null;
  }
})();
