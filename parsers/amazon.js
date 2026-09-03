(function () {
  'use strict';
  window.PromosParser = window.PromosParser || {};

  window.PromosParser.amazon = function parseAmazon() {
    let name = null, pricePor = null, priceDe = null, discount = null;
    let coupon = null, imageUrl = null, asin = null, category = null;
    const missing = [];

    // ── 1. JSON-LD — apenas nome e imagem ────────────────────────────────
    // NÃO usamos o preço do JSON-LD: a Amazon frequentemente retorna o preço
    // de outra variante, o preço de lista desatualizado, ou o preço sem o
    // desconto promocional ativo. O DOM é sempre mais confiável para preço.
    try {
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        let obj;
        try { obj = JSON.parse(s.textContent); } catch (_) { continue; }

        const nodes = [obj, ...(obj['@graph'] || [])];
        const product = nodes.find(n => n && n['@type'] === 'Product');
        if (!product) continue;

        name = name || (product.name || '').trim() || null;

        const img = product.image;
        imageUrl = imageUrl || (Array.isArray(img) ? img[0] : img) || null;
        break;
      }
    } catch (_) {}

    // ── 2. ASIN ───────────────────────────────────────────────────────────
    asin =
      (location.pathname.match(/\/dp\/([A-Z0-9]{10})/) || [])[1] ||
      document.getElementById('ASIN')?.value ||
      document.querySelector('[name="ASIN"]')?.value ||
      null;

    // ── 3. Nome via CSS ───────────────────────────────────────────────────
    if (!name) {
      name =
        document.getElementById('productTitle')?.textContent?.trim() ||
        document.querySelector('h1.product-title-word-break')?.textContent?.trim() ||
        document.querySelector('meta[property="og:title"]')?.content?.trim() ||
        null;
    }

    // ── 4. Preço atual (Por) ──────────────────────────────────────────────
    if (!pricePor) {
      const selectors = [
        '#priceblock_ourprice',
        '#priceblock_dealprice',
        '#priceblock_saleprice',
        // novo layout corePrice
        '#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen',
        '#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen',
        // apex (Deal / Lightning Deal)
        '#apex_desktop .a-price .a-offscreen',
        // fallback genérico
        '.a-price[data-a-color="price"] .a-offscreen',
        '.a-price .a-offscreen',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const val = parsePrice(el.textContent);
        if (val) { pricePor = val; break; }
      }
    }

    // ── 5. Preço original (De) ────────────────────────────────────────────
    // Prioridade: elementos com <s> (strikethrough = preço riscado real)
    // Evita pegar preços por unidade/litro que ficam na mesma área
    priceDe = findDePrice(pricePor);

    // ── 6. Desconto ───────────────────────────────────────────────────────
    // Lê o % diretamente do badge da Amazon (mais confiável que calcular)
    discount = readDiscountBadge();

    // Se não achou badge mas tem De/Por válidos, calcula
    if (!discount && priceDe && pricePor && priceDe > pricePor) {
      discount = Math.round((1 - pricePor / priceDe) * 100);
    }

    // ── 7. Imagem ─────────────────────────────────────────────────────────
    if (!imageUrl) {
      imageUrl = document.querySelector('meta[property="og:image"]')?.content || null;
    }
    if (!imageUrl) {
      const imgEl =
        document.getElementById('landingImage') ||
        document.getElementById('imgBlkFront') ||
        document.querySelector('#main-image-container img') ||
        document.querySelector('#imageBlock img');

      if (imgEl) {
        // data-old-hires → alta resolução sem parâmetros de tamanho
        const hires = imgEl.getAttribute('data-old-hires');
        if (hires) {
          imageUrl = hires;
        } else {
          // data-a-dynamic-image: {"url": [w, h], ...} → pega a maior
          const dynStr = imgEl.getAttribute('data-a-dynamic-image');
          if (dynStr) {
            try {
              const map = JSON.parse(dynStr);
              // escolhe a URL com maior área (w*h)
              imageUrl = Object.entries(map)
                .sort((a, b) => b[1][0] * b[1][1] - a[1][0] * a[1][1])[0][0];
            } catch (_) {}
          }
          if (!imageUrl) imageUrl = imgEl.src || null;
        }
      }
    }

    // Remove parâmetros de tamanho da URL da imagem (ex: ._SL500_) para HD
    if (imageUrl) {
      imageUrl = imageUrl.replace(/\._[A-Z]{2}\d+_\./g, '.').replace(/\?.*$/, '');
    }

    // ── 8. Cupom ──────────────────────────────────────────────────────────
    let couponPct = null, couponMin = null;

    // Lê o bloco completo do promoMessage (container com o botão "Resgatar")
    // Formatos conhecidos:
    //   "Salve o cupom 10% : CUPOMZAO10. Desconto da Amazon."  ← mínimo atingido
    //   "10% de desconto em pedidos a partir de R$300 cupom: CUPOMZAO10."  ← mínimo não atingido
    const promoContainer = document.querySelector('[id^="promoMessage"]')?.closest('div');
    if (promoContainer) {
      const fullText = promoContainer.innerText || promoContainer.textContent;
      // Código alfanumérico após ":"
      const mCode = fullText.match(/cupom[:\s]+([A-Z0-9]{4,})/i) ||
                    fullText.match(/:\s*([A-Z0-9]{4,})\b/);
      if (mCode) coupon = mCode[1];
      // Percentual
      const mPct = fullText.match(/(\d+)\s*%/);
      if (mPct) couponPct = parseInt(mPct[1], 10);
      // Mínimo de compra. Formatos vistos:
      //   "a partir de R$300"
      //   "em pedidos R$450+"  /  "em pedidos a partir de R$450"  /  "em pedidos acima de R$450"
      //   "Economize R$50 em pedidos R$450+ cupom: ..."
      // Ancorar em "pedidos"/"a partir de" evita capturar o valor do desconto
      // (ex.: "Economize R$50") como se fosse o mínimo.
      const mMin = fullText.match(/a partir de R\$\s*([\d.,]+)/i) ||
                   fullText.match(/em pedidos\s*(?:de\s*|acima de\s*|a partir de\s*)?R\$\s*([\d.,]+)/i) ||
                   fullText.match(/pedidos\s*R\$\s*([\d.,]+)\s*\+/i);
      if (mMin) couponMin = parseFloat(mMin[1].replace(/\./g, '').replace(',', '.')) || null;
    }

    // Fallback: seletores clássicos se promoMessage não encontrou código
    if (!coupon) {
      for (const sel of ['#couponText', '.couponFeature .a-color-success', '#vpcButton .a-color-success']) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const text = el.textContent.trim();
        const m = text.match(/:\s*([A-Z0-9]{4,})\b/) || text.match(/\b([A-Z0-9]{4,})\b/);
        if (m) { coupon = m[1]; break; }
      }
    }

    // ── 9. Categoria (para emoji) ─────────────────────────────────────────
    const breadcrumbs = document.querySelectorAll(
      '#wayfinding-breadcrumbs_feature_div a, .a-breadcrumb a'
    );
    const emojiKeys = Object.keys(window.PromosConfig.EMOJI_MAP).filter(k => k !== 'default');
    outer: for (const a of breadcrumbs) {
      const text = a.textContent.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      for (const key of emojiKeys) {
        if (text.includes(key)) { category = key; break outer; }
      }
    }

    // ── 10. Missing ───────────────────────────────────────────────────────
    if (!name)    missing.push('nome');
    if (!pricePor) missing.push('preço');
    if (!asin)    missing.push('ASIN');

    return { site: 'amazon', name, priceDe, pricePor, discount, coupon, couponPct, couponMin, imageUrl, asin, category, missing };
  };

  /**
   * Encontra o preço original (De/riscado) evitando preços por unidade/volume.
   * Estratégia: procura <s> (strikethrough) dentro do bloco de preço,
   * depois tenta "De:" como label explícito, depois seletores genéricos
   * — mas pula elementos cujo texto pai contenha "/" (ex: R$66,57 / l).
   */
  function findDePrice(pricePor) {
    // 0. Mais preciso: dentro dos containers principais de preço, .a-text-price
    //    é o preço "De" por definição — sem ambiguidade, sem isPerUnitContext.
    // data-a-color="secondary" = preço riscado (De). "base" = preço por unidade/litro — ignorar.
    const preciseSels = [
      '#corePriceDisplay_desktop_feature_div .a-text-price[data-a-color="secondary"] .a-offscreen',
      '#corePrice_feature_div .a-text-price[data-a-color="secondary"] .a-offscreen',
      '#apex_desktop .a-text-price[data-a-color="secondary"] .a-offscreen',
      '#buybox .a-text-price[data-a-color="secondary"] .a-offscreen',
      // Fallback sem filtro de cor (layouts mais antigos)
      '#corePriceDisplay_desktop_feature_div .a-text-price .a-offscreen',
      '#corePrice_feature_div .a-text-price .a-offscreen',
    ];
    for (const sel of preciseSels) {
      for (const el of document.querySelectorAll(sel)) {
        if (isPerUnitElement(el)) continue;
        const val = parsePrice(el.textContent);
        if (val && (!pricePor || val > pricePor)) return val;
      }
    }

    // 1. .a-offscreen com label explícito "De:" (alguns layouts de leitores de tela)
    for (const el of document.querySelectorAll('.a-offscreen')) {
      if (!/^De:/i.test(el.textContent.trim())) continue;
      const val = parsePrice(el.textContent);
      if (val && (!pricePor || val > pricePor)) return val;
    }

    // 2. Strikethrough (<s>) — layouts mais antigos
    for (const sel of ['s .a-offscreen', '#priceblock_was_price']) {
      const el = document.querySelector(sel);
      if (!el || isPerUnitContext(el)) continue;
      const val = parsePrice(el.textContent);
      if (val && (!pricePor || val > pricePor)) return val;
    }

    // 3. Label "De:" como elemento irmão no DOM
    for (const el of document.querySelectorAll('span, td')) {
      if (el.childElementCount > 0) continue;
      if (!/^\s*De:\s*$/.test(el.textContent)) continue;
      for (const c of [el.nextElementSibling, el.parentElement?.nextElementSibling]) {
        if (!c) continue;
        const val = parsePrice((c.querySelector('.a-offscreen') || c).textContent);
        if (val && (!pricePor || val > pricePor)) return val;
      }
    }

    return null;
  }

  /**
   * Retorna true se o elemento ou qualquer ancestral próximo indica preço por unidade:
   * - data-a-color="base" no próprio .a-text-price  (Amazon usa "secondary" para o De)
   * - classe "pricePerUnit" num ancestral (ex: div.pricePerUnit)
   */
  function isPerUnitElement(el) {
    let node = el;
    for (let i = 0; i < 5 && node; i++, node = node.parentElement) {
      if (node.getAttribute?.('data-a-color') === 'base') return true;
      if (/pricePerUnit/i.test(node.className || '')) return true;
    }
    return false;
  }

  /**
   * Retorna true se o elemento está num contexto de preço por unidade (contém "/").
   * Verifica apenas os text nodes DIRETOS do ancestral — não usa textContent completo,
   * pois isso incluiria texto de elementos irmãos (ex: "R$62,45 / unidade" ao lado do De).
   */
  function isPerUnitContext(el) {
    let node = el.parentElement;
    for (let i = 0; i < 3 && node; i++, node = node.parentElement) {
      // Só texto direto do nó (não descendentes) para não contaminar com irmãos
      const ownText = Array.from(node.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent)
        .join('');
      if (ownText.includes('/')) return true;
    }
    return false;
  }

  /**
   * Lê o percentual de desconto diretamente do badge que a Amazon já calcula.
   * Ex: "-42%" ou "42% off"
   */
  function readDiscountBadge() {
    const selectors = [
      '.savingsPercentage',
      '#apex_desktop .a-color-price',
      '#dealsAccordionRow .a-color-price',
      '.a-badge-text',
    ];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const m = el.textContent.match(/(\d+)\s*%/);
        if (m) {
          const val = parseInt(m[1], 10);
          if (val > 0 && val < 100) return val;
        }
      }
    }
    return null;
  }

  // "R$ 1.234,56"  →  1234.56
  function parsePrice(str) {
    if (!str) return null;
    // Remove símbolo de moeda e espaços; trata formato BR (ponto=milhar, vírgula=decimal)
    const s = str.trim().replace(/R\$\s*/g, '');
    // Se tem vírgula: formato BR → remove pontos de milhar, troca vírgula por ponto
    if (s.includes(',')) {
      const n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
      return isNaN(n) || n <= 0 ? null : n;
    }
    // Sem vírgula: pode ser "61.59" (já em ponto) ou "1234" inteiro
    const n = parseFloat(s.replace(/[^\d.]/g, ''));
    return isNaN(n) || n <= 0 ? null : n;
  }
})();
