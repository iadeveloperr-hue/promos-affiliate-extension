(function () {
  'use strict';
  window.PromosParser = window.PromosParser || {};

  window.PromosParser.mercadolivre = function parseMercadoLivre() {
    let name = null, pricePor = null, priceDe = null, discount = null;
    let coupon = null, imageUrl = null, mlbId = null, category = null;
    let priceCondicional = null, condicaoLabel = null;
    const missing = [];

    // ── 1. JSON-LD ────────────────────────────────────────────────────────
    try {
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        let obj;
        try { obj = JSON.parse(s.textContent); } catch (_) { continue; }

        const nodes = [obj, ...(obj['@graph'] || [])];
        const product = nodes.find(n => n && n['@type'] === 'Product');
        if (!product) continue;

        name     = name     || (product.name || '').trim() || null;
        imageUrl = imageUrl || (Array.isArray(product.image) ? product.image[0] : product.image) || null;

        const offer = product.offers || product.Offers;
        if (offer && !pricePor) {
          const raw = offer.price ?? offer.lowPrice;
          if (raw != null) pricePor = parseFloat(String(raw).replace(',', '.')) || null;
        }
        break;
      }
    } catch (_) {}

    // ── 2. MLB ID ─────────────────────────────────────────────────────────
    // Formatos: /MLB-1234567-..., /p/MLB1234567, ?itemId=MLB1234567
    mlbId =
      (location.href.match(/\bMLB[-]?(\d+)/i) || [])[0]?.replace('-', '') ||
      (document.querySelector('[data-testid="item-id"]') || {}).textContent?.trim() ||
      null;

    // ── 3. Nome via CSS ───────────────────────────────────────────────────
    if (!name) {
      name =
        document.querySelector('h1.ui-pdp-title')?.textContent?.trim() ||
        document.querySelector('h1[class*="title"]')?.textContent?.trim() ||
        document.querySelector('h1')?.textContent?.trim() ||
        document.querySelector('meta[property="og:title"]')?.content?.trim() ||
        null;
    }

    // ── 4. Preço atual (Por) — prioriza preço Pix ────────────────────────
    // O preço Pix é o mais vantajoso para o consumidor (sempre divulgamos o menor).
    // O JSON-LD frequentemente retorna o preço da parcela (sem desconto Pix).
    const pixResult = findPixPrice();
    if (pixResult.price) {
      pricePor = pixResult.price;
      if (pixResult.discount) discount = pixResult.discount;
    }

    if (!pricePor) {
      pricePor = readMeliPrice([
        '.ui-pdp-price__second-line .andes-money-amount:not([class*="original"])',
        '.ui-pdp-price__second-line .andes-money-amount',
        '.ui-pdp-buybox .andes-money-amount:not([class*="original"])',
        '.ui-pdp-container .andes-money-amount',
      ], { skipStrike: true });
    }

    // ── 4b. Preço em destaque que depende de CUPOM ────────────────────────
    // Layout visto ao vivo (MLB40291031):
    //   S.ui-pdp-price__original-value    → 349,90  (De)
    //   .ui-pdp-price__second-line        → 123,40  + "64% OFF"
    //   .ui-pdp-price-breakdown           → "no Pix com Cupom"   ← condição
    //   .ui-pdp-price__subtitles          → "ou R$ 129,90 em outros meios"
    // Ou seja: o preço GRANDE da página só vale com cupom, e o preço firme é o
    // "em outros meios". Anunciar o 123,40 é o mesmo erro do 20NIVEA, mas vindo
    // direto da página. Desconto no Pix/saldo (sem cupom) continua valendo —
    // é só forma de pagamento, não exige cupom.
    const cond = findConditionalPrice();
    if (cond.exigeCupom && cond.precoFirme) {
      priceCondicional = pricePor;                 // guarda para o overlay mostrar
      condicaoLabel    = cond.label;
      pricePor         = cond.precoFirme;
      discount         = null;                     // o "64% OFF" era do preço com cupom
    }

    // ── 5. Preço original (De) ────────────────────────────────────────────
    // ML usa aria-label="Antes: 179 reais com 99 centavos" — sem <del>/<s>
    priceDe = findMeliDePrice(pricePor);

    // ── 6. Desconto ───────────────────────────────────────────────────────
    if (!discount) {
      const discountEl = document.querySelector(
        '.ui-pdp-price__discount, [class*="price__discount"], [class*="discount-label"]'
      );
      if (discountEl) {
        const m = discountEl.textContent.match(/(\d+)\s*%/);
        if (m) discount = parseInt(m[1], 10);
      }
    }
    if (!discount && priceDe && pricePor && priceDe > pricePor) {
      discount = Math.round((1 - pricePor / priceDe) * 100);
    }

    // ── 7. Imagem ─────────────────────────────────────────────────────────
    // og:image é meta tag estática — funciona em abas de background sem lazy-load
    if (!imageUrl) {
      imageUrl = document.querySelector('meta[property="og:image"]')?.content || null;
    }
    if (!imageUrl) {
      const imgEl =
        document.querySelector('.ui-pdp-gallery__figure img') ||
        document.querySelector('.ui-pdp-image') ||
        document.querySelector('[class*="gallery"] img');
      if (imgEl) {
        imageUrl =
          imgEl.getAttribute('data-zoom') ||
          imgEl.getAttribute('data-src')  ||
          (imgEl.src?.startsWith('http') ? imgEl.src : null);
      }
    }

    // ── 8. Categoria ──────────────────────────────────────────────────────
    const breadcrumbs = document.querySelectorAll(
      '.andes-breadcrumb__item a, [class*="breadcrumb"] a'
    );
    const emojiKeys = Object.keys(window.PromosConfig.EMOJI_MAP).filter(k => k !== 'default');
    outer: for (const a of breadcrumbs) {
      // Normaliza acento: "Calçados" → "calcados" (as chaves do EMOJI_MAP não têm acento)
      const text = a.textContent.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      for (const key of emojiKeys) {
        if (text.includes(key)) { category = key; break outer; }
      }
    }

    // ── 8. Cupom ──────────────────────────────────────────────────────────
    // Cupons reais do ML sempre contêm letras E dígitos (ex: CUPOM10, PRIMEIRA10).
    // Seletores mais específicos: só elementos realmente destinados a exibir cupom.
    const meliCouponSelectors = [
      '[class*="coupon"] [class*="code"]',
      '[class*="coupon-code"]',
      '[data-testid*="coupon"]',
    ];
    for (const sel of meliCouponSelectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const text = el.textContent.trim().toUpperCase();
      const mPct  = text.match(/(\d+)\s*%/);
      // Código deve ter letras E dígitos — descarta palavras puras como ARMAZENADO, FRETE
      const mCode = text.match(/\b([A-Z][A-Z0-9]*[0-9][A-Z0-9]*)\b/);
      if (mPct)  { coupon = `${mPct[1]}% de desconto (clique na página)`; break; }
      if (mCode) { coupon = mCode[1]; break; }
    }

    // ── 9. Vídeo do produto (para reels) ──────────────────────────────────
    const videoUrl = findMeliVideo();

    // ── 10. Missing ───────────────────────────────────────────────────────
    if (!name)    missing.push('nome');
    if (!pricePor) missing.push('preço');

    return { site: 'mercadolivre', name, priceDe, pricePor, discount, coupon, couponPct: null, couponMin: null,
             priceCondicional, condicaoLabel, imageUrl, videoUrl, mlbId, category, missing };
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Encontra a URL do vídeo do produto (para gerar reels).
   * O ML serve vídeo como HLS (master playlist .m3u8), embutido no estado da
   * página como "video_url". O download/concat dos segmentos .ts é feito depois
   * pelo service worker. Retorna null se o produto não tem vídeo.
   */
  function findMeliVideo() {
    // 1. video_url no JSON embutido (formato real do ML: master .m3u8)
    for (const s of document.querySelectorAll('script')) {
      const t = s.textContent || '';
      if (!t.includes('video_url')) continue;
      const m = t.match(/"video_url"\s*:\s*"([^"]+\.m3u8[^"]*)"/);
      if (m) return m[1].replace(/\\u002[fF]/g, '/').replace(/\\\//g, '/');
    }

    // 2. Fallback: qualquer .m3u8 do mlstatic no HTML
    const html = document.documentElement.innerHTML;
    const m = html.match(/https?:(?:\\?\/){2}[^"'\s\\]*mlstatic[^"'\s\\]+\.m3u8[^"'\s\\]*/);
    if (m) return m[0].replace(/\\u002[fF]/g, '/').replace(/\\\//g, '/');

    // 3. Fallback: og:video / .mp4 direto (caso o ML mude o formato)
    const ogVideo =
      document.querySelector('meta[property="og:video"]')?.content ||
      document.querySelector('meta[property="og:video:secure_url"]')?.content;
    if (ogVideo && ogVideo.startsWith('http')) return ogVideo;

    return null;
  }

  /**
   * Encontra o preço Pix no ML (menor preço, mais vantajoso para divulgação).
   * ML exibe: "R$ 404,10  55% OFF  no Pix ou Saldo no Mercado Pago"
   * O bloco Pix fica ANTES das parcelas e tem texto "pix" próximo.
   */
  function findPixPrice() {
    // Procura container que contenha "pix" e um andes-money-amount
    const containers = [
      document.querySelector('[class*="payment-summary"]'),
      document.querySelector('[class*="pix"]'),
      // O bloco de preço principal — "second-line" costuma ter o Pix primeiro
      document.querySelector('.ui-pdp-price__second-line'),
      document.querySelector('.ui-pdp-price__main-prices'),
    ].filter(Boolean);

    for (const container of containers) {
      const text = container.textContent || '';
      if (!/pix/i.test(text)) continue;

      // Preço: primeiro andes-money-amount não riscado
      const priceEl = container.querySelector(
        '.andes-money-amount:not([class*="original"]):not(del .andes-money-amount)'
      );
      if (!priceEl || priceEl.closest('del, s')) continue;

      const label = priceEl.getAttribute('aria-label') || '';
      let price = parseMeliLabel(label);
      if (!price) {
        const frac  = priceEl.querySelector('.andes-money-amount__fraction');
        const cents = priceEl.querySelector('.andes-money-amount__cents');
        if (frac) {
          price = parseFloat(frac.textContent.replace(/\./g, '') + '.' +
                             (cents ? cents.textContent.padEnd(2, '0').slice(0, 2) : '00'));
        }
      }
      if (!price || price <= 0) continue;

      // Desconto Pix: badge "NN% OFF" no mesmo container
      let discount = null;
      const m = text.match(/(\d{1,3})\s*%\s*OFF/i);
      if (m) discount = parseInt(m[1], 10);

      return { price, discount };
    }
    return { price: null, discount: null };
  }

  /** Bloco de preço DO PRODUTO (nunca os carrosséis de recomendação). */
  function priceBox() {
    return document.querySelector('.ui-pdp-price')
        || document.querySelector('.ui-pdp-price__main-container')
        || document.querySelector('.ui-pdp-buybox')
        || null;
  }

  /**
   * Detecta quando o preço em destaque só vale COM CUPOM e devolve o preço
   * firme ("ou R$ X em outros meios").
   * Retorna { exigeCupom, label, precoFirme }.
   */
  function findConditionalPrice() {
    const box = priceBox();
    if (!box) return { exigeCupom: false, label: null, precoFirme: null };

    // O rótulo da condição fica no breakdown, ao lado do preço grande.
    const labelEl = box.querySelector('.ui-pdp-price-breakdown, [class*="price-breakdown"]');
    const label = labelEl ? (labelEl.innerText || labelEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
    if (!/cupom/i.test(label)) return { exigeCupom: false, label: label || null, precoFirme: null };

    // Preço firme: "ou R$ 129,90 em outros meios" (fora do highlight).
    let precoFirme = null;
    const subs = box.querySelector('.ui-pdp-price__subtitles') || box;
    for (const el of subs.querySelectorAll('.andes-money-amount')) {
      const contexto = (el.parentElement?.parentElement?.innerText || '');
      if (!/outros meios|em outros/i.test(contexto)) continue;
      if (el.closest('del, s')) continue;
      const v = parseMeliLabel(el.getAttribute('aria-label') || '') || readAmount(el);
      if (v) { precoFirme = v; break; }
    }
    return { exigeCupom: true, label: label || 'com cupom', precoFirme };
  }

  /** Lê o valor de UM elemento .andes-money-amount (fraction + cents). */
  function readAmount(el) {
    const frac  = el.querySelector('.andes-money-amount__fraction');
    const cents = el.querySelector('.andes-money-amount__cents');
    if (!frac) return null;
    const v = parseFloat(frac.textContent.replace(/\./g, '').trim() + '.' +
                         (cents ? cents.textContent.trim().padEnd(2, '0').slice(0, 2) : '00'));
    return v > 0 ? v : null;
  }

  /**
   * Encontra o preço original (De) no ML.
   * ML marca com aria-label="Antes: X reais..." — não usa <del>/<s>.
   *
   * SÓ dentro do bloco de preço do produto: a página tem ~18 "Antes:" (todos os
   * carrosséis de recomendação têm o seu). Varrendo o documento inteiro, bastava
   * o produto não ter preço riscado para o "De" do post virar o de OUTRO produto.
   */
  function findMeliDePrice(pricePor) {
    const box = priceBox() || document;
    for (const el of box.querySelectorAll('.andes-money-amount')) {
      const label = el.getAttribute('aria-label') || '';
      if (!/antes/i.test(label)) continue;
      // Remove o prefixo "Antes: " e faz parse
      const clean = label.replace(/^antes[:\s]*/i, '');
      const val = parseMeliLabel(clean);
      if (val && (!pricePor || val > pricePor)) return val;
    }
    // Fallback (ainda dentro do bloco do produto): <del>/<s> ou a própria
    // classe original-value, que no layout novo é o <s> e não traz "Antes:".
    for (const sel of ['del .andes-money-amount', 's.andes-money-amount', 's .andes-money-amount',
                        '.ui-pdp-price__original-value', '.ui-pdp-price__original-value .andes-money-amount']) {
      for (const el of box.querySelectorAll(sel)) {
        const val = parseMeliLabel(el.getAttribute('aria-label') || '') || readAmount(el);
        if (val && (!pricePor || val > pricePor)) return val;
      }
    }
    return null;
  }

  /**
   * Lê um preço ML a partir de uma lista de seletores.
   * ML armazena o valor em aria-label ("19 reais con 97 centavos" ou "R$ 19,97")
   * ou nas partes fraction + cents.
   */
  function readMeliPrice(selectors, { skipStrike = false } = {}) {
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (skipStrike && el.closest('del, s')) continue;

        // 1. aria-label direto no container
        const label = el.getAttribute('aria-label') || '';
        let val = parseMeliLabel(label);
        if (val) return val;

        // 2. Fraction + cents
        const fraction = el.querySelector('.andes-money-amount__fraction');
        const cents    = el.querySelector('.andes-money-amount__cents');
        if (fraction) {
          const f = fraction.textContent.replace(/\./g, '').trim();
          const c = cents ? cents.textContent.trim().padEnd(2, '0') : '00';
          val = parseFloat(`${f}.${c}`);
          if (val > 0) return val;
        }
      }
    }
    return null;
  }

  /**
   * Converte aria-label ML para número.
   * Formatos: "R$ 19,97" | "19 reais con 97 centavos" | "19 reais"
   */
  function parseMeliLabel(str) {
    if (!str) return null;
    // "R$ 1.234,56" ou "1.234,56"
    const m1 = str.match(/([\d.]+),(\d{1,2})/);
    if (m1) {
      const n = parseFloat(m1[1].replace(/\./g, '') + '.' + m1[2].padEnd(2, '0'));
      return n > 0 ? n : null;
    }
    // "19 reais con 97 centavos"
    const m2 = str.match(/(\d+)\s*reais?(?:\s+(?:con|e)\s+(\d+)\s*centavos?)?/i);
    if (m2) {
      const n = parseFloat(m2[1] + '.' + (m2[2] || '00').padEnd(2, '0'));
      return n > 0 ? n : null;
    }
    return null;
  }
})();
