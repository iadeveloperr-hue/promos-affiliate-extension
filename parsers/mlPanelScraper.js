(function () {
  'use strict';

  /**
   * PromosMlPanelScraper — coleta dados de comissão do painel de afiliados do
   * Mercado Livre (painel.mercadolivre.com.br) diretamente do DOM, já que o
   * painel não oferece exportação CSV.
   *
   * scrape() → { records, rawRows, avisos }
   *   records: array no formato normalizado do PromosCommissionParser
   *   rawRows: linhas brutas capturadas (para debug)
   *   avisos:  mensagens de aviso (ex: "paginação detectada")
   *
   * Compatível com as tabelas do painel ML (junho 2026).
   * Se o layout mudar e nenhum dado for encontrado, retorna avisos com
   * instruções para reportar ao desenvolvedor.
   */

  globalThis.PromosMlPanelScraper = {

    scrape() {
      const avisos = [];

      // ── Tenta ler tabelas da página ────────────────────────────────────────
      const tables = Array.from(document.querySelectorAll('table'));
      let records = [];
      let rawRows = [];

      if (tables.length) {
        for (const table of tables) {
          const { recs, rows } = parseTable(table);
          if (recs.length) {
            records.push(...recs);
            rawRows.push(...rows);
          }
        }
      }

      // Fallback: tenta linhas de cards/lista (layout sem <table>)
      if (!records.length) {
        const { recs, rows } = parseCardLayout();
        records = recs;
        rawRows = rows;
      }

      if (!records.length) {
        avisos.push(
          'Nenhum dado encontrado nesta página. ' +
          'Navegue para a seção de relatórios/comissões do painel e tente novamente. ' +
          'Se o layout mudou, reporte em github.com/iadeveloperr-hue/promos-kate.'
        );
      }

      // Detecta paginação real (ignora o .andes-pagination do dashboard/menu)
      const paginationEl = document.querySelector(
        '[class*="pagination"], [class*="pagina"], nav[aria-label*="page" i], .andes-pagination'
      );
      // O dashboard usa .andes-pagination para menus laterais — só avisa se
      // a paginação estiver dentro de uma tabela/lista de dados
      const inTable = paginationEl && (
        paginationEl.closest('table, [class*="report"], [class*="earning"], [class*="comissao"]') ||
        document.querySelector('table') !== null && paginationEl
      );
      // Avisa apenas se a paginação está associada a dados reais (não ao chrome do painel)
      const looksLikeDataPagination = paginationEl && !location.pathname.startsWith('/afiliados/dashboard');
      if (looksLikeDataPagination && records.length) {
        avisos.push('Paginação detectada — apenas a página atual foi capturada. Repita para cada página.');
      }

      return { records, rawRows, avisos };
    },
  };

  // ── Parsers internos ────────────────────────────────────────────────────────

  function parseTable(table) {
    const headers = Array.from(table.querySelectorAll('th')).map(th =>
      th.textContent.trim().toLowerCase()
    );
    if (!headers.length) {
      // Tenta primeira linha como header
      const firstRow = table.querySelector('tr');
      if (firstRow) {
        Array.from(firstRow.querySelectorAll('td')).forEach(td =>
          headers.push(td.textContent.trim().toLowerCase())
        );
      }
    }

    if (!headers.length) return { recs: [], rows: [] };

    const col = detectColumns(headers);
    if (col.produto === -1 && col.comissao === -1) return { recs: [], rows: [] };

    const rows = Array.from(table.querySelectorAll('tr')).slice(1); // pula header
    const recs = [];
    const rawRows = [];

    for (const tr of rows) {
      const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
      if (!cells.length) continue;
      rawRows.push(cells);

      const rec = buildRecord(cells, col);
      if (rec) recs.push(rec);
    }

    return { recs, rows: rawRows };
  }

  function parseCardLayout() {
    const recs = [];
    const rawRows = [];

    // Tenta seletores comuns do painel ML (podem mudar com redesign)
    const rows = document.querySelectorAll(
      '[class*="row--"], [class*="item--"], [class*="product-row"], ' +
      '[class*="report-row"], [class*="earning-row"], [class*="comissao"]'
    );

    for (const row of rows) {
      const text = row.innerText || row.textContent || '';
      if (!text.trim()) continue;

      // Tenta extrair valores pelo padrão do texto
      const comissao = extractMoney(text);
      const nome     = extractProductName(row);
      if (!comissao && !nome) continue;

      rawRows.push([text.trim()]);
      recs.push({
        produto:       nome || '(sem nome)',
        categoria:     normalizeCategory(nome || ''),
        marketplace:   'mercadolivre',
        qtdVendas:     extractQtd(text) ?? 1,
        receita:       extractMoney(text, 'receita') ?? 0,
        comissaoTotal: comissao ?? 0,
        periodo:       extractPeriodo(text) || null,
      });
    }

    return { recs, rows: rawRows };
  }

  function detectColumns(headers) {
    const patterns = {
      produto:   /produto|t[íi]tulo|item|nome|descri/i,
      categoria: /categoria|category/i,
      comissao:  /comiss|ganhos|earnings|receita de an/i,
      qtd:       /qtde?|venda|pedido|unidad/i,
      receita:   /receita|faturamento|valor.*total|gmv/i,
      periodo:   /per[íi]odo|data|m[êe]s/i,
    };
    const col = {};
    for (const [key, pat] of Object.entries(patterns)) {
      col[key] = headers.findIndex(h => pat.test(h));
    }
    return col;
  }

  function buildRecord(cells, col) {
    const get = i => (i >= 0 && i < cells.length ? cells[i] : '');
    const comissao = parseMoney(get(col.comissao));
    const produto  = get(col.produto);
    if (!produto && !comissao) return null;

    return {
      produto:       produto || '(sem nome)',
      categoria:     normalizeCategory(get(col.categoria) || produto || ''),
      marketplace:   'mercadolivre',
      qtdVendas:     parseIntSafe(get(col.qtd)) ?? 1,
      receita:       parseMoney(get(col.receita)) ?? 0,
      comissaoTotal: comissao ?? 0,
      periodo:       get(col.periodo) || null,
    };
  }

  // ── Helpers de extração ─────────────────────────────────────────────────────

  function extractProductName(el) {
    // Tenta seletores que costumam conter o nome do produto no painel ML
    const nameEl = el.querySelector(
      '[class*="title"], [class*="name"], [class*="product"], strong, b'
    );
    return nameEl ? nameEl.textContent.trim() : null;
  }

  function extractMoney(text) {
    // Procura o padrão "R$ X" ou "R$X" no texto
    const m = text.match(/R\$\s*[\d.,]+/);
    if (!m) return null;
    return parseMoney(m[0]);
  }

  function extractQtd(text) {
    const m = text.match(/\b(\d+)\s*(venda|pedido|unidade|item)/i);
    return m ? parseInt(m[1], 10) : null;
  }

  function extractPeriodo(text) {
    const m = text.match(/\b(20\d{2}[-/]\d{2}(?:[-/]\d{2})?|\d{2}\/\d{4})\b/);
    return m ? m[0] : null;
  }

  function parseMoney(str) {
    if (!str) return null;
    const s = String(str).replace(/[^\d,.-]/g, '');
    if (!s) return null;
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

  const CATEGORY_KEYWORDS = {
    beleza:      /beleza|beauty|maquiagem|cosm[ée]tic|perfum|skin/i,
    cabelo:      /cabelo|hair/i,
    cozinha:     /cozinha|kitchen|panela|air.*fryer|cook/i,
    casa:        /casa|home|lar |dom[ée]stic|limpeza/i,
    moda:        /moda|fashion|roupa|vestu|feminino|masculino/i,
    calcados:    /cal[çc]ado|t[êe]nis|sapato|shoe|sneaker/i,
    fitness:     /fitness|esporte|sport|gym|academia|treino|muscula/i,
    suplemento:  /suplemento|whey|creatina|protein|vitamin|nutri/i,
    decoracao:   /decora|m[óo]vel|furniture/i,
    eletronicos: /eletr[ôo]nic|celular|phone|inform[áa]tica|tv|[áa]udio/i,
    infantil:    /infantil|beb[êe]|baby|crian[çc]a|brinquedo/i,
    pet:         /pet|cachorro|gato|animal/i,
  };

  function normalizeCategory(text) {
    for (const [cat, pat] of Object.entries(CATEGORY_KEYWORDS)) {
      if (pat.test(text)) return cat;
    }
    return 'outros';
  }
})();
