(function () {
  'use strict';
  window.PromosParser = window.PromosParser || {};

  window.PromosParser.shopee = function parseShopee() {
    let name = null, pricePor = null, priceDe = null, discount = null;
    let coupon = null, imageUrl = null, shopId = null, itemId = null, category = null;
    const missing = [];

    // ── 1. IDs da URL ─────────────────────────────────────────────────────
    // Formatos: /Product-Name-i.SHOPID.ITEMID  ou  ?shopid=X&itemid=Y
    const pathMatch = location.pathname.match(/[.-]i\.(\d+)\.(\d+)/);
    if (pathMatch) { shopId = pathMatch[1]; itemId = pathMatch[2]; }
    else {
      const sp = new URLSearchParams(location.search);
      shopId = sp.get('shopid'); itemId = sp.get('itemid');
    }

    // ── 2. Script embutido com initialState (Shopee injeta JSON inline) ──────
    // Caminho: initialState.DOMAIN_PDP.data.PDP_BFF_DATA.cachedMap[KEY].item
    try {
      const item = readShopeeEmbeddedItem();
      if (item) {
        name     = name     || item.title || item.name || null;
        // Shopee armazena preços em unidades de 1/100000 BRL (ex: 12990000 = R$129,90)
        if (item.price != null && !pricePor) {
          pricePor = item.price / 100000;
          if (pricePor <= 0) pricePor = null;
        }
        if (item.price_before_discount && !priceDe) {
          const de = item.price_before_discount / 100000;
          if (de > (pricePor || 0)) priceDe = de;
        }
        if (item.show_discount && !discount) discount = item.show_discount;
        if (item.image && !imageUrl) {
          imageUrl = `https://down-br.img.susercontent.com/file/${item.image}`;
        }
        if (item.images?.[0] && !imageUrl) {
          imageUrl = `https://down-br.img.susercontent.com/file/${item.images[0]}`;
        }
        if (!shopId && item.shop_id) shopId = String(item.shop_id);
        if (!itemId && item.item_id)  itemId = String(item.item_id);
      }
    } catch (_) {}

    // ── 3. JSON-LD ────────────────────────────────────────────────────────
    if (!name || !pricePor) {
      try {
        for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
          let obj;
          try { obj = JSON.parse(s.textContent); } catch (_) { continue; }
          const nodes = [obj, ...(obj['@graph'] || [])];
          const product = nodes.find(n => n && n['@type'] === 'Product');
          if (!product) continue;
          name     = name     || (product.name || '').trim() || null;
          imageUrl = imageUrl || (Array.isArray(product.image) ? product.image[0] : product.image) || null;
          // productID = itemId, URL contém shopId.itemId
          if (!itemId && product.productID) itemId = String(product.productID);
          if (!shopId && product.url) {
            const m = product.url.match(/[.-]i\.(\d+)\.(\d+)/);
            if (m) { shopId = m[1]; itemId = itemId || m[2]; }
          }
          const offer = product.offers || product.Offers;
          if (offer && !pricePor) {
            const raw = offer.price ?? offer.lowPrice;
            if (raw != null) pricePor = parseFloat(String(raw).replace(',', '.')) || null;
          }
          break;
        }
      } catch (_) {}
    }

    // ── 4. CSS selectors (fallback — classes da Shopee mudam, usar múltiplos) ──
    if (!name) {
      name =
        document.querySelector('._2IeTmd, [class*="product-name__text"], ._1bDC4, h1')
          ?.textContent?.trim() ||
        document.querySelector('h1')?.textContent?.trim() ||
        document.querySelector('meta[property="og:title"]')?.content?.trim() ||
        null;
    }

    // Preço atual
    if (!pricePor) {
      const selectors = [
        '._3n5NQx',            // preço de venda (classe histórica)
        '[class*="price-current"]',
        '[class*="sale-price"]',
        '[class*="priceSection"] ._3n5NQx',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const val = parseShopeePrice(el.textContent);
        if (val) { pricePor = val; break; }
      }
    }

    // Preço original (De) — tenta seletores estáticos, depois scan do DOM
    if (!priceDe) {
      priceDe = findShopeeDePriceFromDOM(pricePor);
    }

    // Desconto — tenta badge visível, depois calcula
    if (!discount) {
      discount = findShopeeDiscountFromDOM();
    }
    if (!discount && priceDe && pricePor && priceDe > pricePor) {
      discount = Math.round((1 - pricePor / priceDe) * 100);
    }

    // Imagem
    if (!imageUrl) {
      imageUrl = document.querySelector('meta[property="og:image"]')?.content || null;
    }
    if (!imageUrl) {
      const imgEl =
        document.querySelector('._3koTFK img, [class*="product-image"] img') ||
        document.querySelector('img[src*="shopee"]');
      if (imgEl) {
        imageUrl = imgEl.src || imgEl.getAttribute('data-src') || null;
        // Shopee usa URLs de thumbnail — remove parâmetros de tamanho
        if (imageUrl) imageUrl = imageUrl.replace(/_tn$/, '').split('?')[0];
      }
    }

    // Categoria via breadcrumb
    const emojiKeys = Object.keys(window.PromosConfig.EMOJI_MAP).filter(k => k !== 'default');
    outer: for (const a of document.querySelectorAll('[class*="breadcrumb"] a, [class*="shopee-breadcrumb"] a')) {
      const text = a.textContent.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      for (const key of emojiKeys) {
        if (text.includes(key)) { category = key; break outer; }
      }
    }

    // ── 5. Cupom / Voucher ────────────────────────────────────────────────
    // Shopee mostra vouchers como "R$5 OFF", "10% OFF", ou código de loja
    const shopeeCouponSelectors = [
      '[class*="voucher"] [class*="code"]',
      '[class*="coupon"] [class*="code"]',
      '[class*="voucher-code"]',
      '[class*="shopVoucher"]',
      '[class*="shop-voucher"]',
    ];
    for (const sel of shopeeCouponSelectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const text = el.textContent.trim();
      const mBrl  = text.match(/R\$\s*([\d,.]+)\s*off/i);
      const mPct  = text.match(/(\d+)\s*%/);
      // Código deve ter letras E dígitos — descarta palavras puras
      const mCode = text.match(/\b([A-Z][A-Z0-9]*[0-9][A-Z0-9]*)\b/i);
      if (mBrl)  { coupon = `R$${mBrl[1]} OFF`; break; }
      // Ignora cashback/desconto de seller pequeno (< 5%) — não é cupom relevante
      if (mPct && parseInt(mPct[1]) >= 5)  { coupon = `${mPct[1]}% OFF`; break; }
      if (mCode) { coupon = mCode[1].toUpperCase(); break; }
    }

    // ── 6. Missing ────────────────────────────────────────────────────────
    if (!name)    missing.push('nome');
    if (!pricePor) missing.push('preço');

    return { site: 'shopee', name, priceDe, pricePor, discount, coupon, couponPct: null, couponMin: null, imageUrl, shopId, itemId, category, missing };
  };

  /**
   * Escaneia o DOM visível procurando o preço original (De).
   * Estratégia 1: computedStyle com text-decoration line-through.
   * Estratégia 2: qualquer preço > 1.5× pricePor visível na área do produto.
   */
  function findShopeeDePriceFromDOM(pricePor) {
    const candidates = [];

    for (const el of document.body.querySelectorAll('*')) {
      if (el.children.length > 0) continue;
      const txt = el.textContent.trim();
      // Aceita "R$200,00" mas não intervalos como "R$29,77 - R$36,88"
      if (!/^R\$\s*[\d.,]+$/.test(txt)) continue;
      const val = parseShopeePrice(txt);
      if (!val || val <= 0) continue;
      if (pricePor && val <= pricePor) continue;

      // Prioridade 1: line-through no próprio elemento ou no pai imediato
      try {
        for (const node of [el, el.parentElement]) {
          if (!node) continue;
          const td = window.getComputedStyle(node).textDecorationLine ||
                     window.getComputedStyle(node).textDecoration;
          if (td && td.includes('line-through')) return val;
        }
      } catch (_) {}

      candidates.push({ val, el });
    }

    if (!candidates.length) return null;

    // Prioridade 2: elemento mais próximo (no DOM) de um badge de desconto
    const discountEl = [...document.body.querySelectorAll('*')]
      .find(e => e.children.length === 0 && /^-?\d{1,2}%$/.test(e.textContent.trim()));

    if (discountEl) {
      // Escolhe candidato cujo elemento está mais perto do badge (menor distância de nós)
      let best = null, bestDist = Infinity;
      for (const { val, el } of candidates) {
        const dist = domDistance(el, discountEl);
        if (dist < bestDist) { bestDist = dist; best = val; }
      }
      if (best) return best;
    }

    // Prioridade 3: menor valor acima do pricePor (mais provável ser o De real)
    candidates.sort((a, b) => a.val - b.val);
    return candidates[0].val;
  }

  /** Distância entre dois nós no DOM (subida até ancestral comum) */
  function domDistance(a, b) {
    const pathA = ancestors(a), pathB = ancestors(b);
    for (let i = 0; i < pathA.length; i++) {
      const j = pathB.indexOf(pathA[i]);
      if (j >= 0) return i + j;
    }
    return 9999;
  }

  function ancestors(el) {
    const path = [];
    let node = el;
    while (node) { path.push(node); node = node.parentElement; }
    return path;
  }

  /**
   * Encontra o percentual de desconto num elemento visível do DOM.
   * Aceita formatos: "-85%", "85% OFF", "85%"
   */
  function findShopeeDiscountFromDOM() {
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length > 0) continue;
      const txt = el.textContent.trim();
      const m = txt.match(/^-?(\d{1,2})\s*%$/) || txt.match(/^(\d{1,2})\s*%\s*off$/i);
      if (m) {
        const val = parseInt(m[1], 10);
        if (val > 0 && val < 100) return val;
      }
    }
    return null;
  }

  /**
   * Lê o objeto `item` do JSON embutido pela Shopee num <script> inline.
   * Caminho: initialState.DOMAIN_PDP.data.PDP_BFF_DATA.cachedMap[KEY].item
   */
  function readShopeeEmbeddedItem() {
    for (const s of document.querySelectorAll('script:not([src]):not([type])')) {
      const t = s.textContent;
      if (!t.includes('DOMAIN_PDP') && !t.includes('initialState')) continue;
      if (t.length > 2000000) continue; // evita scripts gigantes
      try {
        const data = JSON.parse(t);
        // Caminho principal
        const cachedMap = data?.initialState?.DOMAIN_PDP?.data?.PDP_BFF_DATA?.cachedMap;
        if (cachedMap) {
          const entry = Object.values(cachedMap)[0];
          if (entry?.item) return entry.item;
        }
        // Caminho alternativo (versões diferentes)
        const item = data?.initialState?.productDetail?.result?.item ||
                     data?.data?.item;
        if (item?.title || item?.name) return item;
      } catch (_) {}
    }
    return null;
  }

  function parseShopeePrice(str) {
    if (!str) return null;
    // "R$ 1.234,56" ou "1.234,56" ou "1234.56"
    const cleaned = str.replace(/[^\d,.]/g, '');
    // Formato BR: vírgula como decimal
    const br = cleaned.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(br);
    if (!isNaN(n) && n > 0) return n;
    // Formato com ponto como decimal
    const n2 = parseFloat(cleaned.replace(',', ''));
    return (!isNaN(n2) && n2 > 0) ? n2 : null;
  }
})();
