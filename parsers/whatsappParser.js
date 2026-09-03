(function () {
  'use strict';

  // Captura marketplace conhecidos (fast path) + qualquer outro URL (domínio
  // próprio de afiliado). O linkResolver segue redirects e descarta o que
  // não levar a Amazon/ML/Shopee.
  const MARKETPLACE_RE = /https?:\/\/[^\s<>"'[\]]{10,}/gi;

  // Domínios que nunca são produtos — pulados antes de enviar ao resolver.
  const SKIP_HOST_RE = /^(?:www\.)?(instagram|facebook|fb|twitter|x\.com|t\.me|wa\.me|youtube|youtu\.be|tiktok|pinterest|threads|linkedin|google|maps\.google|bit\.do|newsletter|mailto)/i;

  // Paths de perfil/bio — nunca são produtos.
  const SKIP_PATH_RE = /^\/?(bio|link[s]?|about|contato|contact|start|home|loja\/?$|store\/?$)(\?|#|$)/i;

  // Map url → { url, msgTime }
  const _urls   = new Map();
  let _observer = null;       // observa o #main da conversa aberta
  let _switchObs = null;      // observa a troca de grupo (nó estável)
  let _onCount  = null;
  let _lastSig  = null;       // assinatura do grupo atualmente ancorado
  let _switchTimer = null;

  window.PromosWhatsAppParser = {

    startObserver(onCount) {
      // Reinicia sempre: garante que o callback aponte para o contador atual
      _observer?.disconnect();
      _onCount = onCount || null;
      _bindRoot();            // ancora no #main atual + scan inicial
      // Reporta o resultado do scan inicial (senão o contador fica preso em 0)
      if (_onCount) _onCount(_urls.size);

      // Sensor de troca de grupo: ancorado num nó estável (não é destruído ao
      // trocar de conversa). Quando o grupo muda, re-ancora o observer no novo
      // #main e reescaneia sozinho — elimina o clique manual em "Reescanear".
      _switchObs?.disconnect();
      _switchObs = new MutationObserver(() => {
        clearTimeout(_switchTimer);
        _switchTimer = setTimeout(() => {
          if (_currentSig() !== _lastSig) _bindRoot();   // grupo mudou
        }, 350); // debounce: espera o WhatsApp terminar de montar a conversa
      });
      _switchObs.observe(document.body, { childList: true, subtree: true });
    },

    stopObserver() {
      _observer?.disconnect();   _observer  = null;
      _switchObs?.disconnect();  _switchObs = null;
      clearTimeout(_switchTimer);
      _lastSig = null;
    },

    get messageCount() { return _urls.size; },

    extractLinks() {
      _scanRoot();
      return Array.from(_urls.values());
    },

    clear() { _urls.clear(); },
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function _getRoot() {
    return (
      document.querySelector('#main') ||
      document.querySelector('[data-testid="conversation-panel-wrapper"]') ||
      document.body
    );
  }

  // Assinatura do grupo aberto: nome no header + identidade do nó #main.
  // Muda quando o usuário troca de conversa.
  function _currentSig() {
    const header = document.querySelector('#main header');
    return (header?.textContent || '') + '|' + (header ? '1' : '0');
  }

  // (Re)ancora o observer no #main atual e reescaneia o que está visível.
  // Chamado no início e a cada troca de grupo detectada pelo sensor.
  function _bindRoot() {
    _observer?.disconnect();
    _scanRoot();
    if (_onCount) _onCount(_urls.size);

    _observer = new MutationObserver(() => {
      const before = _urls.size;
      _scanRoot();
      if (_urls.size !== before && _onCount) _onCount(_urls.size);
    });

    const root = _getRoot();
    _observer.observe(root, { childList: true, subtree: true, characterData: true });
    _lastSig = _currentSig();
  }

  function _scanRoot() {
    const root = _getRoot();

    // Centrado no link: para cada âncora de marketplace, sobe até o balão da
    // mensagem e extrai os metadados (nome/preço/cupom/horário/foto) de lá.
    // Robusto a mudanças de classe — não depende do data-testid da mensagem.
    for (const a of root.querySelectorAll('a[href]')) {
      const m = a.href.match(new RegExp(MARKETPLACE_RE.source, 'i'));
      if (!m) continue;
      const url = _clean(m[0]);
      // Ignora redes sociais e URLs que claramente não são produtos
      try {
        const parsed = new URL(url);
        if (SKIP_HOST_RE.test(parsed.hostname)) continue;
        if (SKIP_PATH_RE.test(parsed.pathname))  continue;
      } catch (_) { continue; }
      const bubble = _findBubble(a);
      _addUrl(url, _extractMeta(bubble));
    }
  }

  /** Sobe do link até o balão da mensagem que o contém. */
  function _findBubble(a) {
    return (
      a.closest('[data-testid^="conv-msg-"]') ||
      a.closest('[data-id]') ||
      a.closest('div[class*="message"]') ||
      _walkUp(a, 8)
    );
  }

  function _walkUp(el, levels) {
    let node = el;
    for (let i = 0; i < levels && node.parentElement; i++) node = node.parentElement;
    return node;
  }

  function _extractMeta(bubble) {
    if (!bubble) return {};
    const text = bubble.innerText || bubble.textContent || '';
    const name = _extractName(bubble, text);
    return {
      msgTime: _extractTime(bubble),
      name,
      hook: _extractHook(text, name),
      imageUrl: _extractPreviewImage(bubble),
      coupon: _extractCoupon(text),
      couponsAll: _extractAllCoupons(text), // cofre de cupons (códigos + genéricos)
      ...(_extractPrices(text)), // priceDe, pricePor
    };
  }

  /**
   * TODOS os cupons da mensagem, para o cofre de cupons — inclusive os
   * GENÉRICOS da plataforma ("cupom de 50% em produtos full"), que o
   * _extractCoupon rejeita de propósito (não são do produto).
   * Retorna [{ code?, pct?, generic, label }].
   */
  function _extractAllCoupons(text) {
    if (!text) return [];
    const out = [];
    const seen = new Set();
    const push = (c) => { const k = c.label.toUpperCase(); if (!seen.has(k)) { seen.add(k); out.push(c); } };

    // 1. Códigos: "Cupom: NIVEA20", "código MELI10" (pode haver mais de um)
    const reCode = /\b(?:cupom|c[oó]digo|c[oó]d\.?)\s*[:\-=]\s*([A-Z0-9][A-Z0-9_-]{2,19})\b/gi;
    let m;
    while ((m = reCode.exec(text))) {
      const code = m[1].toUpperCase();
      if (/^\d+$/.test(code)) continue; // só dígitos = provavelmente % ou valor, não código
      // % associado se aparecer perto do código na mesma linha
      const line = text.slice(Math.max(0, m.index - 60), m.index + 80);
      const mp = line.match(/(\d{1,2})\s*%/);
      push({ code, pct: mp ? parseInt(mp[1], 10) : null, generic: false, label: code });
    }

    // 2. Percentuais SEM código ("cupom de 50% off em produtos full", "cupom 15% off")
    const GENERIC = /full|produtos|toda a loja|todos os|para todos|em compras|na loja|no site|itens|geral/i;
    const rePct = /\bcupom\b([^%\n]{0,25}?)(\d{1,2})\s*%\s*(?:off|de\s+desconto)?([^\n]{0,40})/gi;
    while ((m = rePct.exec(text))) {
      const around = (m[1] || '') + (m[3] || '');
      if (/[:\-=]\s*[A-Z0-9]/i.test(m[1] || '')) continue; // já capturado como código
      const generic = GENERIC.test(around);
      const scope = generic ? (around.match(/produtos?\s+full|toda a loja|no site|na loja/i)?.[0] || 'geral') : 'app';
      push({ code: null, pct: parseInt(m[2], 10), generic, label: `${m[2]}% OFF (${scope.toLowerCase()})` });
    }
    return out;
  }

  /**
   * Frase de chamada (hook): a linha "punchy" acima do nome do produto —
   * em CAIXA ALTA, terminando com ! / ?, ou com vogais repetidas (CORREE...).
   * Não é preço, link, cupom, menção de loja, nem o próprio nome.
   */
  function _extractHook(text, name) {
    const lines = String(text).split('\n').map(l => l.trim()).filter(Boolean);
    const nameNorm = (name || '').trim().toLowerCase();
    for (const line of lines) {
      if (line.length < 6 || line.length > 70) continue;
      if (/https?:\/\/|meli\.la|amzn\.to|shope/i.test(line)) continue;
      if (/\bR\$\s*[\d.]/.test(line)) continue;                     // preço
      if (/vendido por|loja oficial|mercado livre|\bno ml\b|shopee/i.test(line)) continue;
      if (/cupom|c[oó]digo/i.test(line)) continue;
      const low = line.toLowerCase();
      if (nameNorm && (low === nameNorm || nameNorm.includes(low) || low.includes(nameNorm))) continue;

      const letters = line.replace(/[^A-Za-zÀ-ÿ]/g, '');
      const uppers  = line.replace(/[^A-ZÀ-Þ]/g, '');
      const ratio   = letters.length ? uppers.length / letters.length : 0;
      const punchy  = ratio >= 0.6 || /[!?]\s*$/.test(line) || /(\p{L})\1{2,}/u.test(line);
      if (punchy) return _cleanHook(line);
    }
    return null;
  }

  /** Limpa emojis e espaços duplicados das pontas do hook. */
  function _cleanHook(line) {
    return line
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function _addUrl(url, meta) {
    const existing = _urls.get(url);
    if (!existing) { _urls.set(url, { url, ...meta }); return; }
    // Backfill: completa campos que faltaram numa varredura anterior (ex.: nome
    // ou foto que ainda não tinham renderizado quando o link foi capturado).
    for (const k of ['name', 'hook', 'imageUrl', 'coupon', 'priceDe', 'pricePor', 'msgTime']) {
      if ((existing[k] == null || existing[k] === '') && meta[k] != null && meta[k] !== '') {
        existing[k] = meta[k];
      }
    }
  }

  /** Extrai código de cupom do texto da mensagem (ex: "Cupom: PROMO10"). */
  function _extractCoupon(text) {
    if (!text) return null;

    // 1. Código textual: "Cupom: CODIGO" / "Código: CODIGO" (sem espaço no código)
    const mCode = text.match(/\b(?:cupom|c[oó]digo|c[oó]d\.?)\s*[:\-=]\s*([A-Z0-9][A-Z0-9_-]{2,19})\b/i);
    if (mCode) return mCode[1].toUpperCase();

    // 2. Cupom percentual do app: "CUPOM DE 20% OFF", "cupom 15% off", "cupom 10%".
    //    MAS ignora anúncio GENÉRICO do grupo (não é cupom deste produto):
    //    "rolando cupom de 50% off em produtos full", "cupom de X% em toda a loja".
    const GENERIC = /full|produtos|toda a loja|todos os|para todos|em compras|na loja|no site|itens|geral/i;
    const mPct = text.match(/\bcupom\b([^%\n]{0,20}?)(\d{1,2})\s*%\s*(?:off|de\s+desconto)?([^\n]{0,30})/i);
    if (mPct) {
      const around = (mPct[1] || '') + (mPct[3] || '');
      if (!GENERIC.test(around)) return `${mPct[2]}% OFF (app)`;
    }

    return null;
  }

  /**
   * Extrai preços "De" e "Por" da mensagem (ex: "De R$ 419,90" / "Por R$ 246,99").
   * O "Por" reflete o preço final anunciado — nos grupos, quase sempre é o valor
   * JÁ COM o cupom aplicado (raramente colam o % do cupom; colam o preço final).
   *
   * Calibrado com mensagens reais dos grupos (variam muito por admin):
   *  - "De R$ X por R$ Y", "De R$ X - Por R$ Y", "de R$X | Por R$Y"
   *  - "POR R$ Y ... custa R$ X"  (formato Amazon: "custa" é o preço original)
   *  - "Por 40,93 À vista"        (sem R$)
   *  - parcelas ("ou 6x de R$44,14", "em 6x") NÃO são De nem Por — neutralizadas
   *  - valores de desconto ("cupom de R$60 OFF") NÃO são preço — ignorados
   */
  function _extractPrices(text) {
    if (!text) return {};
    // Centavos opcionais: aceita "R$ 144" e "R$ 258,90"
    const VAL = '([\\d.]+(?:,\\d{2})?)';

    // Neutraliza parcelas ("6x de R$44,14", "ou 6x de R$30,90"): senão o "de R$"
    // da parcela seria capturado como preço original (bug da air fryer).
    const t = text.replace(new RegExp('\\d+\\s*x\\s+de\\s+R\\$\\s*' + VAL, 'gi'), ' ');

    // ── De (preço original) ──
    // "custa R$ X" (formato "POR R$ Y ... custa R$ X") tem prioridade; senão "De R$ X".
    let priceDe = null;
    let m = t.match(new RegExp('\\bcusta\\s*:?\\s*R\\$\\s*' + VAL, 'i'));
    if (m) priceDe = _brl(m[1]);
    if (priceDe == null) {
      m = t.match(new RegExp('\\bde\\s*:?\\s*R\\$\\s*' + VAL, 'i'));
      if (m) priceDe = _brl(m[1]);
    }

    // ── Por (preço final) ──
    // "por [apenas/somente/só] R$ X"; fallback sem R$ mas com centavos ("Por 40,93").
    let pricePor = null;
    m = t.match(new RegExp('\\bpor\\b(?:\\s+(?:apenas|somente|s[oó]|agora|hoje)){0,2}\\s*:?\\s*R\\$\\s*' + VAL, 'i'));
    if (!m) m = t.match(/\bpor\b(?:\s+(?:apenas|somente|s[oó]|agora|hoje)){0,2}\s*:?\s*(\d[\d.]*,\d{2})\b/i);
    if (m) pricePor = _brl(m[1]);

    // Fallback: mensagem com cupom mas SEM "por" reconhecível. Se sobra exatamente
    // UM valor "R$" (fora o De e fora valores de desconto tipo "cupom de R$60 OFF"),
    // ele é o preço final.
    if (pricePor == null && /cupom|c[oó]digo/i.test(t)) {
      const re = new RegExp('R\\$\\s*' + VAL, 'gi');
      const cands = [];
      let mm;
      while ((mm = re.exec(t)) !== null) {
        const v = _brl(mm[1]);
        if (v === priceDe) continue;
        const before = t.slice(Math.max(0, mm.index - 12), mm.index).toLowerCase();
        const after  = t.slice(re.lastIndex, re.lastIndex + 14).toLowerCase();
        if (/cupom\s+de\s*$|desconto\s*(?:de)?\s*$/.test(before)) continue; // é desconto, não preço
        if (/^\s*(?:off|de\s+desconto)/.test(after)) continue;
        cands.push(v);
      }
      if (cands.length === 1) pricePor = cands[0];
    }

    const out = {};
    if (priceDe  != null) out.priceDe  = priceDe;
    if (pricePor != null) out.pricePor = pricePor;
    return out;
  }

  /** "1.234,56" → 1234.56 */
  function _brl(s) {
    return parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
  }

  /**
   * Nome do produto: prioriza o título da pré-visualização do link (og:title que
   * o WhatsApp buscou). Fallback: a linha "limpa" mais longa da mensagem.
   */
  function _extractName(el, text) {
    // 1. Título do preview do link (estrutura do WhatsApp Web)
    const previewTitle =
      el.querySelector('[data-testid="media-link-title"]') ||
      el.querySelector('a[href] [role="link"] span') ||
      el.querySelector('a[target="_blank"] span[dir="auto"]');
    const pv = previewTitle?.innerText?.trim();
    // Ignora se o "título" for na verdade a URL do link
    const looksLikeUrl = pv && /https?:\/\/|meli\.la|amzn\.to|shope\.ee|shopee\.com|mercadoli/i.test(pv);
    if (pv && pv.length >= 8 && !looksLikeUrl) return pv;

    // 2. Heurística por pontuação. O nome do produto costuma ficar ACIMA do
    //    bloco de preço e NÃO começa com emoji — diferente de banners/avisos.
    const lines = String(text).split('\n').map(l => l.trim()).filter(Boolean);

    // Banners/avisos promocionais que NÃO são o nome do produto
    const BLOCK = /atenç|atenc|salve o contato|frete|loja oficial|piscou|aproveite|relâmpag|relampag|perdeu|estoque|clique|link na|\badms?\b|grupo|oferta|cupom|compre|últim|ultim|corre/i;

    // Índice da 1ª linha de preço ("De/Por … R$")
    let priceIdx = -1;
    lines.forEach((l, i) => {
      if (priceIdx === -1 && /\bR\$\s*[\d.]+/.test(l) && /\b(de|por)\b/i.test(l)) priceIdx = i;
    });

    let best = null, bestScore = -Infinity;
    lines.forEach((line, i) => {
      if (line.length < 10 || line.length > 140) return;
      if (/https?:\/\/|meli\.la|amzn\.to|shope\.ee|shopee\.com|mercadoli/i.test(line)) return;
      if (/^\+?\d[\d\s().-]{6,}$/.test(line)) return;       // telefone
      if (/\bR\$\s*[\d.]+/.test(line)) return;              // linha de preço
      if (BLOCK.test(line)) return;
      if (/\d{1,2}:\d{2}/.test(line) && line.length < 12) return; // horário

      const leadingEmoji = /^[^\p{L}\p{N}]/u.test(line);
      const score =
        (priceIdx >= 0 && i < priceIdx ? 1000 : 0) -  // acima do preço
        (leadingEmoji ? 300 : 0) +                    // sem emoji inicial
        line.length;                                  // desempate por tamanho
      if (score > bestScore) { bestScore = score; best = line; }
    });

    return best ? best.replace(/^[^\p{L}\p{N}]+/u, '').trim() : null;
  }

  /**
   * Imagem da mensagem. Cobre três casos:
   *  1. thumbnail da pré-visualização do link (no próprio balão)
   *  2. imagem colada COM legenda (mesmo balão)
   *  3. imagem colada em balão SEPARADO (vizinho, sem link próprio)
   * O WhatsApp serve a mídia como blob:, então capturamos via canvas → data: URL.
   */
  function _extractPreviewImage(bubble) {
    let img = _largestImageIn(bubble);          // casos 1 e 2
    if (!img) img = _adjacentImage(bubble);     // caso 3
    if (!img) return null;
    const data = _captureImage(img);
    if (data) return data;
    return /^https?:\/\//.test(img.src) ? img.src : null; // fallback raro
  }

  /** Maior <img> "de conteúdo" dentro do elemento (ignora avatar/emoji). */
  function _largestImageIn(el) {
    if (!el) return null;
    let best = null;
    for (const img of el.querySelectorAll('img')) {
      const area = (img.naturalWidth || 0) * (img.naturalHeight || 0);
      if (area < 4000) continue; // ~< 64x64
      if (!best || area > (best.naturalWidth * best.naturalHeight)) best = img;
    }
    return best;
  }

  /** Imagem colada num balão vizinho (anterior/seguinte) que não tem link próprio. */
  function _adjacentImage(bubble) {
    const re = new RegExp(MARKETPLACE_RE.source, 'i');
    for (const sib of [_siblingMsg(bubble, -1), _siblingMsg(bubble, 1)]) {
      if (!sib) continue;
      // Pula vizinho que tem link de marketplace próprio (é outro produto)
      const hasOwnLink = [...sib.querySelectorAll('a[href]')].some(a => re.test(a.href));
      if (hasOwnLink) continue;
      const img = _largestImageIn(sib);
      if (img) return img;
    }
    return null;
  }

  /** Balão de mensagem deslocado em `dir` (-1 anterior, +1 seguinte). */
  function _siblingMsg(bubble, dir) {
    if (!bubble) return null;
    const all = [..._getRoot().querySelectorAll('[data-id]')];
    const i = all.indexOf(bubble);
    return i === -1 ? null : (all[i + dir] || null);
  }

  /** Desenha a imagem num canvas redimensionado e retorna data: URL (JPEG). */
  function _captureImage(imgEl) {
    try {
      if (!imgEl.complete || !(imgEl.naturalWidth > 0)) return null;
      const maxW = 600; // resolução suficiente p/ reaproveitar no post
      const scale = Math.min(1, maxW / imgEl.naturalWidth);
      const w = Math.round(imgEl.naturalWidth * scale);
      const h = Math.round(imgEl.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(imgEl, 0, 0, w, h);
      return canvas.toDataURL('image/jpeg', 0.82);
    } catch (_) {
      return null; // canvas tainted ou erro de desenho
    }
  }

  function _extractTime(msgEl) {
    // data-pre-plain-text: "[HH:MM, DD/MM/YYYY] Nome:" — fonte mais confiável
    const copyable = msgEl.querySelector('[data-pre-plain-text]');
    if (copyable) {
      const pre = copyable.getAttribute('data-pre-plain-text') || '';
      const m = pre.match(/\[(\d{1,2}:\d{2})[\s,]+(\d{1,2}\/\d{1,2}\/\d{4})\]/);
      if (m) return `${m[1]} ${m[2]}`;
    }
    // data-testid="msg-time"
    const timeEl = msgEl.querySelector('[data-testid="msg-time"]');
    if (timeEl) return timeEl.textContent.trim();
    return null;
  }

  function _clean(url) {
    return url.replace(/[.,;!?)]+$/, '');
  }
})();
