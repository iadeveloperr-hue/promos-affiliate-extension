(function () {
  'use strict';

  /**
   * PromosDemandProfile — calcula o perfil de demanda por categoria a partir
   * do commissionStats acumulado no storage (Passo 6.1 / scraper ML).
   *
   * getDemandProfile(stats, grupo)
   *   → { [categoria]: { categoryScore, rank, avgTicket, conversao } }
   *
   * categoryScore (0–100) alimenta opts.categoryScore em PromosScoring.scoreProduct().
   * Se não houver dados suficientes, retorna 50 (neutro) para todas as categorias.
   *
   * Lógica:
   *   - conversao  = comissaoTotal / qtdVendas  (comissão por unidade vendida)
   *   - avgTicket  = receita / qtdVendas
   *   - score base = normalizado 0–100 dentro das categorias do grupo
   *   - categorias fora do grupo (kate / musculosas) ficam em 50
   *   - categorias sem dados ficam em 50
   */

  globalThis.PromosDemandProfile = {

    /**
     * Calcula perfil para um grupo específico.
     * @param {object} stats  commissionStats do PromosStore.getCommissionStats()
     * @param {string} grupo  'kate' | 'musculosas' | null (= todos)
     * @returns {{ [cat]: { categoryScore, rank, avgTicket, conversao } }}
     */
    getDemandProfile(stats, grupo) {
      if (!stats || !stats.categorias || !Object.keys(stats.categorias).length) {
        return {};
      }

      const cfg    = getConfig();
      const grupos = cfg.GROUP_CATEGORIES;
      const allowedCats = grupo && grupos[grupo] ? grupos[grupo] : null;

      // Filtra e calcula métricas por categoria
      const entries = [];
      for (const [cat, data] of Object.entries(stats.categorias)) {
        if (allowedCats && !allowedCats.includes(cat)) continue;
        if (!data.qtdVendas || data.qtdVendas === 0) continue;

        entries.push({
          cat,
          conversao:  data.comissaoTotal / data.qtdVendas,
          avgTicket:  data.receita       / data.qtdVendas,
          qtdVendas:  data.qtdVendas,
          comissaoTotal: data.comissaoTotal,
        });
      }

      if (!entries.length) return {};

      // Normaliza conversao para 0–100 dentro do grupo
      const maxConversao = Math.max(...entries.map(e => e.conversao));
      const minConversao = Math.min(...entries.map(e => e.conversao));
      const range = maxConversao - minConversao;

      // Ordena por conversao desc para rank
      entries.sort((a, b) => b.conversao - a.conversao);

      const profile = {};
      entries.forEach((e, i) => {
        const normalized = range > 0
          ? Math.round(((e.conversao - minConversao) / range) * 70 + 30)  // escala 30–100
          : 70; // todos iguais → score neutro alto

        profile[e.cat] = {
          categoryScore: normalized,
          rank:          i + 1,
          avgTicket:     Math.round(e.avgTicket * 100) / 100,
          conversao:     Math.round(e.conversao * 100) / 100,
          qtdVendas:     e.qtdVendas,
          comissaoTotal: Math.round(e.comissaoTotal * 100) / 100,
        };
      });

      return profile;
    },

    /**
     * Retorna o categoryScore para uma categoria específica e grupo.
     * Carrega stats do storage automaticamente.
     * @returns {Promise<number>} 0–100 (50 se sem dados)
     */
    async getCategoryScore(categoria, grupo) {
      if (!categoria) return 50;
      const stats = await globalThis.PromosStore.getCommissionStats();
      if (!stats) return 50;

      const profile = this.getDemandProfile(stats, grupo);
      return profile[categoria]?.categoryScore ?? 50;
    },

    /**
     * Retorna o perfil completo lendo do storage.
     */
    async getFullProfile(grupo) {
      const stats = await globalThis.PromosStore.getCommissionStats();
      if (!stats) return {};
      return this.getDemandProfile(stats, grupo);
    },
  };

  function getConfig() {
    const c = globalThis.PromosConfig;
    if (!c || !c.GROUP_CATEGORIES) throw new Error('[Promos] PromosConfig.GROUP_CATEGORIES não disponível');
    return c;
  }
})();
