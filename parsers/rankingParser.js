(function () {
  'use strict';

  /**
   * PromosRankingParser — extrai produtos de páginas de ranking.
   *
   * Marketplaces suportados:
   *   Amazon   : /bestsellers/, /gp/bestsellers/, /gp/movers-and-shakers/
   *   ML       : /mais-vendidos/, produtos com selo "MAIS VENDIDO"
   *   Shopee   : /m/shopee-category-list/, /hot-deals/, /ofertas-do-dia/
   *
   * parse() → { marketplace, rankingType, products }
   *   products: [{ name, pricePor, priceDe, discount, category, url, imageUrl,
   *                asin|mlbId|{shopId,itemId}, isRanked:true }]
   *
   * Uso: usuário navega à página de ranking → menu de contexto
   *   "🏆 Capturar ranking" → salva IDs rankeados no store.
   */

  globalThis.PromosRankingParser = {

    /** Detecta se a página atual é uma página de ranking suportada. */
    detect() {
      const url  = location.href;
      const host = location.hostname;
      const path = location.pathname;

      if (host.includes('amazon.com.br')) {
        if (/\/bestsellers|\/gp\/bestsellers|\/gp\/movers-and-shakers/i.test(path))
          return { marketplace: 'amazon', rankingType: 'bestsellers' };
      }
      if (host.includes('mercadolivre.com.br')) {
        if (path.includes('/mais-vendidos'))
          return { marketplace: 'mercadolivre', rankingType: 'mais-vendidos' };
        // Página de busca com filtro de mais vendidos
        if (/ordenar.*relevance|sort=relevance/i.test(url))
          return { marketplace: 'mercadolivre', rankingType: 'busca-relevancia' };
      }
      if (host.includes('shopee.com.br')) {
        if (/\/m\/shopee-category-list|\/hot-deals|\/ofertas|\/mais-vendidos/i.test(path))
          return { marketplace: 'shopee', rankingType: 'hot-deals' };
      }
      return null;
    },

    /** Extrai produtos da página atual. */
    parse() {
      const info = this.detect();
      if (!info) return { marketplace: null, rankingType: null, products: [], erro: 'Página não reconhecida como ranking.' };

      let products = [];
      if (info.marketplace === 'amazon')        products = parseAmazonRanking();
      else if (info.marketplace === 'mercadolivre') products = parseMlRanking();
      else if (info.marketplace === 'shopee')    products = parseShopeeRanking();

      return { ...info, products };
    },
  };

  // ── Amazon Bestsellers ──────────────────────────────────────────────────────

  function parseAmazonRanking() {
    const products = [];

    // Bestsellers: grade de tiles com data-asin
    const tiles = document.querySelectorAll(
      '[data-asin]:not([data-asin=""]), .zg-item-immersion, .p13n-desktop-grid [data-index]'
    );

    for (const tile of tiles) {
      const asin = tile.dataset?.asin ||
        tile.querySelector('[data-asin]')?.dataset?.asin ||
        extractAsinFromUrl(tile.querySelector('a')?.href || '');
      if (!asin) continue;

      const name = (
        tile.querySelector('._cDEzb_p13n-sc-css-line-clamp-1_1Fn1y, ._cDEzb_p13n-sc-css-line-clamp-3_g3dy1') ||
        tile.querySelector('.a-link-normal[title], .a-text-normal') ||
        tile.querySelector('span.a-truncate-cut, .p13n-sc-truncated')
      )?.textContent?.trim() || '';

      const priceEl = tile.querySelector(
        '.p13n-sc-price, ._cDEzb_p13n-sc-price_1RM4f, .a-price .a-offscreen'
      );
      const pricePor = parseBR(priceEl?.textContent || priceEl?.getAttribute('aria-label') || '');

      const imageUrl = tile.querySelector('img')?.src || null;
      const href = tile.querySelector('a[href*="/dp/"]')?.href || '';

      if (!name && !asin) continue;
      products.push({
        name:      cleanName(name),
        pricePor,
        priceDe:   null,
        discount:  null,
        category:  normalizeCategory(name),
        url:       href || `https://www.amazon.com.br/dp/${asin}`,
        imageUrl,
        asin,
        isRanked:  true,
        site:      'amazon',
      });
    }

    return dedupe(products, p => p.asin);
  }

  // ── Mercado Livre Mais Vendidos ─────────────────────────────────────────────

  function parseMlRanking() {
    const products = [];

    // Cobre dois layouts ML:
    //   A) /mais-vendidos (raiz): carrossel com classes dynamic-carousel__*
    //   B) /mais-vendidos/MLB{cat}: grade poly-card com andes-money-amount

    // Layout A: carrossel da raiz — um item por slide
    const carouselItems = document.querySelectorAll('.dynamic-carousel__item-container');
    for (const item of carouselItems) {
      const linkEl = item.querySelector('a[href*="MLB"]');
      if (!linkEl) continue;
      const mlbId = extractMlbId(linkEl.href);
      if (!mlbId) continue;

      const nameEl   = item.querySelector('h3.dynamic-carousel__title, [class*="dynamic-carousel__title"]');
      const imgEl    = item.querySelector('img');
      const name     = (nameEl?.textContent?.trim() || imgEl?.alt?.trim() || '');

      // Preço Por: span folha da classe price (não o bloco container)
      const porEl    = item.querySelector('span.dynamic-carousel__price, .dynamic-carousel__price > span');
      const pricePor = porEl ? sanePrice(parseBR(firstTextOf(porEl))) : null;

      // Preço De: oldprice é sempre um span folha com apenas o valor
      const deEl     = item.querySelector('span.dynamic-carousel__oldprice, [class="dynamic-carousel__oldprice"]');
      let priceDe    = deEl ? sanePrice(parseBR(firstTextOf(deEl))) : null;

      // Valida: priceDe deve ser entre 1x e 8x o pricePor (evita concatenações)
      if (priceDe && pricePor && (priceDe > pricePor * 8 || priceDe <= pricePor)) priceDe = null;

      // Desconto: texto "NN% OFF" dentro do card
      const pctMatch = item.textContent.match(/(\d{1,3})\s*%\s*OFF/i);
      let discount   = pctMatch ? parseInt(pctMatch[1], 10) : calcDiscount(priceDe, pricePor);
      if (discount != null && (discount < 1 || discount > 99)) discount = calcDiscount(priceDe, pricePor);

      products.push({
        name: cleanName(name), pricePor, priceDe, discount,
        category: normalizeCategory(name),
        url: linkEl.href,
        imageUrl: imgEl?.src || null,
        mlbId, isRanked: true, site: 'mercadolivre',
      });
    }

    // Layout B: grade de categoria — poly-card com andes-money-amount
    const polyCards = document.querySelectorAll('.poly-card, .andes-card[data-andes-card="true"]');
    for (const card of polyCards) {
      // Pula se já foi capturado como carrossel (mesmo MLB)
      const linkEl = card.querySelector('a[href*="MLB"]');
      if (!linkEl) continue;
      const mlbId = extractMlbId(linkEl.href);
      if (!mlbId) continue;
      if (products.some(p => p.mlbId === mlbId)) continue;

      const nameEl   = card.querySelector('.poly-component__title, .ui-search-item__title');
      const imgEl    = card.querySelector('img');
      const name     = nameEl?.textContent?.trim() || imgEl?.alt?.trim() || '';

      const porFrac  = card.querySelector('.poly-price__current .andes-money-amount__fraction') ||
                       card.querySelector('.andes-money-amount__fraction');
      const porCents = card.querySelector('.poly-price__current .andes-money-amount__cents') ||
                       card.querySelector('.andes-money-amount__cents');
      const pricePor = sanePrice(moneyFromFrac(porFrac, porCents));

      const deFrac   = card.querySelector('s .andes-money-amount__fraction');
      const deCents  = card.querySelector('s .andes-money-amount__cents');
      const priceDe  = sanePrice(moneyFromFrac(deFrac, deCents));

      const discountEl = card.querySelector('[class*="discount"]');
      const pctMatch   = discountEl && discountEl.textContent.match(/(\d{1,3})\s*%/);
      let discount     = pctMatch ? parseInt(pctMatch[1], 10) : calcDiscount(priceDe, pricePor);
      if (discount != null && (discount < 1 || discount > 99)) discount = calcDiscount(priceDe, pricePor);

      products.push({
        name:      cleanName(name),
        pricePor,
        priceDe,
        discount,
        category:  normalizeCategory(name),
        url:       `https://produto.mercadolivre.com.br/${mlbId}`,
        imageUrl:  imgEl ? imgEl.src : null,
        mlbId,
        isRanked:  true,
        site:      'mercadolivre',
      });
    }

    return dedupe(products, function(p) { return p.mlbId; });
  }

  // ── Shopee Hot Deals / Mais Vendidos ────────────────────────────────────────

  function parseShopeeRanking() {
    const products = [];

    const cards = document.querySelectorAll(
      '[data-sqe="item"], .shopee-search-item-result__item, ' +
      '[class*="item-card"], [class*="product-item"]'
    );

    for (const card of cards) {
      const href = card.querySelector('a[href]')?.href || '';
      const ids  = extractShopeeIds(href);
      if (!ids) continue;

      const name = (
        card.querySelector('[class*="item-name"], [class*="product-name"], .truncate') ||
        card.querySelector('div[class*="name"], span[class*="name"]')
      )?.textContent?.trim() || '';

      // Preço: Shopee mostra como string "R$ XX,XX"
      const priceEls = card.querySelectorAll('[class*="price"]');
      let pricePor = null, priceDe = null;
      for (const el of priceEls) {
        const v = parseBR(el.textContent);
        if (!v) continue;
        if (pricePor === null) pricePor = v;
        else if (v > pricePor) { priceDe = v; }  // preço maior = preço original
      }
      if (priceDe && priceDe < pricePor) { [priceDe, pricePor] = [pricePor, priceDe]; }

      const imageUrl = card.querySelector('img')?.src || null;

      products.push({
        name:      cleanName(name),
        pricePor,
        priceDe,
        discount:  calcDiscount(priceDe, pricePor),
        category:  normalizeCategory(name),
        url:       href,
        imageUrl,
        shopId:    ids.shopId,
        itemId:    ids.itemId,
        isRanked:  true,
        site:      'shopee',
      });
    }

    return dedupe(products, p => `${p.shopId}.${p.itemId}`);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function extractAsinFromUrl(url) {
    const m = String(url).match(/\/dp\/([A-Z0-9]{10})/);
    return m ? m[1] : null;
  }

  function extractMlbId(text) {
    const m = String(text).match(/\b(MLB-?\d{6,})/i);
    if (!m) return null;
    return m[1].toUpperCase().replace('MLB', 'MLB').replace(/-(\d)/, '$1');
    // Normaliza MLB123456 (sem hífen)
  }

  function extractShopeeIds(url) {
    // /NomeProduto-i.SHOPID.ITEMID ou /product/SHOPID/ITEMID
    let m = String(url).match(/[.-]i\.(\d+)\.(\d+)/);
    if (m) return { shopId: m[1], itemId: m[2] };
    m = String(url).match(/\/product\/(\d+)\/(\d+)/);
    if (m) return { shopId: m[1], itemId: m[2] };
    return null;
  }

  /** "R$ 1.234,56" | "1.234,56" → número */
  function parseBR(str) {
    if (!str) return null;
    const s = String(str).replace(/[^\d,.-]/g, '');
    if (!s) return null;
    const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
    const n = lastComma > lastDot
      ? parseFloat(s.replace(/\./g, '').replace(',', '.'))
      : parseFloat(s.replace(/,/g, ''));
    return isNaN(n) ? null : n;
  }

  function calcDiscount(de, por) {
    if (!de || !por || de <= por) return null;
    return Math.round((1 - por / de) * 100);
  }

  /** Monta o preço a partir dos elementos fração + centavos do Andes (ML). */
  function moneyFromFrac(fracEl, centsEl) {
    if (!fracEl) return null;
    const frac  = fracEl.textContent.replace(/\D/g, '');         // "1.599" → "1599"
    const cents = centsEl ? centsEl.textContent.replace(/\D/g, '') : '';
    if (!frac) return null;
    return parseFloat(frac + '.' + (cents ? cents.padStart(2, '0').slice(0, 2) : '00'));
  }

  /** Descarta preços absurdos (lixo de concatenação). Retorna null se inválido. */
  function sanePrice(v) {
    return (typeof v === 'number' && isFinite(v) && v > 0 && v < 1000000) ? v : null;
  }

  /** Retorna o texto do primeiro nó de texto direto do elemento (sem filhos). */
  function firstTextOf(el) {
    if (!el) return '';
    // Tenta nó de texto direto primeiro
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        return node.textContent.trim();
      }
    }
    // Fallback: primeiro filho span/b com texto curto (< 20 chars = provavelmente só o preço)
    const child = el.querySelector('span, b');
    if (child && child.textContent.trim().length < 20) return child.textContent.trim();
    // Último recurso: textContent completo
    return el.textContent.trim();
  }

  function cleanName(name) {
    return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  }

  function dedupe(products, keyFn) {
    const seen = new Set();
    return products.filter(p => {
      const k = keyFn(p);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  const CATEGORY_KEYWORDS = {
    beleza:      /beleza|beauty|maquiagem|cosm[ée]tic|perfum|skin|creme|sérum|shampoo/i,
    cabelo:      /cabelo|hair|condicionador/i,
    cozinha:     /cozinha|kitchen|panela|air.?fryer|frigideira|cafeteira/i,
    casa:        /casa|home|lar |dom[ée]stic|limpeza|vassoura|aspirador/i,
    moda:        /camiseta|camisa|calça|vestido|short|blusa|moletom|roupa/i,
    calcados:    /cal[çc]ado|t[êe]nis|sapato|sandália|bota/i,
    fitness:     /haltere|barra|anilha|colchonete|corda|kettlebell|elástico.*treino/i,
    suplemento:  /whey|creatina|protein|vitamina|c[áa]psula|suplemento|pre[- ]treino/i,
    decoracao:   /quadro|tapete|almofada|cortina|luminária|vaso|decora/i,
    eletronicos: /fone|headphone|speaker|caixa.*som|tv |notebook|celular|carregador|cabo/i,
    infantil:    /infantil|beb[êe]|baby|crian[çc]a|brinquedo|frald/i,
    pet:         /pet|cachorro|gato|ração|coleira|caminha.*pet/i,
  };

  function normalizeCategory(name) {
    for (const [cat, pat] of Object.entries(CATEGORY_KEYWORDS)) {
      if (pat.test(name)) return cat;
    }
    return 'outros';
  }
})();
