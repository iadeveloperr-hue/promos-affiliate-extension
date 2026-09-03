(function () {
  'use strict';

  /**
   * PromosCommissionParser — ingere relatórios CSV exportados dos painéis de
   * afiliado (Amazon Associates, Mercado Livre, Shopee) e agrega em
   * commissionStats.
   *
   * Schema normalizado por linha:
   *   { produto, categoria, marketplace, qtdVendas, receita, comissaoTotal, periodo }
   *
   * commissionStats (acumulado, não sobrescreve — capta sazonalidade):
   *   {
   *     categorias: { [categoria]: { qtdVendas, receita, comissaoTotal, registros } },
   *     produtos:   { [produto]:   { categoria, marketplace, qtdVendas, comissaoTotal } },
   *     importacoes: [ { marketplace, linhas, periodo, importadoEm } ],
   *   }
   *
   * Detecção de colunas por palavra-chave: os painéis usam nomes diferentes e
   * mudam com o tempo. Ajustar COLUMN_PATTERNS quando um relatório real falhar.
   */

  const COLUMN_PATTERNS = {
    produto:   /produto|product|item.*(nome|name|title)|nome.*item|t[íi]tulo|descri[çc][ãa]o|name/i,
    categoria: /categoria|category/i,
    comissao:  /comiss|ganhos|earnings|income|renda|bounty|receita de an[úu]ncios/i,
    qtd:       /qtde?|quantidade|quantity|itens.*enviado|items?.*shipped|vendas|orders|pedidos|cliques convertidos/i,
    receita:   /receita|revenue|gmv|valor.*venda|pre[çc]o.*total|vendas.*r\$|faturamento/i,
    periodo:   /per[íi]odo|period|data|date|m[êe]s|month/i,
  };

  // Palavras nas categorias dos painéis → nossas categorias (EMOJI_MAP keys)
  const CATEGORY_KEYWORDS = {
    beleza:      /beleza|beauty|maquiagem|makeup|cosm[ée]tic|perfum|skin/i,
    cabelo:      /cabelo|hair/i,
    cozinha:     /cozinha|kitchen|culin[áa]ri|panela|cook/i,
    casa:        /casa|home|lar |dom[ée]stic|limpeza|organiza/i,
    moda:        /moda|fashion|roupa|vestu[áa]rio|feminino|masculino|apparel/i,
    calcados:    /cal[çc]ado|t[êe]nis|sapato|shoe|sneaker/i,
    fitness:     /fitness|esporte|sport|gym|academia|treino|muscula/i,
    suplemento:  /suplemento|supplement|whey|creatina|protein|vitamin|nutri/i,
    decoracao:   /decora|decor|m[óo]vei|furniture/i,
    eletronicos: /eletr[ôo]nic|electronic|celular|phone|inform[áa]tica|computer|games?|tv|[áa]udio/i,
    infantil:    /infantil|beb[êe]|baby|crian[çc]a|kids|brinquedo|toy/i,
    pet:         /pet|cachorro|gato|animal/i,
  };

  globalThis.PromosCommissionParser = {
    /**
     * Faz o pipeline completo: CSV bruto → linhas normalizadas.
     * marketplace: 'amazon' | 'mercadolivre' | 'shopee' (informado pelo usuário
     * na importação — mais confiável que detectar pelo conteúdo).
     */
    parse(csvText, marketplace) {
      const rows = parseCSV(csvText);
      if (rows.length < 2) return [];

      const header = rows[0].map(h => String(h || '').trim());
      const col = mapColumns(header);
      if (col.produto === -1 && col.comissao === -1) {
        throw new Error('Não reconheci as colunas do relatório. Cabeçalho: ' + header.join(' | '));
      }

      const records = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || r.every(c => !String(c || '').trim())) continue;

        const produto  = pick(r, col.produto);
        const comissao = parseMoney(pick(r, col.comissao));
        if (!produto && !comissao) continue;

        records.push({
          produto:       produto || '(sem nome)',
          categoria:     normalizeCategory(pick(r, col.categoria), produto),
          marketplace,
          qtdVendas:     parseIntSafe(pick(r, col.qtd)) ?? 1,
          receita:       parseMoney(pick(r, col.receita)) ?? 0,
          comissaoTotal: comissao ?? 0,
          periodo:       pick(r, col.periodo) || null,
        });
      }
      return records;
    },

    /**
     * Agrega registros normalizados em commissionStats (acumulando sobre o
     * existente — nunca sobrescreve histórico).
     */
    aggregate(records, existing) {
      const stats = existing && existing.categorias ? existing : {
        categorias: {}, produtos: {}, importacoes: [],
      };

      for (const rec of records) {
        const cat = rec.categoria || 'outros';
        const c = stats.categorias[cat] ||
          (stats.categorias[cat] = { qtdVendas: 0, receita: 0, comissaoTotal: 0, registros: 0 });
        c.qtdVendas     += rec.qtdVendas;
        c.receita       += rec.receita;
        c.comissaoTotal += rec.comissaoTotal;
        c.registros     += 1;

        const key = `${rec.marketplace}:${rec.produto}`.slice(0, 200);
        const p = stats.produtos[key] ||
          (stats.produtos[key] = { categoria: cat, marketplace: rec.marketplace, qtdVendas: 0, comissaoTotal: 0 });
        p.qtdVendas     += rec.qtdVendas;
        p.comissaoTotal += rec.comissaoTotal;
      }

      if (records.length) {
        stats.importacoes.push({
          marketplace: records[0].marketplace,
          linhas: records.length,
          periodo: records[0].periodo || null,
          importadoEm: new Date().toISOString(),
        });
      }
      return stats;
    },

    /** Pipeline completo: CSV → registros → agrega → retorna stats novo. */
    ingest(csvText, marketplace, existingStats) {
      const records = this.parse(csvText, marketplace);
      return { stats: this.aggregate(records, existingStats), linhas: records.length };
    },

    normalizeCategory, // exposto para testes/reuso
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** CSV robusto: aspas, vírgula ou ponto-e-vírgula, BOM, CRLF. */
  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    // Detecta delimitador pela primeira linha (fora de aspas)
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';

    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delim) {
        row.push(field); field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function mapColumns(header) {
    const col = {};
    for (const [key, pattern] of Object.entries(COLUMN_PATTERNS)) {
      col[key] = header.findIndex(h => pattern.test(h));
    }
    return col;
  }

  function pick(row, idx) {
    return idx >= 0 ? String(row[idx] ?? '').trim() : '';
  }

  /** "R$ 1.234,56" | "1234.56" | "1.234,56" → número */
  function parseMoney(str) {
    if (!str) return null;
    const s = String(str).replace(/[^\d,.-]/g, '');
    if (!s) return null;
    // Formato BR (vírgula decimal) se a vírgula vem depois do último ponto
    const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
    const n = lastComma > lastDot
      ? parseFloat(s.replace(/\./g, '').replace(',', '.'))
      : parseFloat(s.replace(/,/g, ''));
    return isNaN(n) ? null : n;
  }

  function parseIntSafe(str) {
    const n = parseInt(String(str || '').replace(/[^\d-]/g, ''), 10);
    return isNaN(n) ? null : n;
  }

  /** Mapeia categoria do painel (ou o nome do produto) para nossas categorias. */
  function normalizeCategory(rawCategory, productName) {
    for (const source of [rawCategory, productName]) {
      if (!source) continue;
      for (const [cat, pattern] of Object.entries(CATEGORY_KEYWORDS)) {
        if (pattern.test(source)) return cat;
      }
    }
    return 'outros';
  }
})();
