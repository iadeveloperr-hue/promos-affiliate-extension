(function () {
  'use strict';

  /**
   * PromosStore — wrapper sobre chrome.storage.local.
   *
   * Estruturas:
   *   postedHistory   : { [idCanonico]: {id, nome, marketplace, grupo, postadoEm} }
   *   reviewQueue     : [ candidato, ... ]  (candidatos aguardando revisão)
   *   commissionStats : { [categoria]: {qtdVendas, comissaoTotal, ticketMedio, ...} }
   *
   * Todas as funções são async (chrome.storage.local é assíncrono).
   */
  window.PromosStore = {
    // ── Genéricos ─────────────────────────────────────────────────────────
    async get(key, fallback) {
      const obj = await chrome.storage.local.get(key);
      return obj[key] !== undefined ? obj[key] : fallback;
    },

    async set(key, value) {
      await chrome.storage.local.set({ [key]: value });
    },

    // ── postedHistory ─────────────────────────────────────────────────────

    /**
     * ID canônico do produto: prioriza o ID nativo do marketplace,
     * cai para hash da URL normalizada.
     */
    productId(produto) {
      if (produto.asin)   return `amazon:${produto.asin}`;
      if (produto.mlbId)  return `ml:${produto.mlbId}`;
      if (produto.itemId) return `shopee:${produto.shopId || '0'}.${produto.itemId}`;
      if (produto.url)    return `url:${hashString(normalizeUrl(produto.url))}`;
      return null;
    },

    /** True se o produto já foi postado antes. */
    async isDuplicate(produto) {
      const id = this.productId(produto);
      if (!id) return false;
      const history = await this.get('postedHistory', {});
      return id in history;
    },

    /** Registra o produto como postado. */
    async addToHistory(produto, grupo) {
      const id = this.productId(produto);
      if (!id) return;
      const history = await this.get('postedHistory', {});
      history[id] = {
        id,
        nome:        produto.name || produto.nome || '',
        marketplace: produto.site || produto.marketplace || '',
        grupo:       grupo || produto.grupo || '',
        postadoEm:   new Date().toISOString(),
        cand:        slimCandidate(produto, grupo), // p/ "Re-aprovar" do histórico
      };
      await this.set('postedHistory', history);
    },

    /** Apaga o histórico de postados (usar com cuidado — remove a proteção anti-repost). */
    async clearHistory() {
      await this.set('postedHistory', {});
    },

    // ── phraseBank (frases de chamada reutilizáveis) ──────────────────────
    // Estrutura: { [grupo]: { [chave]: [frase, ...] } }. Chave = palavra-chave
    // do nome (canônica) → senão categoria. Frases mais recentes primeiro.

    /** Frases salvas para o produto/grupo (mais recentes primeiro). */
    async getPhrases(group, produto) {
      const key = phraseKey(produto);
      if (!key) return [];
      const bank = await this.get('phraseBank', {});
      return ((bank[group] && bank[group][key]) || []).slice();
    },

    /** Salva uma frase na chave da categoria do produto (dedup; teto de 20).
     *  Se o produto não dá pra classificar (sem chave), cai no pool GERAL. */
    async addPhrase(group, produto, phrase) {
      const text = String(phrase || '').trim();
      if (!text) return;
      const key = phraseKey(produto);
      if (!key) return this.addGeneralPhrase(group, text);
      await this._addToBucket(group, key, text, 20);
    },

    /** Remove uma frase da chave da categoria do produto. */
    async removePhrase(group, produto, phrase) {
      const key = phraseKey(produto);
      if (!key) return;
      await this._removeFromBucket(group, key, phrase);
    },

    // ── Frases GERAIS (valem para qualquer produto) ───────────────────────
    async getGeneralPhrases(group) {
      const bank = await this.get('phraseBank', {});
      return ((bank[group] && bank[group].__geral__) || []).slice();
    },

    /** Salva uma frase no pool geral (dedup; teto de 40). */
    async addGeneralPhrase(group, phrase) {
      const text = String(phrase || '').trim();
      if (!text) return;
      await this._addToBucket(group, '__geral__', text, 40);
    },

    async removeGeneralPhrase(group, phrase) {
      await this._removeFromBucket(group, '__geral__', phrase);
    },

    /** Move uma frase da categoria do produto para o pool geral. */
    async promoteToGeneral(group, produto, phrase) {
      await this.addGeneralPhrase(group, phrase);
      await this.removePhrase(group, produto, phrase);
    },

    /** Inverso de promover: tira do pool geral e devolve à categoria do produto. */
    async demoteToCategory(group, produto, phrase) {
      await this.addPhrase(group, produto, phrase);
      await this.removeGeneralPhrase(group, phrase);
    },

    /** Busca frases por texto em TODOS os baldes do grupo (categorias + gerais).
     *  Útil p/ achar frase de marca (ex.: "adidas") que ficou espalhada. */
    async searchPhrases(group, query) {
      const q = String(query || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (!q) return [];
      const bank = await this.get('phraseBank', {});
      const grp = bank[group] || {};
      const seen = new Set();
      const out = [];
      for (const key of Object.keys(grp)) {
        for (const p of (grp[key] || [])) {
          const np = String(p).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
          const dedup = String(p).trim().toLowerCase();
          if (np.includes(q) && !seen.has(dedup)) { seen.add(dedup); out.push(p); }
        }
      }
      return out.slice(0, 30);
    },

    // Helpers internos do phraseBank.
    async _addToBucket(group, key, text, cap) {
      const bank = await this.get('phraseBank', {});
      bank[group] = bank[group] || {};
      bank[group][key] = bank[group][key] || [];
      const same = s => s.trim().toLowerCase();
      if (bank[group][key].some(p => same(p) === same(text))) return;
      bank[group][key].unshift(text);
      bank[group][key] = bank[group][key].slice(0, cap);
      await this.set('phraseBank', bank);
    },
    async _removeFromBucket(group, key, phrase) {
      const bank = await this.get('phraseBank', {});
      if (!bank[group] || !bank[group][key]) return;
      const same = s => s.trim().toLowerCase();
      bank[group][key] = bank[group][key].filter(p => same(p) !== same(phrase));
      await this.set('phraseBank', bank);
    },

    // ── Frases A REVISAR (capturadas do garimpo) ──────────────────────────
    // Estrutura espelha o phraseBank (por categoria), em storage separado.
    // Viram oficiais só quando aprovadas (não poluem as sugestões direto).
    async getReviewPhrases(group, produto) {
      const key = phraseKey(produto);
      const bank = await this.get('phraseReview', {});
      return ((bank[group] && bank[group][key]) || []).slice();
    },

    async addReviewPhrase(group, produto, phrase) {
      const text = String(phrase || '').trim();
      if (!text || text.length < 6) return;
      const key = phraseKey(produto);
      const same = s => s.trim().toLowerCase();
      // Não duplicar se já é oficial na categoria.
      const approved = await this.getPhrases(group, produto);
      if (approved.some(p => same(p) === same(text))) return;
      const bank = await this.get('phraseReview', {});
      bank[group] = bank[group] || {};
      bank[group][key] = bank[group][key] || [];
      if (bank[group][key].some(p => same(p) === same(text))) return;
      bank[group][key].unshift(text);
      bank[group][key] = bank[group][key].slice(0, 30);
      await this.set('phraseReview', bank);
    },

    async removeReviewPhrase(group, produto, phrase) {
      const key = phraseKey(produto);
      const bank = await this.get('phraseReview', {});
      if (!bank[group] || !bank[group][key]) return;
      const same = s => s.trim().toLowerCase();
      bank[group][key] = bank[group][key].filter(p => same(p) !== same(phrase));
      await this.set('phraseReview', bank);
    },

    /** Aprova uma frase a-revisar → vira oficial da categoria. */
    async approveReviewPhrase(group, produto, phrase) {
      await this.addPhrase(group, produto, phrase);
      await this.removeReviewPhrase(group, produto, phrase);
    },

    // ── reviewQueue ───────────────────────────────────────────────────────

    async getQueue() {
      return this.get('reviewQueue', []);
    },

    /** Adiciona candidato à fila (sem duplicar: mesmo productId já na fila é ignorado). */
    async enqueue(candidato) {
      const queue = await this.getQueue();
      const id = this.productId(candidato);
      if (id && queue.some(c => this.productId(c) === id)) return false;
      if (!candidato.addedAt) candidato.addedAt = Date.now(); // recência p/ ordenação
      queue.push(candidato);
      await this.set('reviewQueue', queue);
      return true;
    },

    /** Remove candidato da fila pelo productId. */
    async dequeue(candidato) {
      const id = this.productId(candidato);
      if (!id) return;
      const queue = await this.getQueue();
      await this.set('reviewQueue', queue.filter(c => this.productId(c) !== id));
    },

    /** Remove todos os candidatos da fila. */
    async clearQueue() {
      await this.set('reviewQueue', []);
    },

    /** Remove candidatos inválidos (sem nome) da fila. Retorna quantos removeu. */
    async pruneInvalid() {
      const queue = await this.getQueue();
      const valid = queue.filter(c => c.name && String(c.name).trim());
      if (valid.length !== queue.length) await this.set('reviewQueue', valid);
      return queue.length - valid.length;
    },

    /** Atualiza um candidato na fila (ex: trocar grupo). */
    async updateInQueue(candidato) {
      const id = this.productId(candidato);
      if (!id) return;
      const queue = await this.getQueue();
      const idx = queue.findIndex(c => this.productId(c) === id);
      if (idx >= 0) {
        queue[idx] = candidato;
        await this.set('reviewQueue', queue);
      }
    },

    /**
     * Marca o item como APROVADO por um grupo, SEM tirá-lo da fila (você descarta
     * na mão depois de postar). Acumula os grupos em `c.sent` (permite aprovar o
     * mesmo produto pros dois). `cross` = foi aberto no Chrome do outro perfil.
     */
    async markSent(produto, grupo, cross) {
      const id = this.productId(produto);
      if (!id) return;
      const queue = await this.getQueue();
      const idx = queue.findIndex(c => this.productId(c) === id);
      if (idx < 0) return; // não está na fila deste perfil (ex.: destino do cross-profile)
      const c = queue[idx];
      c.sent = Array.isArray(c.sent) ? c.sent : [];
      const ex = c.sent.find(s => s.g === grupo);
      if (ex) ex.cross = cross; else c.sent.push({ g: grupo, cross });
      await this.set('reviewQueue', queue);
    },

    // ── Cofre de cupons (garimpo) ─────────────────────────────────────────

    /** Idade máxima de um cupom no cofre (7 dias — a maioria expira rápido). */
    COUPON_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000,

    /**
     * Salva cupons vistos no garimpo. Dedupe por marketplace+label; re-ver um
     * cupom renova o seenAt (continua "fresco"). Poda os com mais de 7 dias.
     * items: [{ code?, pct?, generic, label }], marketplace: 'mercadolivre'|...
     */
    async saveCoupons(items, marketplace) {
      if (!Array.isArray(items) || !items.length) return 0;
      const vault = await this.get('couponVault', []);
      const now = Date.now();
      let added = 0;
      for (const it of items) {
        if (!it || !it.label) continue;
        const key = `${marketplace}|${it.label.toUpperCase()}`;
        const ex = vault.find(v => v.key === key);
        if (ex) { ex.seenAt = now; ex.pct = it.pct ?? ex.pct; }
        else { vault.push({ key, marketplace, code: it.code || null, pct: it.pct ?? null, generic: !!it.generic, label: it.label, seenAt: now }); added++; }
      }
      const fresh = vault.filter(v => now - v.seenAt < this.COUPON_MAX_AGE_MS);
      await this.set('couponVault', fresh);
      return added;
    },

    /**
     * Junta o cofre local com o arquivo compartilhado entre os perfis do Chrome.
     * O garimpo roda só no Chrome da Kate, mas os cupons servem para comprar em
     * qualquer perfil — e cada perfil tem seu próprio chrome.storage. O ponto
     * comum é um arquivo em disco, escrito pelo mesmo native host do
     * cross-profile (%LOCALAPPDATA%\PromosExtension\coupons.json).
     * Devolve { ok, added } — ok:false quando o programa-ponte não respondeu.
     */
    async syncCouponsShared() {
      const call = (mode, data) => new Promise(resolve => {
        chrome.runtime.sendMessage(
          { action: 'sharedFile', mode, file: 'coupons.json', data },
          res => resolve(chrome.runtime.lastError ? { ok: false } : res)
        );
      });

      const res = await call('read');
      if (!res || !res.ok) return { ok: false, added: 0 };

      let remoto = [];
      try { remoto = JSON.parse(res.data || '[]'); } catch (_) { remoto = []; }
      if (!Array.isArray(remoto)) remoto = [];

      const local = await this.get('couponVault', []);
      const now = Date.now();
      const porChave = new Map();
      for (const c of [...remoto, ...local]) {
        if (!c || !c.key) continue;
        if (now - c.seenAt >= this.COUPON_MAX_AGE_MS) continue; // já expirou
        const ex = porChave.get(c.key);
        if (!ex || c.seenAt > ex.seenAt) porChave.set(c.key, c); // fica o mais recente
      }
      const merged = [...porChave.values()];
      const added = merged.length - local.filter(c => now - c.seenAt < this.COUPON_MAX_AGE_MS).length;

      await this.set('couponVault', merged);
      await call('write', JSON.stringify(merged));
      return { ok: true, added: Math.max(0, added) };
    },

    /** Cupons frescos (<7 dias) de um marketplace (ou todos), recentes primeiro. */
    async getCoupons(marketplace) {
      const vault = await this.get('couponVault', []);
      const now = Date.now();
      return vault
        .filter(v => now - v.seenAt < this.COUPON_MAX_AGE_MS)
        .filter(v => !marketplace || v.marketplace === marketplace)
        .sort((a, b) => b.seenAt - a.seenAt);
    },

    // ── rankedIds ─────────────────────────────────────────────────────────

    /** Retorna o conjunto de IDs canônicos que estão em algum ranking. */
    async getRankedIds() {
      return this.get('rankedIds', []);
    },

    /** Salva IDs rankeados (acumula sobre os existentes — não apaga histórico). */
    async saveRankedIds(newIds) {
      const existing = await this.getRankedIds();
      const merged = Array.from(new Set([...existing, ...newIds]));
      await this.set('rankedIds', merged);
      return merged.length;
    },

    /** Verifica se um produto está em algum ranking salvo. */
    async isProductRanked(produto) {
      const id = this.productId(produto);
      if (!id) return false;
      const ids = await this.getRankedIds();
      return ids.includes(id);
    },

    // ── commissionStats ───────────────────────────────────────────────────

    async getCommissionStats() {
      return this.get('commissionStats', {});
    },

    async setCommissionStats(stats) {
      await this.set('commissionStats', stats);
    },

    // ── Util exposto ──────────────────────────────────────────────────────
    normalizeUrl,
  };

  /**
   * Copia só os campos necessários para reabrir/re-aprovar um produto depois.
   * Sem imagem (data URL pesada) — a página do produto fornece a foto ao reabrir.
   */
  function slimCandidate(c, grupo) {
    const keep = ['site', 'marketplace', 'name', 'priceDe', 'pricePor', 'discount',
      'coupon', 'category', 'asin', 'mlbId', 'shopId', 'itemId',
      'url', 'productUrl', 'rawUrl', 'msgTime', 'origem'];
    const o = {};
    for (const k of keep) if (c[k] != null) o[k] = c[k];
    if (grupo) o.grupo = grupo;
    return o;
  }

  /**
   * Chave do banco de frases para um produto: palavra-chave canônica do nome
   * (1º termo do grupo casado em KEYWORD_EMOJI) → senão a categoria. Null se
   * não der pra classificar. Mesma lógica de classificação do emoji.
   */
  function phraseKey(produto) {
    const name = String(produto.name || produto.nome || '')
      .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const list = (typeof window !== 'undefined' && window.PromosConfig &&
                  window.PromosConfig.KEYWORD_EMOJI) || [];
    for (const [keywords] of list) {
      for (const kw of keywords) {
        if (name.includes(kw)) return 'kw:' + keywords[0];
      }
    }
    if (produto.category) return 'cat:' + produto.category;
    // Produto não classificável: cai num balde genérico — NUNCA no pool geral.
    // O global é exclusivo do botão de promover (🌐), nunca automático.
    return 'cat:outros';
  }

  /**
   * Normaliza URL de produto: remove parâmetros de afiliado/tracking e
   * fragmentos, mantendo só o caminho canônico do produto.
   */
  function normalizeUrl(url) {
    let u;
    try { u = new URL(url); } catch (_) { return String(url).trim(); }

    // Amazon: /dp/ASIN é o caminho canônico
    const asinMatch = u.pathname.match(/\/dp\/([A-Z0-9]{10})/);
    if (asinMatch) return `https://www.amazon.com.br/dp/${asinMatch[1]}`;

    // ML: MLB-123... no path
    const mlbMatch = u.href.match(/\b(MLB-?\d+)/i);
    if (mlbMatch && u.hostname.includes('mercadolivre')) {
      return `https://produto.mercadolivre.com.br/${mlbMatch[1].toUpperCase().replace('MLB', 'MLB-').replace('--', '-')}`;
    }

    // Shopee: -i.SHOPID.ITEMID no path
    const shopeeMatch = u.pathname.match(/[.-]i\.(\d+)\.(\d+)/);
    if (shopeeMatch && u.hostname.includes('shopee')) {
      return `https://shopee.com.br/product-i.${shopeeMatch[1]}.${shopeeMatch[2]}`;
    }

    // Genérico: remove query e hash (onde vivem os parâmetros de tracking)
    return `${u.origin}${u.pathname}`;
  }

  /** Hash simples e estável (djb2) para chaves de URL. */
  function hashString(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    }
    return h.toString(36);
  }
})();
