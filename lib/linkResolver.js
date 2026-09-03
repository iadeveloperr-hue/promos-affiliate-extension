(function () {
  'use strict';

  /**
   * PromosLinkResolver — resolve qualquer link (curto de terceiro ou URL direta)
   * para a URL canônica do produto + IDs.
   *
   * Registrado em globalThis para funcionar tanto no service worker (import
   * side-effect) quanto em content scripts (executeScript).
   *
   * resolve(url) → Promise<{
   *   marketplace: 'amazon'|'mercadolivre'|'shopee'|null,
   *   productUrl:  string|null,   // URL canônica SEM parâmetros de afiliado
   *   asin, mlbId, shopId, itemId,
   *   isValid:     boolean,
   * }>
   *
   * ⚠️ Parâmetros de afiliado de TERCEIROS são sempre descartados — o nosso
   *    link é gerado depois pelo fluxo de cada marketplace.
   * ⚠️ Nunca re-encurtar com ferramentas externas.
   */

  const SHORT_DOMAINS = [
    'amzn.to',          // Amazon
    'meli.la',          // Mercado Livre
    's.shopee.com.br',  // Shopee BR
    'shope.ee',         // Shopee global
  ];

  const INVALID = { marketplace: null, productUrl: null, asin: null, mlbId: null, shopId: null, itemId: null, isValid: false };

  globalThis.PromosLinkResolver = {
    SHORT_DOMAINS,

    /** True se a URL é de um encurtador conhecido de marketplace. */
    isShortLink(url) {
      try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        return SHORT_DOMAINS.includes(host);
      } catch (_) { return false; }
    },

    /**
     * Extrai marketplace + IDs de uma URL DIRETA (sem rede).
     * Retorna objeto INVALID se a URL não é de produto dos 3 marketplaces.
     */
    extract(url) {
      let u;
      try { u = new URL(url); } catch (_) { return { ...INVALID }; }
      const host = u.hostname.replace(/^www\./, '');

      // Amazon: /dp/ASIN ou /gp/product/ASIN
      if (host.endsWith('amazon.com.br')) {
        const m = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
        if (m) {
          return {
            marketplace: 'amazon',
            productUrl: `https://www.amazon.com.br/dp/${m[1]}`,
            asin: m[1], mlbId: null, shopId: null, itemId: null,
            isValid: true,
          };
        }
        return { ...INVALID };
      }

      // Mercado Livre: MLB-123456789 ou /p/MLB123456789
      if (host.endsWith('mercadolivre.com.br') || host.endsWith('mercadolibre.com')) {
        const m = u.href.match(/\bMLB-?(\d{6,})/i);
        if (m) {
          const mlbId = `MLB${m[1]}`;
          // /p/MLBxxx (página de catálogo) usa formato sem hífen; item usa MLB-xxx
          const isCatalog = /\/p\/MLB/i.test(u.pathname);
          const productUrl = isCatalog
            ? `https://www.mercadolivre.com.br/p/${mlbId}`
            : `https://produto.mercadolivre.com.br/MLB-${m[1]}`;
          return {
            marketplace: 'mercadolivre',
            productUrl,
            asin: null, mlbId, shopId: null, itemId: null,
            isValid: true,
          };
        }
        return { ...INVALID };
      }

      // Shopee: ...-i.SHOPID.ITEMID ou /product/SHOPID/ITEMID
      if (host.endsWith('shopee.com.br')) {
        let shopId = null, itemId = null;
        const mDot = u.pathname.match(/[.-]i\.(\d+)\.(\d+)/);
        const mPath = u.pathname.match(/\/product\/(\d+)\/(\d+)/);
        if (mDot)  { shopId = mDot[1];  itemId = mDot[2]; }
        if (mPath) { shopId = mPath[1]; itemId = mPath[2]; }
        if (shopId && itemId) {
          return {
            marketplace: 'shopee',
            productUrl: `https://shopee.com.br/product/${shopId}/${itemId}`,
            asin: null, mlbId: null, shopId, itemId,
            isValid: true,
          };
        }
        return { ...INVALID };
      }

      return { ...INVALID };
    },

    /**
     * Resolve um link qualquer (curto conhecido OU domínio próprio de afiliado).
     * Segue redirects HTTP e também redirects por meta-refresh/JS (encurtadores
     * de terceiro tipo lucreshop), além de extrair o item_id embutido em páginas
     * ML (/social/ de afiliado). Recursão limitada para evitar loops.
     * Requer host_permissions para os domínios envolvidos.
     */
    async resolve(url, _depth = 0) {
      // 1. URL direta? Extrai sem rede.
      const direct = this.extract(url);
      if (direct.isValid) return direct;
      if (_depth > 3) return { ...INVALID };

      try {
        const resp = await fetchFollowing(url);
        if (!resp) return { ...INVALID };

        // 2. URL final (após redirects HTTP 3xx) já é página de produto?
        const byUrl = this.extract(resp.url);
        if (byUrl.isValid) return byUrl;

        const finalHost = safeHost(resp.url);
        let html = '';
        try { html = await resp.text(); } catch (_) {}

        // 3. Página ML (ex.: /social/ de afiliado): item real embutido no
        //    melidata do HTML como "item_id":"MLB...".
        if (/mercadoli[bv]re/.test(finalHost)) {
          const m = html.match(/"item_id"\s*:\s*"(MLB\d{6,})"/);
          if (m) return mlbResult(m[1]);
        }

        // 4. Interstitial / redirect por meta-refresh ou JS (encurtadores de
        //    terceiro): acha o próximo salto no HTML e segue recursivamente.
        const next = findNextHop(html);
        if (next) {
          const abs = toAbsolute(next, resp.url);
          if (abs && abs !== url) return this.resolve(abs, _depth + 1);
        }
      } catch (err) {
        console.warn('[Promos] linkResolver: falha ao seguir', url, err);
      }

      // 5. Não resolveu → inválido
      return { ...INVALID };
    },
  };

  /**
   * Extrai o preço original ("De"/"Antes") do HTML server-rendered do ML.
   * Roda sem DOM (service worker) — regex sobre o aria-label "Antes: X reais
   * con Y centavos" que o ML usa no bloco de preço, com fallback para chaves
   * JSON de preço de lista. Retorna número (ex.: 299.80) ou null.
   *
   * Por que o filtro por pricePor: a âncora real fica logo ACIMA do preço final.
   * Valores muito altos numa página de perfume são "preço por litro" ou totais
   * de parcelamento — descartados ao exigir De > Por e pegar o MENOR candidato
   * válido (o "Antes" verdadeiro, não um número inflado de outro elemento).
   */
  globalThis.PromosLinkResolver.extractMlDeFromHtml = function (html, pricePor = null) {
    if (!html) return null;
    const pick = (arr) => {
      const v = arr.filter((x) => x > 0 && (!pricePor || x > pricePor)).sort((a, b) => a - b);
      return v.length ? v[0] : null;
    };

    // 1. aria-label "Antes: 299 reais con 80 centavos" (fonte mais confiável)
    const aria = [];
    const reAria = /Antes:\s*(\d[\d.]*)\s*reais(?:\s*con\s*(\d{1,2})\s*centavos)?/gi;
    let m;
    while ((m = reAria.exec(html))) {
      const reais = parseFloat(m[1].replace(/\./g, ''));
      const cents = m[2] ? parseInt(m[2], 10) / 100 : 0;
      if (reais > 0) aria.push(reais + cents);
    }
    const fromAria = pick(aria);
    if (fromAria) return fromAria;

    // 2. Fallback: chaves JSON de preço de lista embutidas no estado da página
    const json = [];
    for (const re of [/"original_price"\s*:\s*"?([\d.]+)"?/i,
                      /"original_value"\s*:\s*"?([\d.]+)"?/i,
                      /"list_price"\s*:\s*"?([\d.]+)"?/i]) {
      const j = html.match(re);
      if (j) { const v = parseFloat(j[1]); if (v > 0) json.push(v); }
    }
    return pick(json);
  };

  /** Monta o resultado de um produto ML a partir do ID "MLB123...". */
  function mlbResult(mlbId) {
    return {
      marketplace: 'mercadolivre',
      productUrl: `https://produto.mercadolivre.com.br/MLB-${mlbId.slice(3)}`,
      asin: null, mlbId, shopId: null, itemId: null,
      isValid: true,
    };
  }

  function safeHost(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
  }

  /** Resolve uma URL possivelmente relativa contra a base. */
  function toAbsolute(href, base) {
    try { return new URL(href, base).href; } catch (_) { return null; }
  }

  /**
   * Acha o próximo salto de redirect numa página interstitial (encurtador de
   * terceiro): meta-refresh, atribuição a window.location, ou um link/URL para
   * um domínio de marketplace conhecido embutido no HTML.
   */
  function findNextHop(html) {
    if (!html) return null;
    const KNOWN = /meli\.la|mercadoli[bv]re|amzn\.to|amazon\.com\.br|shope\.ee|shopee\.com\.br/i;

    // 1. <meta http-equiv="refresh" content="0;url=...">
    let m = html.match(/http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"'>\s]+)/i);
    if (m) return decodeEntities(m[1]);

    // 2. window.location = '...' / location.href = '...' / location.replace('...')
    m = html.match(/location(?:\.href)?\s*=\s*["']([^"']+)["']/i) ||
        html.match(/location\.(?:replace|assign)\(\s*["']([^"']+)["']/i);
    if (m && KNOWN.test(m[1])) return decodeEntities(m[1]);

    // 3. <a href="...domínio conhecido...">
    m = html.match(/<a[^>]+href=["']([^"']*(?:meli\.la|mercadoli[bv]re|amzn\.to|amazon\.com\.br|shope\.ee|shopee\.com\.br)[^"']*)["']/i);
    if (m) return decodeEntities(m[1]);

    // 4. URL "nua" para domínio conhecido em qualquer lugar do HTML
    m = html.match(/https?:\/\/[^"'\s<>]*(?:meli\.la|mercadoli[bv]re|amzn\.to|amazon\.com\.br|shope\.ee|shopee\.com\.br)[^"'\s<>]*/i);
    if (m) return decodeEntities(m[0]);

    return null;
  }

  /** Decodifica entidades HTML básicas que aparecem em URLs (&amp; etc.). */
  function decodeEntities(s) {
    return String(s)
      .replace(/&amp;/gi, '&')
      .replace(/&#x2f;/gi, '/')
      .replace(/&#47;/g, '/')
      .replace(/&#x3a;/gi, ':');
  }

  /**
   * Faz GET seguindo redirects e retorna o Response (resp.url = URL final).
   * User-Agent de browser: necessário fora do Chrome (Node/testes) — o meli.la
   * responde 403 para clientes sem UA. No Chrome o header é controlado pelo browser.
   */
  async function fetchFollowing(url) {
    return fetch(url, {
      redirect: 'follow',
      credentials: 'omit',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      },
    });
  }
})();
