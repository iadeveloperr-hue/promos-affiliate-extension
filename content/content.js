// Guard: evita registrar o listener duas vezes se o script for injetado novamente
if (!window.__promos_content_loaded) {
  window.__promos_content_loaded = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'extract') {
      handleExtract(msg.group).catch(err => {
        console.error('[Promos] Erro na extração:', err);
        window.PromosOverlay.showOverlay({
          group: msg.group, postText: '', imageUrl: null, parsed: null, affiliateUrl: '',
          missing: ['erro interno: ' + err.message],
        });
      });
      sendResponse({ ok: true });
    } else if (msg.action === 'showQueue') {
      window.PromosQueue.showQueue().catch(err =>
        console.error('[Promos] Erro ao abrir fila:', err));
      sendResponse({ ok: true });
    } else if (msg.action === 'showCoupons') {
      window.PromosCoupons.showPanel().catch(err =>
        console.error('[Promos] Erro ao abrir cupons:', err));
      sendResponse({ ok: true });
    } else if (msg.action === 'capturarMl') {
      handleCapturarMl().catch(err =>
        console.error('[Promos] Erro ao capturar ML:', err));
      sendResponse({ ok: true });
    } else if (msg.action === 'capturarRanking') {
      handleCapturarRanking().catch(err =>
        console.error('[Promos] Erro ao capturar ranking:', err));
      sendResponse({ ok: true });
    } else if (msg.action === 'showGarimpo') {
      if (!location.hostname.includes('whatsapp.com')) {
        alert('Abra o WhatsApp Web (web.whatsapp.com) e navegue até um grupo antes de garimpar.');
      } else if (!window.PromosGarimpo) {
        alert('[Promos] Scripts não carregaram. Recarregue a extensão em chrome://extensions e tente novamente.');
      } else {
        window.PromosGarimpo.showGarimpo().catch(err =>
          console.error('[Promos] Erro ao abrir garimpo:', err));
      }
      sendResponse({ ok: true });
    } else if (msg.action === 'parseAndScoreForGarimpo') {
      handleParseAndScoreForGarimpo(msg.msgMeta || {})
        .then(sendResponse)
        .catch(err => sendResponse({ enqueued: 0, reason: 'erro', details: err.message }));
      return true;
    } else if (msg.action === 'parseAndScoreForRadar') {
      window.PromosRadarEngine.parseAndScore()
        .then(sendResponse)
        .catch(err => sendResponse({ enqueued: 0, skipped: 0, details: err.message }));
      return true; // resposta assíncrona
    } else if (msg.action === 'radarStatus') {
      handleRadarStatus(msg);
      sendResponse({ ok: true });
    } else if (msg.action === 'buildPostFromCandidate') {
      handleBuildPostFromCandidate(msg.candidate, msg.grupo)
        .then(() => sendResponse({ ok: true }))
        .catch(err => { console.error('[Promos] Erro ao montar post:', err); sendResponse({ ok: false, error: err.message }); });
      return true;
    }
  });
}

async function handleExtract(group) {
  // 1. Parser
  const parsed = window.PromosParser.parse();
  if (!parsed) {
    window.PromosOverlay.showOverlay({
      group, postText: '', imageUrl: null, parsed: null, affiliateUrl: '',
      missing: ['site não suportado ainda'],
    });
    return;
  }

  // 2. Link de afiliado
  let { affiliateUrl, missing } = await buildAffiliate(parsed, group);

  // Trava de conta (silenciosa): conta errada = post sem link, sem aviso.
  if (affiliateUrl) {
    const contaOk = await window.PromosAccountGuard.verificar(parsed.site, group);
    let creditoErrado = false;
    if (parsed.site === 'amazon') {
      const esp = (window.PromosConfig.GROUPS[group].amazonTrackingId || '').toLowerCase();
      const r = await sendToWorkerSafe({ action: 'verificarTagAmazon', url: affiliateUrl });
      if (r && r.tag && esp && r.tag !== esp) creditoErrado = true;
    } else if (parsed.site === 'mercadolivre') {
      const esp = await window.PromosAccountGuard.mattToolEsperado(group);
      const r = await sendToWorkerSafe({ action: 'verificarMattTool', url: affiliateUrl });
      if (r && r.mattTool && esp && r.mattTool !== esp) creditoErrado = true;
    }
    if (!contaOk.ok || creditoErrado) {
      console.warn('[Promos] conta/credito divergente — post sai sem link');
      affiliateUrl = '';
    }
  }
  // 3. Monta o post
  const postText = window.PromosTemplate.build(parsed, affiliateUrl, group);

  // 4. Exibe overlay — passa parsed para o botão de troca de grupo
  window.PromosOverlay.showOverlay({ group, postText, imageUrl: parsed.imageUrl || null, missing, parsed, affiliateUrl });
}

/** Gera o link de afiliado para o site/grupo dados. Exportado para o overlay usar ao trocar grupo. */
window.PromosGetAffiliate = async function buildAffiliate(parsed, group) {
  let affiliateUrl = '';
  const missing = [...(parsed.missing || [])];

  if (parsed.site === 'amazon') {
    const r = await window.PromosAffiliate.amazon(parsed.asin, group);
    affiliateUrl = r.url;
    if (r.missingTrackingId) {
      missing.push('tracking ID Amazon não configurado — adicione em lib/config.js (grupo musculosas)');
    } else if (r.isFallback) {
      missing.push('link SiteStripe (não logado?) — usando link longo editável');
    }

  } else if (parsed.site === 'mercadolivre') {
    const r = await window.PromosAffiliate.mercadolivre();
    if (r.isFallback) missing.push(r.error || 'link ML não gerado');
    else affiliateUrl = r.url;

  } else if (parsed.site === 'shopee') {
    const r = window.PromosAffiliate.shopee(parsed, group);
    affiliateUrl = r.url;
    if (r.isFallback) missing.push('link Shopee — cole o link do painel Afiliados');
  }

  return { affiliateUrl, missing };
};

// Alias local para uso interno
async function buildAffiliate(parsed, group) {
  return window.PromosGetAffiliate(parsed, group);
}

async function handleCapturarMl() {
  const isAfiliados =
    location.hostname.includes('mercadolivre') &&
    (location.pathname.startsWith('/afiliados') || location.hostname.includes('painel.mercadolivre'));
  if (!isAfiliados) {
    alert('Abra o painel de afiliados do Mercado Livre (mercadolivre.com.br/afiliados) antes de capturar.');
    return;
  }

  const { records, rawRows, avisos } = window.PromosMlPanelScraper.scrape();

  if (avisos.length) {
    const msg = avisos.join('\n');
    // Mostra avisos mas não aborta se houver dados
    if (!records.length) { alert('⚠️ ' + msg); return; }
    console.warn('[Promos] ML scraper avisos:', msg);
  }

  const existing = await window.PromosStore.getCommissionStats();
  const finalStats = window.PromosCommissionParser.aggregate(records, existing);
  await window.PromosStore.setCommissionStats(finalStats);

  const nCats = Object.keys(finalStats.categorias).length;
  alert(`✅ ${records.length} linha(s) capturada(s) do painel ML.\n${nCats} categoria(s) no total.\n${avisos.length ? '\n⚠️ ' + avisos.join('\n⚠️ ') : ''}`);
}

async function handleCapturarRanking() {
  const info = window.PromosRankingParser.detect();
  if (!info) {
    alert(
      'Página não reconhecida como ranking.\n\n' +
      'Páginas suportadas:\n' +
      '• Amazon: /bestsellers/ ou /gp/movers-and-shakers/\n' +
      '• Mercado Livre: /mais-vendidos/\n' +
      '• Shopee: /hot-deals/ ou /ofertas-do-dia/'
    );
    return;
  }

  const { marketplace, rankingType, products } = window.PromosRankingParser.parse();

  if (!products.length) {
    const dica = marketplace === 'mercadolivre'
      ? '\n\nDica: na página /mais-vendidos, entre numa categoria primeiro\n(ex: Beleza, Fitness, Eletrônicos) e tente novamente.'
      : '\nSe a página ainda está carregando, aguarde e tente novamente.';
    alert(`⚠️ Nenhum produto encontrado em ${marketplace} (${rankingType}).${dica}`);
    return;
  }

  // 1. Salva IDs rankeados no store (bônus de pontuação isRanked)
  const ids = products.map(p => window.PromosStore.productId(p)).filter(Boolean);
  const total = await window.PromosStore.saveRankedIds(ids);

  // 2. Enfileira os produtos da página, incluindo os "indefinido" (você escolhe
  //    o grupo na fila). Teto para não inundar a fila na página raiz.
  const r = await window.PromosRadarEngine.parseAndScore({ includeIndefinido: true });

  alert(
    `✅ ${products.length} produto(s) lidos de ${marketplace} (${rankingType}).\n` +
    `🏆 ${total} ID(s) rankeado(s) no storage.\n\n` +
    `📋 ${r.enqueued} adicionado(s) à fila (${r.details}).\n` +
    `Os "indef" entram sem grupo — escolha Kate/Musculosas na fila.\n\n` +
    `Abra a fila com Ctrl+Shift+L.`
  );

  console.log(`[Promos] Ranking ${marketplace}: lidos=${products.length} enfileirados=${r.enqueued}`, products);
}

async function handleParseAndScoreForGarimpo(msgMeta) {
  const meta = msgMeta || {};
  const parsed = window.PromosParser.parse();
  if (!parsed) return { enqueued: 0, reason: 'semParser' };

  // Página não renderizou (redirect/anti-bot): sem nome o candidato é inútil
  if (!parsed.name || !parsed.name.trim()) return { enqueued: 0, reason: 'semNome' };

  // Preços anunciados na mensagem têm prioridade (refletem o preço final com cupom)
  const priceDe  = meta.priceDe  ?? parsed.priceDe  ?? null;
  const pricePor = meta.pricePor ?? parsed.pricePor ?? null;
  let discount = parsed.discount ?? null;
  if (priceDe && pricePor && priceDe > pricePor) {
    discount = Math.round((1 - pricePor / priceDe) * 100);
  }

  const grupo = window.PromosScoring.classifyGroup(parsed); // pode ser 'indefinido' — enfileira assim mesmo

  // Captura a frase de chamada do post garimpado no balde "a revisar" da
  // categoria (vira sugestão oficial só quando aprovada no overlay).
  if (meta.hook) {
    const grpBank = (grupo === 'kate' || grupo === 'musculosas') ? grupo : 'kate';
    window.PromosStore.addReviewPhrase(grpBank, parsed, meta.hook).catch(() => {});
  }

  const stats = await window.PromosStore.getCommissionStats();
  const profile = window.PromosDemandProfile.getDemandProfile(stats, null);
  const categoryScore = profile[parsed.category]?.categoryScore ?? 50;
  const isRanked = await window.PromosStore.isProductRanked(parsed);

  const { score, breakdown, flags } = window.PromosScoring.scoreProduct(
    { ...parsed, priceDe, pricePor, discount, isRanked },
    { categoryScore }
  );

  // Gera o NOSSO link de afiliado (não o do grupo). ML: clica em Compartilhar
  // na barra de afiliado (nível-conta, vale para os dois grupos).
  let affiliateUrl = '';
  if (parsed.site === 'mercadolivre') {
    affiliateUrl = await generateMeliWithRetry();
  }

  const candidate = {
    ...parsed,
    site: parsed.site,
    priceDe, pricePor, discount,
    // Cupom anunciado na mensagem do grupo tem prioridade (a página raramente expõe)
    coupon: meta.coupon || parsed.coupon || null,
    affiliateUrl: affiliateUrl || '',
    score, breakdown, flags,
    grupo,
    isRanked,
    origem: 'Garimpo',
    productUrl: location.href,
    msgTime: meta.msgTime || null,
  };

  const isDup = await window.PromosStore.isDuplicate(candidate);
  if (isDup) return { enqueued: 0, reason: 'duplicado' };

  const ok = await window.PromosStore.enqueue(candidate);
  return { enqueued: ok ? 1 : 0, reason: ok ? 'ok' : 'erro', details: ok ? `${grupo} score:${score}` : 'fila cheia?' };
}

// ── Garimpo sem abrir abas ────────────────────────────────────────────────────
// Monta candidatos só com os dados da mensagem do grupo (nome, De/Por, cupom,
// link, horário, foto do preview). Não abre a página do produto → não dispara o
// anti-bot do ML. O link de afiliado e o enriquecimento ocorrem na aprovação.
window.PromosGarimpoEngine = { processLinks };

async function processLinks(links, onProgress) {
  const results = {
    enqueued: 0,
    reasons: { duplicado: 0, jaNaFila: 0, semNome: 0, resolveInvalido: 0, erro: 0 },
    failures: [],
  };

  let i = 0;
  for (const link of links) {
    i++;
    if (onProgress) onProgress(i, links.length);
    try {
      const name = (link.name || '').trim();
      if (!name) {
        results.reasons.semNome++;
        results.failures.push({ rawUrl: link.url, reason: 'semNome' });
        continue;
      }

      // Resolve o ID do produto via SW (fetch privilegiado). Best-effort:
      // se falhar/for bloqueado, segue com id baseado na URL.
      let resolved = null;
      try { resolved = await sendToWorker({ action: 'resolveLink', url: link.url }); } catch (_) {}
      // NÃO chutar 'mercadolivre' para links desconhecidos (ex: promosdaluh→Época,
      // que não é marketplace). Fica null → card mostra "❓ marketplace?" e a
      // aprovação resolve via aba; se não levar a Amazon/ML/Shopee, é recusado.
      const site = resolved?.marketplace || detectSiteFromUrl(link.url) || null;

      let priceDe    = link.priceDe  ?? null;
      const pricePor = link.pricePor ?? null;

      // De real do ML: o "De" transcrito do grupo costuma vir inflado (faz o
      // desconto parecer maior). Sobrescreve pelo preço de tabela real da
      // página — evita âncora falsa e o risco de "desconto enganoso".
      let deAjustado = false;
      if (site === 'mercadolivre' && resolved?.productUrl && pricePor) {
        try {
          const r = await sendToWorker({ action: 'fetchMlDe', productUrl: resolved.productUrl, pricePor });
          if (r?.priceDe && r.priceDe > pricePor && Math.round(r.priceDe * 100) !== Math.round((priceDe || 0) * 100)) {
            priceDe = r.priceDe;
            deAjustado = true;
          }
        } catch (_) { /* mantém o De do grupo se a busca falhar */ }
      }

      let discount = null;
      if (priceDe && pricePor && priceDe > pricePor) {
        discount = Math.round((1 - pricePor / priceDe) * 100);
      }

      // Cofre de cupons: guarda TODOS os cupons da mensagem (códigos + genéricos)
      // mesmo que o produto seja duplicado — cupom novo vale por si só.
      if (Array.isArray(link.couponsAll) && link.couponsAll.length) {
        // ...e publica no arquivo compartilhado, para o Chrome do outro grupo
        // enxergar os cupons mesmo sem nunca ter garimpado.
        window.PromosStore.saveCoupons(link.couponsAll, site)
          .then(() => window.PromosStore.syncCouponsShared())
          .catch(() => {});
      }

      const candidate = {
        site, name, priceDe, pricePor, discount, deAjustado,
        coupon: link.coupon || null,
        imageUrl: link.imageUrl || null,
        category: null,
        asin:   resolved?.asin   || null,
        mlbId:  resolved?.mlbId  || null,
        shopId: resolved?.shopId || null,
        itemId: resolved?.itemId || null,
        url:        resolved?.productUrl || link.url, // p/ productId (fallback hash)
        productUrl: resolved?.productUrl || link.url,
        rawUrl:     link.url,
        msgTime: link.msgTime || null,
        origem: 'Garimpo',
      };

      const grupo = window.PromosScoring.classifyGroup(candidate);
      candidate.grupo = grupo;

      // Captura a frase de chamada do post no balde "a revisar" da categoria
      // (vira sugestão oficial só quando aprovada no overlay).
      if (link.hook) {
        const grpBank = (grupo === 'kate' || grupo === 'musculosas') ? grupo : 'kate';
        window.PromosStore.addReviewPhrase(grpBank, candidate, link.hook).catch(() => {});
      }

      const isRanked = await window.PromosStore.isProductRanked(candidate);
      const { score, breakdown, flags } = window.PromosScoring.scoreProduct(
        { ...candidate, isRanked }, { categoryScore: 50 }
      );
      Object.assign(candidate, { score, breakdown, flags, isRanked });

      if (await window.PromosStore.isDuplicate(candidate)) {
        results.reasons.duplicado++;
        continue;
      }
      const ok = await window.PromosStore.enqueue(candidate);
      if (ok) results.enqueued++;
      else { results.reasons.jaNaFila++; } // enqueue=false → já está na fila (não é erro)
    } catch (e) {
      results.reasons.erro++;
      results.failures.push({ rawUrl: link.url, reason: 'erro', erro: (e.message || '').slice(0, 80) });
    }
  }

  results.skipped = Object.values(results.reasons).reduce((a, b) => a + b, 0);
  return results;
}

function detectSiteFromUrl(url) {
  if (/amazon\.com\.br|amzn\.to/i.test(url)) return 'amazon';
  if (/shopee\.com\.br|shope\.ee/i.test(url)) return 'shopee';
  if (/mercadoli[bv]re|meli\.la/i.test(url)) return 'mercadolivre';
  return null;
}

function sendToWorker(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, res => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res);
    });
  });
}

/**
 * Aprovação na página do produto: gera o NOSSO link de afiliado, monta o post
 * com os dados da mensagem (nome/preços/cupom) e exibe o overlay. Roda na aba
 * do produto que o usuário abriu ao aprovar (1ª plano, ritmo humano).
 */
window.PromosContentApprove = handleBuildPostFromCandidate;
async function handleBuildPostFromCandidate(c, grupo) {
  // Re-parseia a página REAL do produto (estamos nela): pega ID/categoria/imagem
  // corretos. Os dados da mensagem do grupo (nome/preços/cupom) têm prioridade.
  // Quando a fila não trouxe "De"/desconto (mensagem do grupo só tinha o "Por"
  // ou o cupom), dependemos 100% do que a página mostra. Como a página acabou
  // de navegar, os blocos de preço riscado/badge de desconto podem ainda não
  // estar renderizados no 1º parse() — tenta de novo por alguns segundos até
  // aparecer, senão segue com o melhor resultado obtido.
  const needsDeFromPage = c.priceDe == null && c.discount == null;
  const page = await reparseWithRetry(needsDeFromPage);

  const parsed = {
    site: page.site || c.site,
    // Nome da PÁGINA real tem prioridade (o da mensagem varia muito por grupo)
    name: page.name || c.name || null,
    priceDe:  c.priceDe  ?? page.priceDe  ?? null,
    pricePor: c.pricePor ?? page.pricePor ?? null,
    discount: c.discount ?? page.discount ?? null,
    coupon:   c.coupon   ?? page.coupon   ?? null,
    couponPct: page.couponPct ?? null, couponMin: page.couponMin ?? null,
    // Preço em destaque que só vale com cupom (ML) — informativo, fora do post
    priceCondicional: page.priceCondicional ?? null,
    condicaoLabel:    page.condicaoLabel ?? null,
    category: page.category ?? c.category ?? null,
    // IDs SEMPRE da página real (os resolvidos do garimpo podem estar errados)
    asin:   page.asin   ?? c.asin   ?? null,
    mlbId:  page.mlbId  ?? c.mlbId  ?? null,
    shopId: page.shopId ?? c.shopId ?? null,
    itemId: page.itemId ?? c.itemId ?? null,
    // Imagem principal: do WhatsApp quando houver (melhor qualidade/contexto)
    imageUrl: c.imageUrl ||
              page.imageUrl ||
              document.querySelector('meta[property="og:image"]')?.content || null,
    // Imagem alternativa: sempre a da página do marketplace (para o painel IG)
    imageUrlMarket: page.imageUrl ||
                    document.querySelector('meta[property="og:image"]')?.content || null,
    // Vídeo do produto (para reels) — só vem da página real
    videoUrl: page.videoUrl || null,
    missing: [],
  };

  let affiliateUrl = '';
  const missing = [];

  if (parsed.site === 'mercadolivre') {
    affiliateUrl = await generateMeliWithRetry();
    if (!affiliateUrl) missing.push('link meli.la não gerado — confirme login de afiliado e clique em Compartilhar');
  } else if (parsed.site === 'amazon' && parsed.asin) {
    const r = await window.PromosAffiliate.amazon(parsed.asin, grupo);
    affiliateUrl = r.url;
    if (r.missingTrackingId) missing.push('tracking ID Amazon não configurado (grupo musculosas)');
    else if (r.isFallback) missing.push('link SiteStripe (não logado?) — usando link longo');
  } else if (parsed.site === 'shopee') {
    if (c.shopeeAffiliateUrl) {
      affiliateUrl = c.shopeeAffiliateUrl;
    } else {
      const r = window.PromosAffiliate.shopee(parsed, grupo);
      affiliateUrl = r.url;
      if (r.isFallback) missing.push('link Shopee — cole o link curto do painel Afiliados');
    }
  }

  // Trava de conta (silenciosa): conta errada = post sem link, sem aviso.
  if (affiliateUrl) {
    const contaOk = await window.PromosAccountGuard.verificar(parsed.site, grupo);
    let creditoErrado = false;
    if (parsed.site === 'amazon') {
      const esp = (window.PromosConfig.GROUPS[grupo].amazonTrackingId || '').toLowerCase();
      const r = await sendToWorkerSafe({ action: 'verificarTagAmazon', url: affiliateUrl });
      if (r && r.tag && esp && r.tag !== esp) creditoErrado = true;
    } else if (parsed.site === 'mercadolivre') {
      const esp = await window.PromosAccountGuard.mattToolEsperado(grupo);
      const r = await sendToWorkerSafe({ action: 'verificarMattTool', url: affiliateUrl });
      if (r && r.mattTool && esp && r.mattTool !== esp) creditoErrado = true;
    }
    if (!contaOk.ok || creditoErrado) {
      console.warn('[Promos] conta/credito divergente — post sai sem link');
      affiliateUrl = '';
    }
  }
  const postText = window.PromosTemplate.build(parsed, affiliateUrl, grupo);

  // NÃO remove da fila aqui. Aprovar apenas ABRE o post; o item só sai da fila
  // quando o post é REALMENTE usado (copiar/enviar no overlay → finalizeQueueItem).
  // Assim, se algo falhar (404, link não gerado, deslogado) ou você fechar, a
  // promoção CONTINUA na fila — vale para todos os marketplaces.
  const nameOk = !!(parsed.name && parsed.name.trim());
  const linkOk = !!affiliateUrl;
  c.grupo = grupo; // preserva o grupo escolhido
  c.lastError = (nameOk && linkOk) ? null : (!nameOk
    ? 'página não carregou (404?) — não montou o post'
    : 'link de afiliado não gerado — use o botão de capturar');
  try { await window.PromosStore.updateInQueue(c); } catch (_) {}

  // Preço da fila ≠ preço da página. A fila continua ganhando (decisão sua),
  // mas o overlay avisa em vez de escolher em silêncio: o garimpo pode ser de
  // dias atrás, ou a mensagem do grupo pode ter vindo com o valor errado.
  const priceMismatch = (c.pricePor && page.pricePor
                         && Math.abs(c.pricePor - page.pricePor) > 0.009)
    ? { fila: c.pricePor, pagina: page.pricePor }
    : null;

  window.PromosOverlay.showOverlay({
    group: grupo, postText, imageUrl: parsed.imageUrl, missing, parsed, affiliateUrl,
    imageUrlMarket: parsed.imageUrlMarket,
    priceMismatch,
    candidate: c, // permite remover da fila (+ histórico) ao copiar/enviar
  });
}

/**
 * Reparseia a página até achar priceDe/discount (ou desistir). Usado quando o
 * item da fila não trouxe "De"/desconto — sem retry, um parse() disparado
 * antes dos blocos de preço riscado/badge renderizarem grava null pra sempre
 * e o post final sai sem desconto mesmo a página tendo a promoção.
 */
async function reparseWithRetry(needsDe, tries = 6, delayMs = 700) {
  let last = window.PromosParser.parse() || {};
  if (!needsDe) return last;
  for (let i = 0; i < tries; i++) {
    if (last.priceDe || last.discount) return last;
    await new Promise(res => setTimeout(res, delayMs));
    last = window.PromosParser.parse() || last;
  }
  return last;
}

/**
 * Gera o meli.la do próprio afiliado via barra "Compartilhar".
 * Tenta algumas vezes — a barra de afiliado pode demorar a renderizar na aba.
 * Retorna '' se não conseguir (não logado como afiliado ou barra ausente).
 */
async function generateMeliWithRetry(tries = 8) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await window.PromosAffiliate.mercadolivre();
      if (r && !r.isFallback && r.url) return r.url;
      // Se a barra ainda não apareceu (tela intermediária), aguarda mais
      if (r?.isFallback) await new Promise(res => setTimeout(res, 3000));
    } catch (_) {
      await new Promise(res => setTimeout(res, 3000));
    }
  }
  return '';
}

function handleRadarStatus(msg) {
  // Remove toast anterior se existir
  document.getElementById('promos-radar-toast')?.remove();

  const toast = document.createElement('div');
  toast.id = 'promos-radar-toast';
  Object.assign(toast.style, {
    position: 'fixed', bottom: '24px', right: '24px', zIndex: '2147483647',
    background: msg.status === 'running' ? '#0d6efd' : (msg.errors?.length ? '#cf222e' : '#1a7f37'),
    color: '#fff', padding: '12px 18px', borderRadius: '8px',
    fontFamily: 'system-ui, sans-serif', fontSize: '14px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)', maxWidth: '320px',
  });

  if (msg.status === 'running') {
    toast.textContent = '🔍 Radar rodando… abrindo páginas de ranking';
  } else {
    const errs = msg.errors?.length ? `\n⚠️ ${msg.errors.length} erro(s)` : '';
    toast.textContent = `✅ Radar concluído — ${msg.enqueued} candidato(s) enfileirado(s)${errs}`;
    setTimeout(() => toast.remove(), 6000);
  }

  document.body.appendChild(toast);
}

/** sendMessage que nunca rejeita — falha de rede não pode virar bloqueio. */
function sendToWorkerSafe(msg) {
  return new Promise(res => {
    try {
      chrome.runtime.sendMessage(msg, r => res(chrome.runtime.lastError ? {} : (r || {})));
    } catch (_) { res({}); }
  });
}
