(function () {
  'use strict';

  /**
   * PromosRadarEngine — lado content script do Radar.
   *
   * Chamado pelo service worker via action:'parseAndScoreForRadar' quando
   * o Radar abre uma aba de ranking em background.
   *
   * parseAndScore() → { enqueued, skipped, details }
   *   - Usa PromosRankingParser para extrair produtos da página atual
   *   - Cruza com PromosDemandProfile para obter categoryScore real
   *   - Verifica isRanked via PromosStore.isProductRanked
   *   - Pontua com PromosScoring.scoreProduct
   *   - Classifica grupo com PromosScoring.classifyGroup
   *   - Dedupe via PromosStore.isDuplicate
   *   - Enfileira via PromosStore.enqueue
   *   - Respeita maxPerRun por grupo (config RADAR.maxPerRun)
   */

  window.PromosRadarEngine = {

    /**
     * parseAndScore(opts)
     *   opts.includeIndefinido (false): também enfileira itens sem grupo
     *     definido (o usuário escolhe o grupo na fila). Usado na captura manual.
     *   opts.maxTotal: teto de itens enfileirados (padrão 50 no modo amplo).
     *
     * Modo padrão (radar automático): pula indefinido e respeita o limite por
     * grupo de RADAR.maxPerRun.
     */
    async parseAndScore(opts = {}) {
      const includeIndefinido = !!opts.includeIndefinido;
      const parsed = window.PromosRankingParser.parse();
      const products = parsed.products || [];

      if (!products.length) {
        return { enqueued: 0, skipped: 0, details: 'nenhum produto extraído da página' };
      }

      const cfg      = window.PromosConfig.RADAR;
      const stats    = await window.PromosStore.getCommissionStats();
      const profile  = window.PromosDemandProfile.getDemandProfile(stats, null);
      const maxTotal = opts.maxTotal ?? (includeIndefinido ? 50 : Infinity);

      const counts  = { kate: 0, musculosas: 0, indefinido: 0 };
      let enqueued  = 0, skipped = 0;

      for (const p of products) {
        if (enqueued >= maxTotal) { skipped++; continue; }

        const grupo = window.PromosScoring.classifyGroup(p);
        if (grupo === 'indefinido' && !includeIndefinido) { skipped++; continue; }

        // Limite por grupo só no modo radar (no modo amplo vale só o maxTotal)
        if (!includeIndefinido) {
          const max = cfg.maxPerRun[grupo] || 5;
          if (counts[grupo] >= max) { skipped++; continue; }
        }

        // isRanked: vem do parser (página de ranking) ou checado no store
        const isRanked = p.isRanked || await window.PromosStore.isProductRanked(p);
        const categoryScore = profile[p.category]?.categoryScore ?? 50;

        const { score, breakdown, flags } = window.PromosScoring.scoreProduct(
          { ...p, isRanked },
          { categoryScore }
        );

        const candidate = {
          ...p,
          productUrl: p.url,  // normaliza o campo que o SW usa para abrir a aba
          score, breakdown, flags,
          grupo,
          isRanked,
          origem: 'Radar',
        };

        const isDup = await window.PromosStore.isDuplicate(candidate);
        if (isDup) { skipped++; continue; }

        const ok = await window.PromosStore.enqueue(candidate);
        if (ok) { enqueued++; counts[grupo]++; } else { skipped++; }
      }

      return {
        enqueued, skipped,
        details: `kate:${counts.kate} musculosas:${counts.musculosas} indef:${counts.indefinido}`,
      };
    },
  };
})();
