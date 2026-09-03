// Fila de Revisão — painel com candidatos do Radar/Garimpo aguardando decisão.
// Exposto como global (content scripts não suportam ES modules).
window.PromosQueue = { showQueue, seedMock };

// var (não let): o script é re-injetado a cada uso e let no top-level
// lançaria "Identifier already declared" na segunda injeção
var currentFilter = 'todos';
var currentSort = 'recentes'; // padrão: mais recentes primeiro

async function showQueue() {
  removeQueue();
  window.PromosOverlay?.removeOverlay?.();

  const backdrop = document.createElement('div');
  backdrop.id = 'promos-queue-overlay';
  backdrop.addEventListener('click', e => { if (e.target === backdrop) removeQueue(); });

  const panel = document.createElement('div');
  panel.id = 'promos-queue-panel';

  // ── Header ───────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'promos-header';
  header.innerHTML = '<span class="promos-title">📋 Fila de Revisão</span>';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'promos-close';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', removeQueue);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // ── Filtro por grupo ─────────────────────────────────────────────────────
  const filterRow = document.createElement('div');
  filterRow.className = 'promos-queue-filters';
  for (const f of ['todos', 'kate', 'musculosas', 'indefinido']) {
    const btn = document.createElement('button');
    btn.className = `promos-btn promos-btn-sm ${f === currentFilter ? 'promos-btn-group-active' : 'promos-btn-group'}`;
    btn.textContent = f === 'todos' ? 'Todos' : groupLabel(f);
    btn.addEventListener('click', () => {
      currentFilter = f;
      renderCards(panel);
      filterRow.querySelectorAll('button').forEach(b => {
        b.className = `promos-btn promos-btn-sm ${b === btn ? 'promos-btn-group-active' : 'promos-btn-group'}`;
      });
    });
    filterRow.appendChild(btn);
  }
  panel.appendChild(filterRow);

  // ── Barra de ações globais ───────────────────────────────────────────────
  const actionsBar = document.createElement('div');
  actionsBar.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;gap:6px;padding:0 4px 4px';

  // Ordenar por
  const sortLabel = document.createElement('span');
  sortLabel.textContent = 'Ordenar:';
  sortLabel.style.cssText = 'font-size:12px;color:#666;margin-right:auto';
  actionsBar.appendChild(sortLabel);

  const sortSel = document.createElement('select');
  sortSel.className = 'promos-queue-group-select';
  for (const [v, t] of [
    ['recentes',  '🕐 Garimpados agora'],
    ['msg',       '💬 Mensagem mais nova'],
    ['antigos',   '🕐 Garimpados há mais tempo'],
    ['score',     '⭐ Maior score'],
    ['desconto',  '🏷️ Maior desconto'],
    ['precoAsc',  '💰 Menor preço'],
  ]) {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = t;
    if (v === currentSort) opt.selected = true;
    sortSel.appendChild(opt);
  }
  sortSel.addEventListener('change', () => {
    currentSort = sortSel.value;
    renderCards(panel);
  });
  actionsBar.appendChild(sortSel);

  const btnClearHist = document.createElement('button');
  btnClearHist.className = 'promos-btn promos-btn-sm promos-btn-secondary';
  btnClearHist.style.marginRight = '6px';
  btnClearHist.textContent = '♻️ Limpar histórico';
  btnClearHist.title = 'Apaga o histórico de produtos já postados (reverte a marcação de "duplicado")';
  btnClearHist.addEventListener('click', async () => {
    if (!confirm('Limpar o histórico de postados? Produtos antigos voltarão a ser aceitos no garimpo.')) return;
    await window.PromosStore.clearHistory();
    alert('✅ Histórico limpo. Rode o garimpo novamente para recapturar os itens.');
  });
  actionsBar.appendChild(btnClearHist);

  const btnHist = document.createElement('button');
  btnHist.className = 'promos-btn promos-btn-sm promos-btn-secondary';
  btnHist.textContent = '📜 Histórico';
  btnHist.title = 'Ver posts já aprovados/postados';
  let histVisible = false;
  btnHist.addEventListener('click', async () => {
    histVisible = !histVisible;
    await renderHistory(panel, histVisible);
    btnHist.style.background = histVisible ? '#e8f0fe' : '';
  });
  actionsBar.appendChild(btnHist);

  const btnClear = document.createElement('button');
  btnClear.className = 'promos-btn promos-btn-sm promos-btn-secondary';
  btnClear.textContent = '🗑️ Limpar lista';
  btnClear.addEventListener('click', async () => {
    if (!confirm('Limpar toda a fila? Esta ação não pode ser desfeita.')) return;
    await window.PromosStore.clearQueue();
    renderCards(panel);
  });
  actionsBar.appendChild(btnClear);
  panel.appendChild(actionsBar);

  // ── Lista de cards ───────────────────────────────────────────────────────
  const list = document.createElement('div');
  list.className = 'promos-queue-list';
  panel.appendChild(list);

  // ── Importar relatório de comissões (Passo 6.1) ──────────────────────────
  panel.appendChild(buildImportRow());

  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  await renderCards(panel);
}

function buildImportRow() {
  const row = document.createElement('div');
  row.className = 'promos-queue-import';

  const label = document.createElement('span');
  label.className = 'promos-emoji-label';
  label.textContent = '📊 Importar relatório (CSV):';
  row.appendChild(label);

  const sel = document.createElement('select');
  sel.className = 'promos-queue-group-select';
  for (const [v, t] of [['amazon', 'Amazon'], ['mercadolivre', 'Mercado Livre'], ['shopee', 'Shopee']]) {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = t;
    sel.appendChild(opt);
  }
  row.appendChild(sel);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.csv,text/csv';
  fileInput.style.display = 'none';

  const btn = document.createElement('button');
  btn.className = 'promos-btn promos-btn-sm promos-btn-secondary';
  btn.textContent = 'Escolher arquivo…';
  btn.addEventListener('click', () => fileInput.click());

  const status = document.createElement('span');
  status.className = 'promos-queue-import-status';

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const existing = await window.PromosStore.getCommissionStats();
      const { stats, linhas } = window.PromosCommissionParser.ingest(text, sel.value, existing);
      await window.PromosStore.setCommissionStats(stats);
      const nCats = Object.keys(stats.categorias).length;
      status.textContent = `✅ ${linhas} linhas importadas (${nCats} categorias no total)`;
      status.style.color = '#1a7f37';
    } catch (err) {
      status.textContent = `❌ ${err.message}`;
      status.style.color = '#cf222e';
    }
    fileInput.value = '';
  });

  row.appendChild(btn);
  row.appendChild(fileInput);
  row.appendChild(status);
  return row;
}

function removeQueue() {
  document.getElementById('promos-queue-overlay')?.remove();
}

async function renderCards(panel) {
  const list = panel.querySelector('.promos-queue-list');
  list.innerHTML = '';

  // Limpa candidatos inválidos (sem nome) acumulados de runs anteriores
  await window.PromosStore.pruneInvalid();

  let queue = await window.PromosStore.getQueue();
  sortQueue(queue, currentSort);
  if (currentFilter !== 'todos') {
    queue = queue.filter(c => (c.grupo || 'indefinido') === currentFilter);
  }

  if (!queue.length) {
    const empty = document.createElement('div');
    empty.className = 'promos-queue-empty';
    empty.textContent = 'Fila vazia. O Radar e o Garimpo vão popular aqui.';
    list.appendChild(empty);
    return;
  }

  for (const cand of queue) {
    list.appendChild(buildCard(cand, panel));
  }
}

function buildCard(c, panel) {
  const card = document.createElement('div');
  card.className = 'promos-queue-card';

  // Thumbnail — a CSP do WhatsApp Web bloqueia img externo, então pede ao SW
  // para buscar e devolver como data: URL.
  if (c.imageUrl) {
    const img = document.createElement('img');
    img.className = 'promos-queue-thumb';
    img.alt = '';
    card.appendChild(img);
    loadImageViaWorker(c.imageUrl, img, card);
  } else {
    const ph = document.createElement('div');
    ph.className = 'promos-queue-thumb promos-thumb-placeholder';
    ph.textContent = 'sem foto';
    card.appendChild(ph);
  }

  // Corpo
  const body = document.createElement('div');
  body.className = 'promos-queue-body';

  const name = document.createElement('div');
  name.className = 'promos-queue-name';
  name.textContent = c.name || '(sem nome)';
  body.appendChild(name);

  const prices = document.createElement('div');
  prices.className = 'promos-queue-prices';
  const deValido = c.priceDe && (!c.pricePor || c.priceDe > c.pricePor);
  const de  = deValido   ? `<s>R$ ${fmtBR(c.priceDe)}</s> ` : '';
  const pct = (deValido && c.discount) ? `<b class="promos-queue-pct">-${c.discount}%</b> ` : '';
  const por = c.pricePor ? `<b>R$ ${fmtBR(c.pricePor)}</b>` : '';
  const ajuste = c.deAjustado ? ` <span class="promos-queue-de-ajuste" title="O &quot;De&quot; foi ajustado para o preço de tabela real do Mercado Livre (o do grupo de origem estava inflado).">✓ De real</span>` : '';
  prices.innerHTML = `${de}${pct}${por}${ajuste}`;
  body.appendChild(prices);

  // Cupom
  if (c.coupon) {
    const couponEl = document.createElement('div');
    couponEl.className = 'promos-queue-meta';
    couponEl.innerHTML = `🎟️ Cupom: <b>${c.coupon}</b>`;
    body.appendChild(couponEl);
  }

  // Score + badges
  const meta = document.createElement('div');
  meta.className = 'promos-queue-meta';
  const bd = c.breakdown || {};
  const scoreEl = document.createElement('span');
  scoreEl.className = 'promos-queue-score';
  scoreEl.textContent = `⭐ ${c.score ?? '?'}`;
  scoreEl.title = `desconto: ${bd.desconto ?? '-'} | categoria: ${bd.categoria ?? '-'} | ranking: ${bd.ranking ?? '-'} | ticket: ${bd.ticket ?? '-'} | comissão est.: R$ ${bd.comissaoEstimadaBRL ?? '-'}`;
  meta.appendChild(scoreEl);

  // Badge de marketplace
  const MARKET_BADGE = {
    amazon:       { label: '🟠 Amazon',        color: '#ff9900', bg: '#fff3e0' },
    mercadolivre: { label: '🟡 Mercado Livre', color: '#333',    bg: '#fffde7' },
    shopee:       { label: '🟠 Shopee',        color: '#ee4d2d', bg: '#fff3f0' },
  };
  const site = c.site || c.marketplace || '';
  const mbDef = MARKET_BADGE[site];
  const marketBadge = document.createElement('span');
  marketBadge.style.cssText = `font-size:11px;font-weight:600;padding:2px 7px;border-radius:10px;white-space:nowrap;` +
    (mbDef ? `color:${mbDef.color};background:${mbDef.bg};` : 'color:#888;background:#f5f5f5;');
  marketBadge.textContent = mbDef ? mbDef.label : (site ? `🛒 ${site}` : '❓ marketplace?');
  marketBadge.title = c.productUrl || c.rawUrl || '';
  meta.appendChild(marketBadge);

  const origem = document.createElement('span');
  origem.className = 'promos-queue-origin';
  origem.textContent = c.origem || '?';
  meta.appendChild(origem);

  if (c.msgTime) {
    const timeEl = document.createElement('span');
    timeEl.className = 'promos-queue-origin';
    timeEl.textContent = `💬 ${c.msgTime}`;
    timeEl.title = 'Horário em que a mensagem foi enviada no grupo';
    meta.appendChild(timeEl);
  }

  // Quando o item entrou na fila. Sem isso, a ordem "Garimpados agora" fica
  // sem explicação na tela (a data visível era só a da mensagem).
  if (c.addedAt) {
    const addedEl = document.createElement('span');
    addedEl.className = 'promos-queue-origin';
    addedEl.textContent = `🕐 garimpado ${humanAge(c.addedAt)}`;
    addedEl.title = new Date(c.addedAt).toLocaleString('pt-BR');
    meta.appendChild(addedEl);
  }

  if (c.flags?.descontoBaixoPotencialAlto) {
    const flag = document.createElement('span');
    flag.className = 'promos-queue-flag';
    flag.textContent = '⚡ desconto baixo, potencial alto';
    meta.appendChild(flag);
  }
  body.appendChild(meta);

  // Aviso de falha na última tentativa de aprovação (não saiu da fila).
  if (c.lastError) {
    const errEl = document.createElement('div');
    errEl.className = 'promos-queue-meta';
    errEl.style.cssText = 'color:#cf222e;font-weight:600;';
    errEl.textContent = `⚠️ Falhou: ${c.lastError} — tente aprovar de novo`;
    body.appendChild(errEl);
  }

  // Aprovado (Kate e/ou Musculosas): continua na fila até você postar e clicar
  // em 🗑️ Descartar. Suporta os dois grupos no mesmo item.
  const sent = Array.isArray(c.sent) ? c.sent : (c.sentTo ? [{ g: c.sentTo, cross: true }] : []);
  if (sent.length) {
    const sentEl = document.createElement('div');
    sentEl.className = 'promos-queue-meta';
    sentEl.style.cssText = 'color:#1a7f37;font-weight:600;';
    const parts = sent.map(s => groupLabel(s.g) + (s.cross ? ' (no outro Chrome)' : ''));
    sentEl.textContent = `✅ Aprovado: ${parts.join(', ')} — poste e clique em 🗑️ Descartar`;
    body.appendChild(sentEl);
  }

  // Grupo + ações
  const actions = document.createElement('div');
  actions.className = 'promos-queue-actions';

  const groupSel = document.createElement('select');
  groupSel.className = 'promos-queue-group-select';
  for (const g of ['indefinido', 'kate', 'musculosas']) {
    const opt = document.createElement('option');
    opt.value = g;
    opt.textContent = groupLabel(g);
    if ((c.grupo || 'indefinido') === g) opt.selected = true;
    groupSel.appendChild(opt);
  }
  groupSel.addEventListener('change', async () => {
    c.grupo = groupSel.value;
    await window.PromosStore.updateInQueue(c);
    // Evita reconstruir a lista inteira (que faz a página "subir" e perder a
    // posição). Se o card continua dentro do filtro atual, fica onde está; se
    // saiu (ex.: filtro "indefinido" e você escolheu Kate), remove só ele.
    const stillVisible = currentFilter === 'todos' || (c.grupo || 'indefinido') === currentFilter;
    if (!stillVisible) card.remove();
  });
  actions.appendChild(groupSel);

  const btnCopyLink = document.createElement('button');
  btnCopyLink.className = 'promos-btn promos-btn-sm promos-btn-secondary';
  btnCopyLink.textContent = '🔗 Link';
  btnCopyLink.title = 'Copiar link do produto';
  btnCopyLink.addEventListener('click', async () => {
    const url = c.rawUrl || c.productUrl || c.url || '';
    if (!url) { btnCopyLink.textContent = '❌ sem link'; setTimeout(() => { btnCopyLink.textContent = '🔗 Link'; }, 1500); return; }
    try {
      await navigator.clipboard.writeText(url);
      btnCopyLink.textContent = '✅ Copiado!';
    } catch (_) {
      btnCopyLink.textContent = '❌ erro';
    }
    setTimeout(() => { btnCopyLink.textContent = '🔗 Link'; }, 1500);
  });
  actions.appendChild(btnCopyLink);

  const btnApprove = document.createElement('button');
  btnApprove.className = 'promos-btn promos-btn-sm promos-btn-primary';
  btnApprove.textContent = '✅ Aprovar';
  btnApprove.addEventListener('click', async () => {
    const grupo = groupSel.value;
    if (grupo === 'indefinido') {
      alert('Escolha o grupo (Kate ou Musculosas) antes de aprovar.');
      return;
    }
    await approveFlow(c, grupo);
  });
  actions.appendChild(btnApprove);

  const btnDiscard = document.createElement('button');
  btnDiscard.className = 'promos-btn promos-btn-sm promos-btn-secondary';
  btnDiscard.textContent = '🗑️ Descartar';
  btnDiscard.addEventListener('click', async () => {
    await window.PromosStore.dequeue(c);
    renderCards(panel);
  });
  actions.appendChild(btnDiscard);

  body.appendChild(actions);
  card.appendChild(body);
  return card;
}

/** Campos enviados no handoff entre perfis (sem imagem — a página tem a foto). */
function slimForHandoff(c) {
  const keep = ['site', 'name', 'priceDe', 'pricePor', 'discount', 'deAjustado', 'coupon', 'category',
                'asin', 'mlbId', 'shopId', 'itemId', 'url', 'productUrl', 'rawUrl', 'msgTime', 'origem', 'score'];
  const o = {};
  for (const k of keep) if (c[k] != null) o[k] = c[k];
  return o;
}

/**
 * Abre a página do produto no Chrome do OUTRO perfil (via native host), com o
 * candidato codificado no #promosApprove= da URL. Retorna true se o native host
 * aceitou o pedido. Lá, o handoff.js dispara a montagem do post com a conta certa.
 */
/**
 * Escolhe a melhor URL para abrir direto na PÁGINA DO PRODUTO (evita a tela
 * /social/ do ML, que é o perfil do afiliado com vários produtos). Prefere a
 * URL que tem cara de produto; só cai no link original se nenhuma tiver.
 */
function bestProductUrl(c) {
  // Mercado Livre: monta a URL de catálogo /p/MLB<id>. A forma antiga
  // produto.mercadolivre.com.br/MLB-<id> (com hífen) dá 404; a /p/MLB<id> abre.
  const site = c.site || c.marketplace || '';
  if (site === 'mercadolivre' && c.mlbId) {
    const digits = String(c.mlbId).replace(/\D/g, '');
    if (digits) return `https://www.mercadolivre.com.br/p/MLB${digits}`;
  }
  if (site === 'shopee' && c.shopId && c.itemId) {
    return `https://shopee.com.br/product/${c.shopId}/${c.itemId}`;
  }
  if (site === 'amazon' && c.asin) {
    return `https://www.amazon.com.br/dp/${c.asin}`;
  }
  const cands = [c.productUrl, c.url, c.rawUrl].filter(Boolean).map(u => String(u).split('#')[0]);
  const looksProduct = u =>
    /\/p\/MLB\d|\/MLB-?\d|-_JM|\/dp\/[A-Z0-9]{10}|-i\.\d+\.\d+|\/product-i\./i.test(u);
  return cands.find(looksProduct) || cands[0] || '';
}

/** Monta a URL LIMPA do produto a partir do resultado do resolver (qualquer
 *  marketplace). ML usa /p/MLB<id> (a forma com hífen dá 404). Retorna null se
 *  o resolver não achou um produto válido. */
function cleanProductUrlFromResolved(r) {
  if (!r || !r.isValid) return null;
  if (r.marketplace === 'mercadolivre' && r.mlbId) {
    return `https://www.mercadolivre.com.br/p/MLB${String(r.mlbId).replace(/\D/g, '')}`;
  }
  return r.productUrl ? String(r.productUrl).split('#')[0] : null;
}

async function openInOtherProfile(c, grupo, cfg) {
  // Local (não no topo do módulo): o content script é re-injetado e um `const`
  // de escopo de módulo estoura "already been declared" na 2ª injeção.
  // Reconhece URL de produto dos 3 marketplaces (ML /p/MLB ou /MLB-, Amazon /dp/,
  // Shopee tanto -i.shop.item quanto /product/shop/item).
  const LOOKS_PRODUCT_RE = /\/p\/MLB\d|\/MLB-?\d|-_JM|\/dp\/[A-Z0-9]{10}|-i\.\d+\.\d+|\/product[-/]/i;

  let baseUrl = bestProductUrl(c);
  if (!baseUrl) { alert('Sem URL do produto para abrir no outro perfil.'); return false; }

  // O promosApprove é o ÚNICO canal para o outro perfil e só é lido pelo
  // handoff.js (domínios ML/Amazon/Shopee). Se a URL é um redirecionador de
  // terceiro (lucreshop, meli.la, shope.ee etc.), o marcador se perde na cadeia
  // de redirects antes de chegar à página do produto. Por isso, resolvemos antes
  // para a URL LIMPA do produto — funciona para qualquer marketplace.
  if (!LOOKS_PRODUCT_RE.test(baseUrl)) {
    let resolved = null;
    try {
      resolved = await new Promise(res =>
        chrome.runtime.sendMessage({ action: 'resolveLinkDeep', url: baseUrl }, res));
    } catch (_) {}

    const clean = cleanProductUrlFromResolved(resolved);
    if (clean) {
      baseUrl = clean;
    } else {
      alert('Não consegui resolver este link para a URL do produto.\n\n' +
            'Links redirecionadores de terceiros podem não passar o item para o outro perfil. ' +
            'Abra o produto manualmente nesse perfil, ou aprove pelo mesmo perfil do grupo.');
      return false;
    }
  }

  // base64URL (sem + / =) num QUERY PARAM: a Amazon descarta o #fragment ao
  // reescrever a URL (adiciona ?th=1), mas PRESERVA os parâmetros de query.
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify({ candidate: slimForHandoff(c), grupo }))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const sep = baseUrl.includes('?') ? '&' : '?';
  const url = `${baseUrl}${sep}promosApprove=${b64}`;
  return new Promise(resolve => {
    chrome.runtime.sendMessage(
      { action: 'openInOtherProfile', url, profileDir: cfg.otherProfileDir, chromePath: cfg.chromePath || '' },
      res => {
        if (chrome.runtime.lastError || !res?.ok) {
          alert('Não consegui abrir no outro perfil (programa-ponte).\n' +
                (chrome.runtime.lastError?.message || res?.error || '') +
                '\n\nConfira se você rodou native-host\\instalar.bat e recarregou a extensão.');
          resolve(false);
        } else {
          resolve(true);
        }
      }
    );
  });
}

/**
 * Aprovar: abre a página do produto numa aba ativa (ritmo humano → o ML não
 * bloqueia), onde o link de afiliado é gerado e o post é montado com os dados
 * da mensagem do grupo. O histórico/remoção da fila acontecem nessa aba.
 */
/**
 * Decide o fluxo de aprovação (cross-profile vs mesmo perfil) e executa.
 * Reutilizado pelo botão Aprovar da fila e pelo "Re-aprovar" do histórico.
 */
async function approveFlow(c, grupo) {
  // Cross-profile: item de OUTRO grupo e este perfil tem o perfil-destino
  // configurado → abre no Chrome do grupo certo (link sai com a conta certa).
  const cfg = await chrome.storage.local.get(['profileGroup', 'otherProfileDir', 'chromePath']);
  const crossProfile = cfg.profileGroup && grupo !== cfg.profileGroup && cfg.otherProfileDir;

  if (crossProfile) {
    const ok = await openInOtherProfile(c, grupo, cfg);
    if (ok) {
      // NÃO remove: marca como aprovado (no outro Chrome) e mantém na fila —
      // você descarta (🗑️) depois de postar. Nada some sozinho.
      try { await window.PromosStore.markSent(c, grupo, true); } catch (_) {}
      removeQueue();
    }
    return;
  }

  // Mesmo perfil: NÃO remove agora. A remoção (e o histórico) acontece em
  // handleBuildPostFromCandidate só se o post for montado com sucesso — assim
  // uma falha (404, link não gerado) mantém o item na fila com aviso de erro.
  await approveCandidate(c, grupo);
}

async function approveCandidate(c, grupo) {
  // Se já estamos na página deste produto, monta inline (fluxo Fase 1)
  const onProductPage =
    (c.asin   && location.href.includes(c.asin)) ||
    (c.mlbId  && location.href.replace(/-/g, '').includes(c.mlbId)) ||
    (c.itemId && location.href.includes(c.itemId));

  if (onProductPage && window.PromosContentApprove) {
    removeQueue();
    await window.PromosContentApprove(c, grupo);
    return;
  }

  // Caso normal (na fila, em web.whatsapp.com): pede ao SW para abrir o produto
  removeQueue();
  chrome.runtime.sendMessage(
    { action: 'openProductAndApprove', candidate: c, grupo },
    res => {
      if (chrome.runtime.lastError || !res?.ok) {
        if (res?.error === 'nao-marketplace') {
          alert('Esse link não leva a um produto de Amazon, Mercado Livre ou Shopee ' +
                '(não dá pra gerar link de afiliado). Descarte o item ou ajuste o link.');
        } else {
          alert('Não consegui abrir a página do produto para gerar o link de afiliado.\n' +
                (chrome.runtime.lastError?.message || res?.error || ''));
        }
      }
    }
  );
}

// ── Mock para teste de aceite (rodar no console do contexto Promos):
//    PromosQueue.seedMock()  → enfileira 3 candidatos e abre a fila
async function seedMock() {
  const mocks = [
    {
      site: 'amazon', asin: 'B0MOCK00001', origem: 'Radar',
      name: 'Whey Protein Mock 900g Sabor Chocolate',
      priceDe: 149.90, pricePor: 89.90, discount: 40, category: 'suplemento',
      imageUrl: null, productUrl: 'https://www.amazon.com.br/dp/B0MOCK00001',
    },
    {
      site: 'mercadolivre', mlbId: 'MLB000000001', origem: 'Garimpo',
      name: 'Air Fryer Mock 4L Digital',
      priceDe: 399.00, pricePor: 299.00, discount: 25, category: 'cozinha',
      imageUrl: null, productUrl: 'https://produto.mercadolivre.com.br/MLB-000000001',
    },
    {
      site: 'shopee', shopId: '999', itemId: '888777', origem: 'Radar',
      name: 'Fone Bluetooth Mock TWS',
      priceDe: 120.00, pricePor: 59.90, discount: 50, category: 'eletronicos',
      imageUrl: null, productUrl: 'https://shopee.com.br/product/999/888777',
    },
  ];
  for (const m of mocks) {
    const { score, breakdown, flags } = window.PromosScoring.scoreProduct(m);
    m.score = score; m.breakdown = breakdown; m.flags = flags;
    m.grupo = window.PromosScoring.classifyGroup(m);
    await window.PromosStore.enqueue(m);
  }
  await showQueue();
  return 'mock: 3 candidatos enfileirados';
}

function groupLabel(g) {
  return g === 'kate' ? '❣️ Kate' : g === 'musculosas' ? '💪 Musculosas' : '❓ Indefinido';
}

async function renderHistory(panel, visible) {
  document.getElementById('promos-history-section')?.remove();
  if (!visible) return;

  const section = document.createElement('div');
  section.id = 'promos-history-section';

  const history = await window.PromosStore.get('postedHistory', {});
  const items = Object.values(history).sort((a, b) =>
    new Date(b.postadoEm) - new Date(a.postadoEm)
  );

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'promos-history-empty';
    empty.textContent = 'Nenhum post aprovado ainda.';
    section.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'promos-history-list';

    for (const item of items.slice(0, 60)) {
      const row = document.createElement('div');
      row.className = 'promos-history-item';

      const emoji = item.grupo === 'kate' ? '❣️' : item.grupo === 'musculosas' ? '💪' : '📦';
      const emojiEl = document.createElement('span');
      emojiEl.textContent = emoji;
      row.appendChild(emojiEl);

      const name = document.createElement('div');
      name.className = 'promos-history-name';
      name.textContent = item.nome || item.id;
      name.title = item.nome || item.id;
      row.appendChild(name);

      const meta = document.createElement('div');
      meta.className = 'promos-history-meta';
      const d = new Date(item.postadoEm);
      meta.textContent = `${item.marketplace || '?'}  ${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
      row.appendChild(meta);

      // Re-aprovar num grupo à escolha: serve pra postar a MESMA promo no outro
      // grupo (ex: aspirador que vai pra Kate e Musculosas) ou refazer.
      // Só aparece se guardamos os dados do candidato (posts antigos não têm).
      if (item.cand) {
        const postado = item.grupo || item.cand.grupo; // grupo já postado
        const reSel = document.createElement('select');
        reSel.className = 'promos-queue-group-select';
        reSel.title = 'Grupo para re-aprovar';
        for (const g of ['kate', 'musculosas']) {
          const opt = document.createElement('option');
          opt.value = g;
          opt.textContent = groupLabel(g);
          // Padrão: sugere o grupo OPOSTO ao que já foi postado
          if (g !== postado) opt.selected = true;
          reSel.appendChild(opt);
        }
        row.appendChild(reSel);

        const btnRe = document.createElement('button');
        btnRe.className = 'promos-btn promos-btn-sm promos-btn-secondary';
        btnRe.textContent = '♻️ Re-aprovar';
        btnRe.title = 'Reabre o produto e gera o post no grupo selecionado';
        btnRe.addEventListener('click', () => approveFlow(item.cand, reSel.value));
        row.appendChild(btnRe);
      }

      list.appendChild(row);
    }
    section.appendChild(list);
  }

  // Insere antes do buildImportRow (último filho do panel)
  panel.insertBefore(section, panel.lastElementChild);
}

/** Ordena a fila in-place conforme o critério escolhido. */
function sortQueue(queue, sort) {
  // Duas datas diferentes, que NÃO podem ser misturadas numa só ordenação:
  //  - addedAt: quando o item entrou na fila (o garimpo).
  //  - msgTime: quando a mensagem foi postada no grupo.
  // Antes o critério era "msgTime, ou addedAt se não der pra ler". Isso mistura
  // as duas escalas: um item de mensagem antiga garimpado agora caía no fim, e
  // um item sem msgTime legível pulava pra frente — a ordem não correspondia a
  // nenhuma das duas perguntas. Agora cada ordenação usa uma data só.
  const garimpo = c => c.addedAt ?? 0;
  const msg     = c => msgTimeToTs(c.msgTime);

  // Sem msgTime legível vai pro fim (não some da lista, mas não finge recência).
  const porMsg = (a, b) => {
    const ta = msg(a), tb = msg(b);
    if (ta == null && tb == null) return garimpo(b) - garimpo(a);
    if (ta == null) return 1;
    if (tb == null) return -1;
    return tb - ta;
  };

  const cmp_recentes = (a, b) => garimpo(b) - garimpo(a);
  const cmp = {
    recentes: cmp_recentes,
    msg:      porMsg,
    antigos:  (a, b) => garimpo(a) - garimpo(b),
    score:    (a, b) => (b.score ?? 0) - (a.score ?? 0),
    desconto: (a, b) => (b.discount ?? 0) - (a.discount ?? 0),
    precoAsc: (a, b) => (a.pricePor ?? Infinity) - (b.pricePor ?? Infinity),
  }[sort] || cmp_recentes;
  queue.sort(cmp);
}

/** "há 3h", "ontem", "há 2 dias" — idade legível de um timestamp. */
function humanAge(ts) {
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1)  return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

/** "HH:MM DD/MM/YYYY" → timestamp (ms). Retorna null se não parsear. */
function msgTimeToTs(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{1,2}):(\d{2})\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, hh, mi, dd, mo, yyyy] = m;
  return new Date(+yyyy, +mo - 1, +dd, +hh, +mi).getTime();
}

function fmtBR(n) {
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Pede ao service worker a imagem como data: URL (contorna a CSP do WhatsApp Web). */
function loadImageViaWorker(url, imgEl, card) {
  // data:/blob: já são exibíveis direto (ex: foto capturada do preview do WhatsApp)
  if (/^(data|blob):/.test(url)) { imgEl.src = url; return; }
  chrome.runtime.sendMessage({ action: 'fetchImage', url }, res => {
    if (chrome.runtime.lastError || !res?.dataUrl) {
      // Falha → troca por placeholder
      const ph = document.createElement('div');
      ph.className = 'promos-queue-thumb promos-thumb-placeholder';
      ph.textContent = 'sem foto';
      imgEl.replaceWith(ph);
      return;
    }
    imgEl.src = res.dataUrl;
  });
}
