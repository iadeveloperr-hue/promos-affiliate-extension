(function () {
  'use strict';

  /**
   * PromosScoring — pontua candidatos (0–100) e classifica o grupo.
   *
   * Registrado em globalThis (funciona em content scripts e no service worker).
   * Configuração vem de PromosConfig.SCORING / GROUP_CATEGORIES (fonte única
   * em lib/config.js, espelhada em content/globals.js).
   *
   * scoreProduct(produto, opts) → { score, breakdown, flags }
   *   produto: { pricePor, priceDe, discount, category, site/marketplace, isRanked }
   *   opts.categoryScore: 0–100 — conversão histórica da categoria
   *     (vem do perfil de demanda, Passo 6.2; default 50 = neutro)
   *
   * classifyGroup(produto) → 'kate' | 'musculosas' | 'indefinido'
   */

  globalThis.PromosScoring = {
    scoreProduct(produto, opts = {}) {
      const cfg = getConfig().SCORING;
      const w   = cfg.weights;

      // ── Fator desconto: proporcional até descontoFull (não é corte) ──────
      const discount = num(produto.discount) ??
        (num(produto.priceDe) && num(produto.pricePor) && produto.priceDe > produto.pricePor
          ? Math.round((1 - produto.pricePor / produto.priceDe) * 100)
          : 0);
      const descontoScore = clamp((discount / cfg.descontoFull) * 100, 0, 100);

      // ── Fator categoria: conversão histórica (neutro = 50 sem dados) ─────
      const categoriaScore = clamp(num(opts.categoryScore) ?? 50, 0, 100);

      // ── Fator ranking: binário ───────────────────────────────────────────
      const rankingScore = produto.isRanked ? 100 : 0;

      // ── Fator ticket: comissão potencial em R$, escala saturante ─────────
      const marketplace = produto.site || produto.marketplace || '';
      const rate = cfg.commissionRates[marketplace] ?? 0.08;
      const commissionBRL = (num(produto.pricePor) ?? 0) * rate;
      // Saturante: atinge ~100 em ticketFullBRL, sem ultrapassar
      const ticketScore = clamp((commissionBRL / cfg.ticketFullBRL) * 100, 0, 100);

      const score = Math.round(
        descontoScore  * w.desconto +
        categoriaScore * w.categoria +
        rankingScore   * w.ranking +
        ticketScore    * w.ticket
      );

      const flags = {};
      // Flag avalia o potencial pelos OUTROS fatores (sem o desconto):
      // produto com desconto fraco mas categoria/ranking/ticket fortes entra
      // na fila marcado em vez de ser descartado.
      const wOutros = w.categoria + w.ranking + w.ticket;
      const scoreSemDesconto = wOutros > 0
        ? (categoriaScore * w.categoria + rankingScore * w.ranking + ticketScore * w.ticket) / wOutros
        : 0;
      if (discount < cfg.minDesconto && scoreSemDesconto >= cfg.minScoreAlto) {
        flags.descontoBaixoPotencialAlto = true;
      }

      return {
        score,
        breakdown: {
          desconto:  Math.round(descontoScore),
          categoria: Math.round(categoriaScore),
          ranking:   rankingScore,
          ticket:    Math.round(ticketScore),
          comissaoEstimadaBRL: Math.round(commissionBRL * 100) / 100,
        },
        flags,
      };
    },

    classifyGroup(produto) {
      const groups = getConfig().GROUP_CATEGORIES;
      const cat = (produto.category || '').toLowerCase();
      if (cat) {
        if (groups.musculosas.includes(cat)) return 'musculosas';
        if (groups.kate.includes(cat))       return 'kate';
      }
      // Sem categoria (ex: garimpo só com dados da mensagem): infere pelo nome
      return classifyByName(produto.name || '');
    },
  };

  // Palavras-chave para classificar pelo nome quando não há categoria da página
  const NAME_KEYWORDS = {
    musculosas: [
      'whey', 'creatina', 'protein', 'proteina', 'proteína', 'suplemento', 'bcaa',
      'glutamina', 'pré-treino', 'pre treino', 'pre-treino', 'albumina', 'caseina',
      'caseína', 'hipercalor', 'massa muscular', 'termogenico', 'termogênico',
      'aminoácido', 'aminoacido', 'maltodextrina', 'isotonic', 'academia', 'fitness',
      'halter', 'anilha', 'musculação', 'musculacao', 'colágeno', 'colageno',
    ],
    kate: [
      'maquiagem', 'batom', 'perfume', 'shampoo', 'condicionador', 'cabelo', 'skincare',
      'sérum', 'serum', 'hidratante', 'creme', 'beleza', 'esmalte', 'panela', 'cozinha',
      'frigideira', 'lençol', 'lencol', 'toalha', 'edredom', 'decoração', 'decoracao',
      'infantil', 'bebê', 'bebe', 'pet', 'cachorro', 'gato', 'feminin', 'vestido',
      'bolsa', 'sandália', 'sandalia', 'tênis', 'tenis',
    ],
  };

  function classifyByName(name) {
    const n = String(name).toLowerCase();
    if (!n) return 'indefinido';
    if (NAME_KEYWORDS.musculosas.some(k => n.includes(k))) return 'musculosas';
    if (NAME_KEYWORDS.kate.some(k => n.includes(k)))       return 'kate';
    return 'indefinido';
  }

  // PromosConfig vive em window (content) ou precisa ser injetado (SW/testes)
  function getConfig() {
    const c = globalThis.PromosConfig;
    if (!c || !c.SCORING) throw new Error('[Promos] PromosConfig.SCORING não disponível');
    return c;
  }

  function num(v) {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }
})();
