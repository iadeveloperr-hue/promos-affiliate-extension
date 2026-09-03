// Exposto como global para uso pelo content.js (content scripts não suportam ES modules)
window.PromosOverlay = { showOverlay, removeOverlay };

/**
 * showOverlay(data)
 * data: { group, postText, imageUrl, missing[], parsed, affiliateUrl, onBack }
 * onBack: função opcional — se presente, exibe botão "← Voltar à fila"
 */
function showOverlay(data) {
  removeOverlay();

  // Estado mutável do overlay (muda ao trocar grupo)
  let currentGroup       = data.group;
  let currentAffiliateUrl = data.affiliateUrl || '';
  const parsed           = data.parsed;

  // ── Backdrop ─────────────────────────────────────────────────────────────
  const backdrop = document.createElement('div');
  backdrop.id = 'promos-overlay';
  // Clicar fora do card MINIMIZA (não fecha): preserva todos os dados/edições.
  backdrop.addEventListener('click', e => { if (e.target === backdrop) minimizeOverlay(); });

  function minimizeOverlay() {
    backdrop.style.display = 'none';
    if (document.getElementById('promos-restore-chip')) return;
    const chip = document.createElement('button');
    chip.id = 'promos-restore-chip';
    chip.className = 'promos-restore-chip';
    chip.dataset.group = currentGroup;
    chip.textContent = '📢';
    chip.title = 'Reabrir post — ' + (window.PromosConfig.GROUPS[currentGroup]?.name || 'Promos');
    chip.addEventListener('click', () => { backdrop.style.display = ''; chip.remove(); });
    document.body.appendChild(chip);
  }

  // ── Card ──────────────────────────────────────────────────────────────────
  const card = document.createElement('div');
  card.id = 'promos-card';
  card.dataset.group = currentGroup; // tema visual por grupo (ver overlay.css)

  // Drag — permite arrastar o card para ver o que está atrás
  makeDraggable(card);

  // ── Header ────────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'promos-header';
  const titleEl = document.createElement('span');
  titleEl.className = 'promos-title';
  titleEl.textContent = window.PromosConfig.GROUPS[currentGroup]?.name || 'Promos';
  header.appendChild(titleEl);
  if (data.onBack) {
    const backBtn = makeBtn('← Fila', 'promos-btn promos-btn-sm promos-btn-secondary');
    backBtn.title = 'Voltar à fila de revisão';
    backBtn.style.marginRight = '8px';
    backBtn.addEventListener('click', () => { removeOverlay(); data.onBack(); });
    header.appendChild(backBtn);
  }
  const closeBtn = makeBtn('✕', 'promos-close');
  closeBtn.title = 'Fechar';
  closeBtn.addEventListener('click', removeOverlay);
  header.appendChild(closeBtn);
  card.appendChild(header);

  // ── Seletor de grupo ──────────────────────────────────────────────────────
  const groupSelector = document.createElement('div');
  groupSelector.className = 'promos-group-selector';

  const groups = window.PromosConfig.GROUPS;
  Object.entries(groups).forEach(([id, cfg]) => {
    const btn = makeBtn(cfg.name, `promos-btn promos-btn-sm ${id === currentGroup ? 'promos-btn-group-active' : 'promos-btn-group'}`);
    btn.dataset.groupId = id;
    btn.addEventListener('click', () => handleGroupSwitch(id));
    groupSelector.appendChild(btn);
  });
  card.appendChild(groupSelector);

  // ── Warning banner ────────────────────────────────────────────────────────
  const warn = document.createElement('div');
  warn.className = 'promos-warn';
  setWarning(warn, data.missing || []);
  card.appendChild(warn);

  // ── Divergência de preço: fila × página ───────────────────────────────────
  // A fila ganha por padrão (a mensagem do grupo pode trazer o "com cupom", que
  // a página não mostra). Mas os dois lados têm riscos OPOSTOS:
  //  - fila MENOR: ou é preço com cupom (mantém), ou o preço subiu desde o
  //    garimpo (trocar) — anunciar abaixo do real gera reclamação. Alerta forte.
  //  - fila MAIOR: o produto só baixou. Perde-se venda, ninguém reclama. Discreto.
  if (data.priceMismatch) {
    const { fila, pagina } = data.priceMismatch;
    const filaMenor = fila < pagina;
    const box = document.createElement('div');
    box.className = 'promos-price-mismatch' + (filaMenor ? '' : ' promos-price-mismatch--leve');

    const txt = document.createElement('span');
    const cupom = parsed.coupon ? ` Cupom do item: <b>${escapeHtml(String(parsed.coupon))}</b>.` : '';
    txt.innerHTML = filaMenor
      ? `⚠️ Fila <b>${brl(fila)}</b> × página <b>${brl(pagina)}</b>.`
        + ` <small>Se o valor da fila é <b>com cupom</b>, mantenha. Se o preço subiu desde o garimpo, troque —`
        + ` anunciar abaixo do real gera reclamação.${cupom}</small>`
      : `ℹ️ Fila <b>${brl(fila)}</b> × página <b>${brl(pagina)}</b>.`
        + ` <small>O produto baixou depois do garimpo — trocar deixa o post mais atrativo.</small>`;
    box.appendChild(txt);

    const useBtn = makeBtn(`Usar ${brl(pagina)} da página`, 'promos-btn promos-btn-sm promos-btn-secondary');
    useBtn.addEventListener('click', () => {
      parsed.pricePor = pagina;
      textarea.value = window.PromosTemplate.build(parsed, currentAffiliateUrl, currentGroup);
      box.innerHTML = `✅ Agora o post usa <b>${brl(pagina)}</b> — o preço da página`;
    });
    box.appendChild(useBtn);

    // Só faz sentido no caso arriscado: leva ao cofre para testar o cupom e
    // descobrir qual dos dois valores é o real.
    if (filaMenor && window.PromosCoupons) {
      const testBtn = makeBtn('🎟️ Testar cupons', 'promos-btn promos-btn-sm promos-btn-secondary');
      testBtn.title = 'Abre o cofre de cupons — teste no carrinho para saber se o valor da fila se confirma';
      testBtn.addEventListener('click', () => window.PromosCoupons.showPanel().catch(() => {}));
      box.appendChild(testBtn);
    }
    card.appendChild(box);
  }

  // ── Preço condicional da página (Pix/cupom) ───────────────────────────────
  // O ML mostra em destaque um preço que só vale com cupom. O post usa o preço
  // firme ("em outros meios"), mas dá pra citar o condicional na frase se você
  // quiser — então ele fica visível aqui, fora do post.
  if (parsed && parsed.priceCondicional) {
    const info = document.createElement('div');
    info.className = 'promos-price-mismatch promos-price-mismatch--leve';
    info.innerHTML = `💳 A página destaca <b>${brl(parsed.priceCondicional)}</b> `
      + `<small>${escapeHtml(parsed.condicaoLabel || 'condicional')} — fora do post, porque depende de condição.`
      + ` O post usa o preço firme.</small>`;
    card.appendChild(info);
  }

  // ── Badge de prévia do WhatsApp ───────────────────────────────────────────
  const previewBadge = document.createElement('div');
  previewBadge.style.cssText = 'font-size:12px;padding:4px 10px;border-radius:6px;background:#f5f5f5;color:#666;display:inline-block;margin-bottom:4px;';
  previewBadge.textContent = '🔍 Verificando prévia do WhatsApp…';
  card.appendChild(previewBadge);

  function updatePreviewBadge(res) {
    if (!res) { previewBadge.style.display = 'none'; setCopyWarn(false); return; }
    if (res.hasLargePreview) {
      previewBadge.style.background = '#e8f5e9';
      previewBadge.style.color      = '#2e7d32';
      previewBadge.textContent      = '✅ Prévia grande — envie só o texto';
      setCopyWarn(false);                // prévia grande → botão verde
    } else if (res.hasMiniPreview) {
      previewBadge.style.background = '#fff3e0';
      previewBadge.style.color      = '#e65100';
      previewBadge.textContent      = '🖼️ Mini prévia — copie e envie a imagem junto';
      setCopyWarn(true);                 // precisa da imagem → botão vermelho
    } else {
      previewBadge.style.background = '#fce4ec';
      previewBadge.style.color      = '#c62828';
      previewBadge.textContent      = '⚠️ Sem prévia — copie e envie a imagem junto';
      setCopyWarn(true);                 // precisa da imagem → botão vermelho
    }
  }

  // Pinta o botão "Copiar texto": verde só com prévia grande, vermelho nos demais.
  function setCopyWarn(warn) {
    if (typeof btnCopy === 'undefined' || !btnCopy) return;
    btnCopy.classList.toggle('promos-btn-copy-warn', warn);
  }

  function checkPreview(url) {
    if (!url || /sub_id=/.test(url)) { previewBadge.style.display = 'none'; return; }
    chrome.runtime.sendMessage({ action: 'checkLinkPreview', url }, res => {
      if (chrome.runtime.lastError) { previewBadge.style.display = 'none'; return; }
      updatePreviewBadge(res);
    });
  }
  checkPreview(currentAffiliateUrl);

  // ── Image area ────────────────────────────────────────────────────────────
  const imageArea = document.createElement('div');
  imageArea.className = 'promos-image-area';
  buildImageArea(imageArea, data.imageUrl);
  card.appendChild(imageArea);

  // ── Vídeo do produto (para reels) ──────────────────────────────────────────
  if (parsed?.videoUrl) {
    const videoWrap = document.createElement('div');
    videoWrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-bottom:4px;';

    const btnVideo = document.createElement('button');
    btnVideo.textContent = '🎬 Baixar vídeo (reel)';
    btnVideo.style.cssText = 'width:100%;padding:8px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;';
    btnVideo.title = parsed.videoUrl;

    const convHint = document.createElement('div');
    convHint.style.cssText = 'font-size:11px;color:#666;display:none;';
    convHint.innerHTML = 'Arquivo <b>.ts</b> baixado. Converta p/ MP4 em ' +
      '<a href="https://convertio.co/pt/conversor-mp4/" target="_blank" style="color:#7c3aed;">convertio.co</a> antes de postar.';

    btnVideo.addEventListener('click', async () => {
      btnVideo.textContent = '⏳ Baixando vídeo…';
      btnVideo.disabled = true;
      try {
        await downloadReelVideo(parsed.videoUrl, parsed.name);
        btnVideo.textContent = '✅ Vídeo baixado!';
        convHint.style.display = 'block';
      } catch (e) {
        console.warn('[Promos] download reel falhou:', e);
        btnVideo.textContent = '❌ Falhou — ver console';
      }
      setTimeout(() => { btnVideo.textContent = '🎬 Baixar vídeo (reel)'; btnVideo.disabled = false; }, 3000);
    });

    videoWrap.appendChild(btnVideo);
    videoWrap.appendChild(convHint);
    card.appendChild(videoWrap);
  }

  // ── Seletor de emoji ─────────────────────────────────────────────────────
  const emojiOptions = getEmojiOptions(parsed, currentGroup);
  const emojiRow = buildEmojiPicker(emojiOptions, data.postText, onEmojiPick);
  if (emojiOptions.length > 1) card.appendChild(emojiRow);

  // ── Cupom ─────────────────────────────────────────────────────────────────
  const couponRow = buildCouponRow(
    parsed?.coupon    || '',
    parsed?.couponPct || '',
    parsed?.couponMin || '',
    parsed?.pricePor  || null,
    onCouponChange
  );
  card.appendChild(couponRow);

  // ── Textarea ──────────────────────────────────────────────────────────────
  const textarea = document.createElement('textarea');
  textarea.className = 'promos-textarea';
  textarea.value = data.postText || '';
  textarea.spellcheck = false;
  card.appendChild(textarea);

  // ── Frase de chamada (hook) ───────────────────────────────────────────────
  // Campo opcional no topo do post. Editar aqui reconstrói o texto. (Passo 1:
  // manual; o banco de frases e a geração por IA entram nos próximos passos.)
  const hookWrap = document.createElement('div');
  hookWrap.style.cssText = 'margin-bottom:6px;';
  const hookLabel = document.createElement('div');
  hookLabel.textContent = '✨ Frase de chamada (opcional)';
  hookLabel.style.cssText = 'font-size:12px;color:var(--promos-text-muted,#666);margin-bottom:3px;';
  hookWrap.appendChild(hookLabel);
  const hookInput = document.createElement('input');
  hookInput.type = 'text';
  hookInput.placeholder = 'ex: CHEGA DE VARRER A CASA!';
  hookInput.value = parsed.hook || '';
  hookInput.style.cssText = 'width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--promos-border,#ccc);border-radius:6px;font-size:13px;';

  function applyHook(text) {
    hookInput.value = text;
    parsed.hook = text;
    textarea.value = window.PromosTemplate.build(parsed, currentAffiliateUrl, currentGroup);
  }
  hookInput.addEventListener('input', () => applyHook(hookInput.value));
  hookWrap.appendChild(hookInput);

  // ── Combobox compacto de frases salvas (Categoria + Gerais via optgroup) ──
  const phraseSelect = document.createElement('select');
  phraseSelect.style.cssText = 'width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid var(--promos-border,#ccc);border-radius:6px;font-size:12px;margin-top:6px;background:#fff;color:#000;';
  phraseSelect.addEventListener('change', () => {
    if (phraseSelect.value) applyHook(phraseSelect.value);
    phraseSelect.selectedIndex = 0; // volta ao placeholder
  });
  hookWrap.appendChild(phraseSelect);

  // ── Busca em TODAS as frases salvas (acha frase de marca espalhada) ───────
  const phraseSearch = document.createElement('input');
  phraseSearch.type = 'text';
  phraseSearch.placeholder = '🔍 Buscar frase salva (ex: adidas)…';
  phraseSearch.style.cssText = 'width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid var(--promos-border,#ccc);border-radius:6px;font-size:12px;margin-top:4px;background:#fff;color:#000;';
  hookWrap.appendChild(phraseSearch);

  const phraseSearchResults = document.createElement('div');
  phraseSearchResults.style.cssText = 'display:none;flex-wrap:wrap;gap:6px;margin-top:4px;';
  hookWrap.appendChild(phraseSearchResults);

  phraseSearch.addEventListener('input', async () => {
    const q = phraseSearch.value.trim();
    phraseSearchResults.innerHTML = '';
    if (q.length < 2) { phraseSearchResults.style.display = 'none'; return; }
    const hits = await window.PromosStore.searchPhrases(currentGroup, q).catch(() => []);
    if (!hits.length) {
      phraseSearchResults.style.display = 'block';
      phraseSearchResults.style.cssText += ';font-size:12px;color:var(--promos-text-muted,#888);';
      phraseSearchResults.textContent = 'Nenhuma frase encontrada.';
      return;
    }
    phraseSearchResults.style.display = 'flex';
    for (const phrase of hits) {
      const chip = document.createElement('span');
      chip.style.cssText = 'display:inline-flex;align-items:center;padding:3px 8px;background:#f0f0f0;color:#222;border:1px solid #ccc;border-radius:14px;font-size:12px;cursor:pointer;max-width:100%;';
      chip.textContent = phrase;
      chip.title = 'Usar esta frase';
      chip.addEventListener('click', () => {
        applyHook(phrase);
        phraseSearch.value = '';
        phraseSearchResults.innerHTML = '';
        phraseSearchResults.style.display = 'none';
      });
      phraseSearchResults.appendChild(chip);
    }
  });

  // Gerenciamento (promover/remover) sob demanda — escondido por padrão.
  const manageToggle = document.createElement('button');
  manageToggle.type = 'button';
  manageToggle.textContent = '⚙ gerenciar frases';
  manageToggle.style.cssText = 'align-self:flex-start;background:none;border:none;color:var(--promos-text-muted,#888);font-size:11px;cursor:pointer;padding:2px 0;margin-top:2px;';
  hookWrap.appendChild(manageToggle);

  const manageWrap = document.createElement('div');
  manageWrap.style.display = 'none';

  const chipLabelCss = 'font-size:11px;color:var(--promos-text-muted,#888);margin-top:6px;';
  const chipRowCss   = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:3px;';

  const catLabel = document.createElement('div');
  catLabel.textContent = '🏷️ Da categoria';
  catLabel.style.cssText = chipLabelCss;
  const chipsRow = document.createElement('div');
  chipsRow.style.cssText = chipRowCss;

  const generalLabel = document.createElement('div');
  generalLabel.textContent = '🌐 Gerais';
  generalLabel.style.cssText = chipLabelCss;
  const generalRow = document.createElement('div');
  generalRow.style.cssText = chipRowCss;

  const reviewLabel = document.createElement('div');
  reviewLabel.textContent = '🔎 A revisar (garimpo)';
  reviewLabel.style.cssText = chipLabelCss;
  const reviewRow = document.createElement('div');
  reviewRow.style.cssText = chipRowCss;

  manageWrap.appendChild(reviewLabel);
  manageWrap.appendChild(reviewRow);
  manageWrap.appendChild(catLabel);
  manageWrap.appendChild(chipsRow);
  manageWrap.appendChild(generalLabel);
  manageWrap.appendChild(generalRow);
  hookWrap.appendChild(manageWrap);

  manageToggle.addEventListener('click', () => {
    const show = manageWrap.style.display === 'none';
    manageWrap.style.display = show ? '' : 'none';
    manageToggle.textContent = show ? '⚙ ocultar gerenciamento' : '⚙ gerenciar frases';
  });

  // Botão de geração por IA + linha de sugestões frescas.
  const aiBar = document.createElement('div');
  aiBar.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:6px;';
  const btnGen = document.createElement('button');
  btnGen.textContent = '✨ Gerar nova com IA';
  btnGen.style.cssText = 'align-self:flex-start;padding:5px 10px;background:#6b4cf0;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;';
  const aiRow = document.createElement('div');
  aiRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
  aiBar.appendChild(btnGen);
  aiBar.appendChild(aiRow);
  hookWrap.appendChild(aiBar);

  btnGen.addEventListener('click', async () => {
    btnGen.disabled = true;
    const label = btnGen.textContent;
    btnGen.textContent = '⏳ Gerando…';
    aiRow.innerHTML = '';
    aiRow.style.color = '';
    const payload = {
      name: parsed.name, pricePor: parsed.pricePor, priceDe: parsed.priceDe,
      discount: parsed.discount, category: parsed.category,
    };
    // Few-shot: manda as frases já aprovadas (categoria + gerais) como exemplo
    // de estilo. A IA aprende o tom do próprio usuário.
    const [exCat, exGer] = await Promise.all([
      window.PromosStore.getPhrases(currentGroup, parsed).catch(() => []),
      window.PromosStore.getGeneralPhrases(currentGroup).catch(() => []),
    ]);
    const examples = [...exCat, ...exGer].slice(0, 8);
    const res = await new Promise(r =>
      chrome.runtime.sendMessage({ action: 'generateHook', parsed: payload, group: currentGroup, examples }, r)
    ).catch(() => null);
    btnGen.disabled = false;
    btnGen.textContent = label;

    if (!res || res.error) {
      const map = {
        'sem-chave': 'Configure a chave da API Anthropic nas Opções da extensão.',
        'sem-frases': 'A IA não retornou frases válidas — tente de novo.',
      };
      aiRow.style.color = '#cf222e';
      aiRow.style.fontSize = '12px';
      aiRow.textContent = '⚠️ ' + (map[res?.error] || `Falhou (${res?.error || 'erro'}). ${res?.detail || ''}`);
      return;
    }
    for (const phrase of res.phrases) {
      const chip = document.createElement('span');
      chip.style.cssText = 'display:inline-flex;align-items:center;padding:3px 8px;background:#efeaff;color:#3a2b8c;border:1px solid #c9bdf5;border-radius:14px;font-size:12px;cursor:pointer;max-width:100%;';
      chip.textContent = '✨ ' + phrase;
      chip.title = 'Usar esta frase (salva no banco ao copiar/enviar)';
      chip.addEventListener('click', () => applyHook(phrase));
      aiRow.appendChild(chip);
    }
  });

  // Monta um chip de frase com ações (🌐 promover, × remover).
  function makeChip(phrase, actions) {
    const chip = document.createElement('span');
    chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#f0f0f0;color:#222;border:1px solid #ccc;border-radius:14px;font-size:12px;cursor:pointer;max-width:100%;';
    const txt = document.createElement('span');
    txt.textContent = phrase;
    txt.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;';
    txt.title = 'Usar esta frase';
    txt.addEventListener('click', () => applyHook(phrase));
    chip.appendChild(txt);
    for (const a of actions) {
      const b = document.createElement('span');
      b.textContent = a.icon;
      b.title = a.title;
      b.style.cssText = 'cursor:pointer;padding:0 2px;font-weight:700;' + (a.color ? `color:${a.color};` : '');
      b.addEventListener('click', (e) => { e.stopPropagation(); a.run(); });
      chip.appendChild(b);
    }
    return chip;
  }

  async function renderPhraseChips() {
    const [gerais0, daCategoria0, aRevisar0] = await Promise.all([
      window.PromosStore.getGeneralPhrases(currentGroup).catch(() => []),
      window.PromosStore.getPhrases(currentGroup, parsed).catch(() => []),
      window.PromosStore.getReviewPhrases(currentGroup, parsed).catch(() => []),
    ]);
    // Ordem alfabética (pt-BR, ignora maiúsc/acento) para exibição.
    const sortPt = arr => arr.slice().sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
    const gerais      = sortPt(gerais0);
    const daCategoria = sortPt(daCategoria0);
    const aRevisar    = sortPt(aRevisar0);

    // A revisar (garimpo) — aprovar (✓ vira oficial) ou rejeitar (×).
    reviewRow.innerHTML = '';
    const showRev = aRevisar.length > 0;
    reviewLabel.style.display = showRev ? '' : 'none';
    reviewRow.style.display   = showRev ? 'flex' : 'none';
    for (const phrase of aRevisar) {
      reviewRow.appendChild(makeChip(phrase, [
        { icon: '✓', title: 'Aprovar (vira sugestão oficial da categoria)', color: '#1a7f37', run: async () => {
          await window.PromosStore.approveReviewPhrase(currentGroup, parsed, phrase).catch(() => {});
          renderPhraseChips();
        } },
        { icon: '×', title: 'Descartar', color: '#cf222e', run: async () => {
          await window.PromosStore.removeReviewPhrase(currentGroup, parsed, phrase).catch(() => {});
          renderPhraseChips();
        } },
      ]));
    }

    // Gerais (sempre, qualquer produto) — só ação de remover.
    generalRow.innerHTML = '';
    const showGer = gerais.length > 0;
    generalLabel.style.display = showGer ? '' : 'none';
    generalRow.style.display   = showGer ? 'flex' : 'none';
    for (const phrase of gerais) {
      generalRow.appendChild(makeChip(phrase, [
        { icon: '⤵️', title: 'Despromover (voltar pra categoria deste produto)', run: async () => {
          await window.PromosStore.demoteToCategory(currentGroup, parsed, phrase).catch(() => {});
          renderPhraseChips();
        } },
        { icon: '×', title: 'Remover do banco', color: '#cf222e', run: async () => {
          await window.PromosStore.removeGeneralPhrase(currentGroup, phrase).catch(() => {});
          renderPhraseChips();
        } },
      ]));
    }

    // Da categoria — ações de promover (🌐) e remover (×).
    chipsRow.innerHTML = '';
    const showCat = daCategoria.length > 0;
    catLabel.style.display = showCat ? '' : 'none';
    chipsRow.style.display = showCat ? 'flex' : 'none';
    for (const phrase of daCategoria) {
      chipsRow.appendChild(makeChip(phrase, [
        { icon: '🌐', title: 'Tornar geral (usar em qualquer produto)', run: async () => {
          await window.PromosStore.promoteToGeneral(currentGroup, parsed, phrase).catch(() => {});
          renderPhraseChips();
        } },
        { icon: '×', title: 'Remover do banco', color: '#cf222e', run: async () => {
          await window.PromosStore.removePhrase(currentGroup, parsed, phrase).catch(() => {});
          renderPhraseChips();
        } },
      ]));
    }

    // Popula o combobox (Categoria + Gerais via optgroup).
    phraseSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.style.color = '#000';
    placeholder.textContent = (daCategoria.length || gerais.length || aRevisar.length)
      ? '✨ Usar frase salva…'
      : '✨ Nenhuma frase salva ainda';
    phraseSelect.appendChild(placeholder);

    const addGroup = (label, list) => {
      if (!list.length) return;
      const og = document.createElement('optgroup');
      og.label = label;
      og.style.color = '#000';
      for (const phrase of list) {
        const opt = document.createElement('option');
        opt.value = phrase;
        opt.textContent = phrase;
        opt.style.color = '#000';
        og.appendChild(opt);
      }
      phraseSelect.appendChild(og);
    };
    addGroup('📂 Desta categoria', daCategoria);
    addGroup('🌐 Gerais', gerais);
    addGroup('🔎 A revisar (garimpo)', aRevisar);

    // Sinaliza no botão de gerenciar quantas há pra revisar (quando fechado).
    if (manageWrap.style.display !== 'none') {
      manageToggle.textContent = '⚙ ocultar gerenciamento';
    } else {
      manageToggle.textContent = aRevisar.length
        ? `⚙ gerenciar frases · ${aRevisar.length} a revisar`
        : '⚙ gerenciar frases';
    }
  }
  // Exposto para re-render ao trocar de grupo (a chave de grupo muda o banco).
  window.__promosRenderPhraseChips = renderPhraseChips;
  renderPhraseChips();

  card.insertBefore(hookWrap, textarea);

  // Salva a frase no banco quando o post é efetivamente usado (copiar/enviar).
  function savePhraseIfAny() {
    const h = (parsed.hook || '').trim();
    if (h) window.PromosStore.addPhrase(currentGroup, parsed, h).then(renderPhraseChips).catch(() => {});
  }

  // Finaliza o item da fila SÓ quando o post é realmente usado (copiar/enviar).
  // Aprovar apenas ABRE o post; se algo falhar/fechar antes de postar, o item
  // continua na fila (vale para todos os marketplaces). Roda uma vez só.
  // Ao copiar/enviar: marca o item como APROVADO por este grupo, mas NÃO tira
  // da fila (você descarta na mão depois). Pode marcar os DOIS grupos se você
  // trocar o grupo no overlay e copiar de novo. Só o 🗑️ Descartar remove.
  function finalizeQueueItem() {
    if (!data.candidate || !window.PromosStore) return;
    const cand = data.candidate;
    window.PromosStore.addToHistory({ ...cand, ...parsed }, currentGroup).catch(() => {});
    window.PromosStore.markSent(cand, currentGroup, false).catch(() => {});
  }

  // ── Geração automática + botão de retry para Shopee ──────────────────────
  // (deve ficar após `textarea` ser criado, pois a callback usa textarea.value)
  if (parsed.site === 'shopee' && (!currentAffiliateUrl || /sub_id=/.test(currentAffiliateUrl))) {
    const btnShopee = document.createElement('button');
    btnShopee.textContent = '⏳ Gerando link Shopee…';
    btnShopee.style.cssText = 'width:100%;padding:8px;background:#EE4D2D;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;margin-top:4px;opacity:0.7;';
    btnShopee.disabled = true;
    card.appendChild(btnShopee);

    function gerarLinkShopee() {
      btnShopee.textContent = '⏳ Gerando link Shopee…';
      btnShopee.disabled = true;
      btnShopee.style.opacity = '0.7';
      const productUrl = location.href.split('?')[0];
      const subId = window.PromosConfig?.GROUPS[currentGroup]?.shopeeSubId || 'KateWhatsApp';
      chrome.runtime.sendMessage({ action: 'generateShopeeLink', productUrl, subId }, res => {
        if (res?.link) {
          currentAffiliateUrl = res.link;
          textarea.value = window.PromosTemplate.build(parsed, currentAffiliateUrl, currentGroup);
          btnShopee.textContent = '✅ Link Shopee gerado!';
          btnShopee.style.opacity = '1';
          const missing = (parsed.missing || []).filter(m => !/shopee/i.test(m));
          setWarning(warn, missing);
          previewBadge.style.display = 'inline-block';
          previewBadge.textContent = '🔍 Verificando prévia…';
          checkPreview(currentAffiliateUrl);
          setTimeout(() => {
            btnShopee.textContent = '🔄 Regenerar link Shopee';
            btnShopee.disabled = false;
          }, 3000);
        } else {
          btnShopee.textContent = '❌ Falhou — tentar novamente';
          btnShopee.disabled = false;
          btnShopee.style.opacity = '1';
        }
      });
    }

    btnShopee.addEventListener('click', gerarLinkShopee);
    gerarLinkShopee();
  }

  // ── Botão de retry para o Mercado Livre ──────────────────────────────────
  // A captura automática (botão Compartilhar → meli.la) às vezes falha se a
  // barra de afiliado demorou a renderizar. Mostra um botão para tentar de novo
  // SEM precisar recarregar a página. Aparece só quando o link não foi gerado.
  if (parsed.site === 'mercadolivre' && (!currentAffiliateUrl || !/meli\.la\//.test(currentAffiliateUrl))) {
    const btnMeli = document.createElement('button');
    btnMeli.textContent = '🔄 Tentar capturar link do Mercado Livre';
    btnMeli.style.cssText = 'width:100%;padding:8px;background:#FFE600;color:#2D3277;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;margin-top:4px;';
    card.appendChild(btnMeli);

    btnMeli.addEventListener('click', async () => {
      btnMeli.disabled = true;
      btnMeli.style.opacity = '0.7';
      let url = '';
      // A barra pode estar atrasada: tenta algumas vezes (cada chamada já clica
      // em Compartilhar e aguarda o meli.la aparecer; só repete se vier fallback).
      for (let i = 0; i < 5 && !url; i++) {
        btnMeli.textContent = `⏳ Clicando em Compartilhar… (${i + 1})`;
        try {
          const r = await window.PromosAffiliate.mercadolivre();
          if (r && !r.isFallback && r.url) { url = r.url; break; }
        } catch (_) {}
        await new Promise(res => setTimeout(res, 2000));
      }

      if (url) {
        currentAffiliateUrl = url;
        textarea.value = window.PromosTemplate.build(parsed, currentAffiliateUrl, currentGroup);
        btnMeli.textContent = '✅ Link capturado!';
        btnMeli.style.opacity = '1';
        const missing = (parsed.missing || []).filter(m => !/meli|afiliad|compartilhar/i.test(m));
        setWarning(warn, missing);
        previewBadge.style.display = 'inline-block';
        previewBadge.textContent = '🔍 Verificando prévia…';
        checkPreview(currentAffiliateUrl);
        setTimeout(() => { btnMeli.textContent = '🔄 Capturar novamente'; btnMeli.disabled = false; }, 3000);
      } else {
        btnMeli.textContent = '❌ Não capturou — confira a barra de afiliado e tente de novo';
        btnMeli.disabled = false;
        btnMeli.style.opacity = '1';
      }
    });
  }

  // ── Feedback ──────────────────────────────────────────────────────────────
  const feedback = document.createElement('div');
  feedback.className = 'promos-copy-feedback';
  card.appendChild(feedback);

  // ── Botões de ação ────────────────────────────────────────────────────────
  const actions = document.createElement('div');
  actions.className = 'promos-actions';
  const btnCopy = makeBtn('📋 Copiar texto', 'promos-btn promos-btn-primary');
  const btnTG   = makeBtn('✈️ Copiar p/ Telegram', 'promos-btn promos-btn-secondary');
  const btnWA   = makeBtn('📲 Enviar p/ WA', 'promos-btn promos-btn-secondary');
  const btnIG   = makeBtn('📸 Post IG', 'promos-btn promos-btn-secondary');
  actions.appendChild(btnCopy);
  actions.appendChild(btnTG);
  actions.appendChild(btnWA);
  actions.appendChild(btnIG);
  card.appendChild(actions);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const PLACEHOLDER_RE = /<[a-z_]+>/i;

  btnCopy.addEventListener('click', () => {
    const text = textarea.value;
    if (PLACEHOLDER_RE.test(text)) {
      showFeedback(feedback, '⚠️ Texto contém placeholders não preenchidos!');
      return;
    }
    navigator.clipboard.writeText(text)
      .then(() => { savePhraseIfAny(); finalizeQueueItem(); showFeedback(feedback, '✅ Copiado!'); })
      .catch(() => showFeedback(feedback, '❌ Falha ao copiar'));
  });

  // Copia o post no formato Telegram (sem * ~, rodapé do canal, link clicável).
  btnTG.addEventListener('click', () => {
    const text = textarea.value;
    if (PLACEHOLDER_RE.test(text)) {
      showFeedback(feedback, '⚠️ Texto contém placeholders não preenchidos!');
      return;
    }
    const tg = window.PromosTemplate.toTelegram(text, currentGroup);
    if (!tg) {
      showFeedback(feedback, 'ℹ️ Este grupo ainda não tem canal de Telegram.');
      return;
    }
    navigator.clipboard.writeText(tg)
      .then(() => { savePhraseIfAny(); finalizeQueueItem(); showFeedback(feedback, '✈️ Copiado p/ Telegram! Cole no canal.'); })
      .catch(() => showFeedback(feedback, '❌ Falha ao copiar'));
  });

  btnWA.addEventListener('click', async () => {
    const text = textarea.value;
    if (PLACEHOLDER_RE.test(text)) {
      showFeedback(feedback, '⚠️ Texto contém placeholders não preenchidos!');
      return;
    }
    // Copia o texto (clipboard é do SISTEMA — compartilhado entre perfis do Chrome).
    try {
      await navigator.clipboard.writeText(text);
      savePhraseIfAny();
      finalizeQueueItem();
    } catch (_) {
      showFeedback(feedback, '❌ Falha ao copiar');
      return;
    }

    // O WhatsApp fica logado no perfil principal (Kate). Se este overlay está
    // rodando no perfil secundário (Musculosas, afiliado-only), abre o WhatsApp
    // no perfil da Kate via ponte nativa — focar a aba local não adianta (lá não
    // tem WhatsApp).
    const cfg = await chrome.storage.local.get(['profileGroup', 'otherProfileDir', 'chromePath']);
    const isSecondary = cfg.profileGroup && cfg.profileGroup !== 'kate' && cfg.otherProfileDir;

    if (isSecondary) {
      chrome.runtime.sendMessage({
        action: 'openInOtherProfile',
        url: 'https://web.whatsapp.com/',
        profileDir: cfg.otherProfileDir,
        chromePath: cfg.chromePath || '',
      }, res => {
        showFeedback(feedback, res?.ok
          ? '✅ Copiado! Abrindo WhatsApp no perfil da Kate — cole no grupo (Ctrl+V)'
          : '✅ Copiado! Abra o WhatsApp no perfil da Kate e cole (Ctrl+V)');
      });
      return;
    }

    // Perfil principal: foca a aba do WhatsApp já aberta neste perfil.
    chrome.runtime.sendMessage({ action: 'focusWhatsApp' }, res => {
      showFeedback(feedback, res?.found
        ? '✅ Copiado! Clique no grupo e cole (Ctrl+V)'
        : '✅ Copiado! Abra o WhatsApp e cole (Ctrl+V)');
    });
  });

  btnIG.addEventListener('click', () => {
    const imgEl = imageArea.querySelector('img');
    // A textarea é a fonte da verdade: capta tudo que o usuário editou (nome,
    // preços, cupom, link). Mescla sobre `parsed` para não perder category etc.
    const edited = parsePostText(textarea.value);
    const mergedParsed = { ...parsed, ...edited };
    const affiliateUrl = edited.affiliateUrl || currentAffiliateUrl;
    window.PromosInstagram?.showIGPanel({
      group:        currentGroup,
      parsed:       mergedParsed,
      affiliateUrl,
      imageEl:      imgEl,                        // imagem do overlay (WhatsApp ou marketplace)
      imageUrlAlt:  data.imageUrlMarket || '',    // imagem da página do marketplace
    });
  });

  const btnCopyImg = imageArea.querySelector('.js-copy-img');
  const btnDownload = imageArea.querySelector('.js-download-img');
  if (btnCopyImg) {
    btnCopyImg.addEventListener('click', async () => {
      const img = imageArea.querySelector('img');
      if (!img) return;
      try {
        const blob = await imgToBlob(img);
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        showFeedback(feedback, '✅ Imagem copiada!');
      } catch { showFeedback(feedback, '❌ Não foi possível copiar a imagem'); }
    });
  }
  if (btnDownload) {
    btnDownload.addEventListener('click', async () => {
      const img = imageArea.querySelector('img');
      if (!img) return;
      try {
        const blob = await imgToBlob(img);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'produto.png'; a.click();
        URL.revokeObjectURL(url);
      } catch { showFeedback(feedback, '❌ Não foi possível baixar'); }
    });
  }

  // ── Troca de grupo ────────────────────────────────────────────────────────
  async function handleGroupSwitch(newGroup) {
    if (newGroup === currentGroup) return;
    currentGroup = newGroup;

    // Atualiza o tema visual (cor do grupo) e o título
    card.dataset.group = currentGroup;
    titleEl.textContent = window.PromosConfig.GROUPS[currentGroup]?.name || 'Promos';

    // Atualiza visual dos botões
    groupSelector.querySelectorAll('[data-group-id]').forEach(btn => {
      btn.className = `promos-btn promos-btn-sm ${btn.dataset.groupId === currentGroup ? 'promos-btn-group-active' : 'promos-btn-group'}`;
    });

    // O banco de frases é por grupo → re-renderiza os chips para o novo grupo
    window.__promosRenderPhraseChips?.();

    // Se não temos dados do parsed, só atualiza o rodapé no texto existente
    if (!parsed) {
      const cfg = groups[currentGroup];
      const lines = textarea.value.split('\n');
      // Substitui a última linha (rodapé)
      const lastNonEmpty = lines.reduceRight((acc, l, i) => acc === -1 && l.trim() ? i : acc, -1);
      if (lastNonEmpty >= 0) lines[lastNonEmpty] = cfg.footer;
      textarea.value = lines.join('\n');
      return;
    }

    // Com parsed disponível: refaz affiliate + template
    textarea.disabled = true;
    textarea.value = '⏳ Gerando link para ' + groups[currentGroup].name + '...';

    try {
      // Para ML reutiliza o mesmo link (canal é placeholder; só o rodapé muda)
      let newAffiliateUrl = currentAffiliateUrl;
      const newMissing = [...(parsed.missing || [])];

      if (parsed.site === 'amazon') {
        const r = await window.PromosAffiliate.amazon(parsed.asin, currentGroup);
        newAffiliateUrl = r.url;
        if (r.missingTrackingId) {
          newMissing.push('tracking ID Amazon não configurado — adicione em lib/config.js');
        } else if (r.isFallback) {
          newMissing.push('link SiteStripe — usando link longo');
        }
      } else if (parsed.site === 'shopee') {
        const r = window.PromosAffiliate.shopee(parsed, currentGroup);
        newAffiliateUrl = r.url;
        if (r.isFallback) newMissing.push('link Shopee — cole o link do painel');
      }

      currentAffiliateUrl = newAffiliateUrl;
      textarea.value = window.PromosTemplate.build(parsed, newAffiliateUrl, currentGroup);
      setWarning(warn, newMissing);
    } catch (err) {
      showFeedback(feedback, '❌ Erro ao gerar link: ' + err.message);
      textarea.value = data.postText || '';
    } finally {
      textarea.disabled = false;
      textarea.focus();
    }
  }

  // ── Atualização de cupom ──────────────────────────────────────────────────
  function onCouponChange(code, pct, minVal) {
    if (!parsed) return;
    parsed.coupon    = code   || null;
    parsed.couponPct = pct    || null;
    parsed.couponMin = minVal || null;
    // Editou o % → opta por aplicar o cupom no preço (senão "Por" = preço da fila)
    parsed.applyCoupon = !!pct;
    // Atualiza badge de validade no couponRow
    updateCouponBadge(couponRow, parsed.couponMin, parsed.pricePor, parsed.couponPct, parsed.coupon);
    textarea.value = window.PromosTemplate.build(parsed, data.affiliateUrl || '', currentGroup);
  }

  // ── Troca de emoji ────────────────────────────────────────────────────────
  function onEmojiPick(newEmoji) {
    parsed.openingEmoji = newEmoji;   // persiste a escolha p/ rebuilds (troca de frase/cupom)
    textarea.value = replaceEmojiInPost(textarea.value, newEmoji);
    // Atualiza destaque nos botões
    emojiRow.querySelectorAll('[data-emoji]').forEach(btn => {
      const active = btn.dataset.emoji === newEmoji;
      btn.className = `promos-btn promos-btn-sm promos-btn-emoji${active ? ' promos-btn-emoji-active' : ''}`;
    });
  }

  // ── Mount ─────────────────────────────────────────────────────────────────
  backdrop.appendChild(card);
  document.body.appendChild(backdrop);
  textarea.focus();
}

function removeOverlay() {
  document.getElementById('promos-overlay')?.remove();
  document.getElementById('promos-restore-chip')?.remove();
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Baixa o vídeo do produto para reel.
 * ML serve HLS (.m3u8): baixa master → melhor variante → segmentos .ts, junta
 * tudo e dispara o download. Roda no content script (tem URL.createObjectURL e,
 * na página do ML, CORS para o mlstatic). .mp4 direto: baixa direto.
 */
async function downloadReelVideo(videoUrl, productName) {
  const slug = (productName || 'reel')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '_').slice(0, 50) || 'reel';

  if (/\.m3u8(\?|$)/i.test(videoUrl)) {
    // Master playlist → melhor variante
    const mtxt = await (await fetch(videoUrl)).text();
    let mediaUrl = videoUrl;
    if (mtxt.includes('#EXT-X-STREAM-INF')) {
      const mlines = mtxt.split('\n').map(l => l.trim()).filter(Boolean);
      let bestUrl = null, bestBw = -1;
      for (let i = 0; i < mlines.length; i++) {
        if (mlines[i].startsWith('#EXT-X-STREAM-INF')) {
          const bw = +(mlines[i].match(/BANDWIDTH=(\d+)/) || [])[1] || 0;
          if (bw > bestBw) { bestBw = bw; bestUrl = new URL(mlines[i + 1], videoUrl).href; }
        }
      }
      if (!bestUrl) throw new Error('variante HLS não encontrada');
      mediaUrl = bestUrl;
    }
    // Sub-playlist → segmentos
    const vtxt = await (await fetch(mediaUrl)).text();
    const segs = vtxt.split('\n').map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(s => new URL(s, mediaUrl).href);
    if (!segs.length) throw new Error('nenhum segmento HLS');

    const buffers = await Promise.all(segs.map(u => fetch(u).then(r => r.arrayBuffer())));
    const total = buffers.reduce((s, b) => s + b.byteLength, 0);
    const merged = new Uint8Array(total);
    let off = 0;
    for (const b of buffers) { merged.set(new Uint8Array(b), off); off += b.byteLength; }
    // MPEG-TS concatenado — salvo como .ts; a conversão p/ MP4 é feita no
    // Convertio (https://convertio.co/pt/conversor-mp4/). Remux em JS (mux.js)
    // quebrava a sincronização deste stream (áudio-só / duração errada).
    return downloadBlob(new Blob([merged], { type: 'video/mp2t' }), `promos-reel-${slug}.ts`);
  }

  // .mp4 direto (caso o marketplace mude o formato)
  return downloadBlob(await (await fetch(videoUrl)).blob(), `promos-reel-${slug}.mp4`);
}

function downloadBlob(blob, filename) {
  const objUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 10000);
}

function buildImageArea(container, imageUrl) {
  if (imageUrl) {
    const img = document.createElement('img');
    img.className = 'promos-thumb';
    img.alt = 'Imagem do produto';
    container.appendChild(img);
    img.onerror = () => {
      const ph = document.createElement('div');
      ph.className = 'promos-thumb-placeholder';
      ph.textContent = 'imagem indisponível';
      img.replaceWith(ph);
      container.querySelectorAll('.js-copy-img, .js-download-img').forEach(b => {
        b.disabled = true;
        b.style.opacity = '0.4';
      });
    };

    if (/^(data|blob):/.test(imageUrl)) {
      img.src = imageUrl; // já exibível (foto capturada do preview)
    } else {
      // Busca via SW → data: URL. Contorna a CSP do WhatsApp Web e evita canvas
      // "tainted" (assim Copiar/Baixar imagem funcionam). Fallback: src direto.
      chrome.runtime.sendMessage({ action: 'fetchImage', url: imageUrl }, res => {
        if (!chrome.runtime.lastError && res?.dataUrl) {
          img.src = res.dataUrl;
        } else {
          img.crossOrigin = 'anonymous';
          img.src = imageUrl;
        }
      });
    }
  } else {
    const ph = document.createElement('div');
    ph.className = 'promos-thumb-placeholder';
    ph.textContent = 'sem imagem';
    container.appendChild(ph);
  }

  const imgBtns = document.createElement('div');
  imgBtns.className = 'promos-image-buttons';

  const btnCopyImg = makeBtn('📋 Copiar imagem', 'promos-btn promos-btn-secondary promos-btn-sm js-copy-img');
  const btnDownload = makeBtn('⬇️ Baixar', 'promos-btn promos-btn-secondary promos-btn-sm js-download-img');

  if (!imageUrl) {
    [btnCopyImg, btnDownload].forEach(b => { b.disabled = true; b.style.opacity = '0.4'; });
  }
  imgBtns.appendChild(btnCopyImg);
  imgBtns.appendChild(btnDownload);
  container.appendChild(imgBtns);
}

// Torna um card arrastável. O drag só inicia no próprio card (não em inputs/botões).
// Ao arrastar pela 1ª vez, o card sai do fluxo flex e fica posicionado via left/top.
function makeDraggable(card) {
  let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;

  card.addEventListener('mousedown', e => {
    // Ignora cliques em inputs, botões, selects, textareas e links
    if (['INPUT','BUTTON','SELECT','TEXTAREA','A'].includes(e.target.tagName)) return;
    e.preventDefault();

    // Na primeira vez que arrastar: converte posição flex → posição absoluta fixa
    if (!card.style.left) {
      const r = card.getBoundingClientRect();
      card.style.position = 'fixed';
      card.style.margin   = '0';
      card.style.left     = r.left + 'px';
      card.style.top      = r.top  + 'px';
    }

    dragging = true;
    startX   = e.clientX;
    startY   = e.clientY;
    origLeft = parseFloat(card.style.left);
    origTop  = parseFloat(card.style.top);
    card.style.cursor = 'grabbing';
    card.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    card.style.left = Math.max(0, origLeft + e.clientX - startX) + 'px';
    card.style.top  = Math.max(0, origTop  + e.clientY - startY) + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    card.style.cursor    = '';
    card.style.userSelect = '';
  });

  // Cursor indica que o card é arrastável (exceto sobre controles)
  card.style.cursor = 'grab';
}

/** Escapa texto que vai para innerHTML (código de cupom vem do DOM da página). */
function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/** Formata número para R$ 1.234,56 (mesmo formato do post). */
function brl(n) {
  if (n == null) return '';
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function setWarning(el, missing) {
  if (missing && missing.length) {
    el.textContent = `⚠️ Não consegui extrair: ${missing.join(' | ')}. Preencha manualmente.`;
    el.classList.add('visible');
  } else {
    el.textContent = '';
    el.classList.remove('visible');
  }
}

function makeBtn(text, className) {
  const btn = document.createElement('button');
  btn.className = className;
  btn.innerHTML = text;
  return btn;
}

function showFeedback(el, msg) {
  el.textContent = msg;
  setTimeout(() => { el.textContent = ''; }, 2500);
}

// ── Coupon row ────────────────────────────────────────────────────────────

/**
 * Monta a linha de cupom com input de código e mínimo de compra.
 * onChange(code, minVal) é chamado a cada mudança.
 */
function buildCouponRow(initialCode, initialPct, initialMin, pricePor, onChange) {
  const row = document.createElement('div');
  row.className = 'promos-coupon-row';

  // ── Linha 1: código + % + preço final ────────────────────────────────────
  const line1 = document.createElement('div');
  line1.className = 'promos-coupon-line';

  const label = document.createElement('span');
  label.className = 'promos-emoji-label';
  label.textContent = '🎟️ Cupom:';
  line1.appendChild(label);

  const inputCode = document.createElement('input');
  inputCode.type        = 'text';
  inputCode.placeholder = 'Código';
  inputCode.value       = initialCode || '';
  inputCode.className   = 'promos-input-coupon';
  inputCode.spellcheck  = false;
  line1.appendChild(inputCode);

  const inputPct = document.createElement('input');
  inputPct.type        = 'number';
  inputPct.placeholder = '%';
  inputPct.value       = initialPct || '';
  inputPct.className   = 'promos-input-pct';
  inputPct.min         = '1';
  inputPct.max         = '99';
  inputPct.title       = 'Percentual de desconto do cupom';
  line1.appendChild(inputPct);

  const labelFinal = document.createElement('span');
  labelFinal.className   = 'promos-coupon-arrow';
  labelFinal.textContent = '→';
  labelFinal.title       = 'Preço final com cupom (preencha um dos dois)';
  line1.appendChild(labelFinal);

  const inputFinal = document.createElement('input');
  inputFinal.type        = 'number';
  inputFinal.placeholder = 'Preço final';
  inputFinal.className   = 'promos-input-final';
  inputFinal.min         = '0';
  inputFinal.step        = '0.01';
  inputFinal.title       = 'Preço final com cupom — calcula o % automaticamente';
  if (initialPct && pricePor) {
    inputFinal.value = (pricePor * (1 - initialPct / 100)).toFixed(2);
  }
  line1.appendChild(inputFinal);

  row.appendChild(line1);

  // ── Linha 2: mínimo + badge ───────────────────────────────────────────────
  const line2 = document.createElement('div');
  line2.className = 'promos-coupon-line';

  const labelMin = document.createElement('span');
  labelMin.className   = 'promos-emoji-label';
  labelMin.textContent = 'Mín:';
  labelMin.title       = 'Valor mínimo de compra para o cupom ser válido';
  line2.appendChild(labelMin);

  const inputMin = document.createElement('input');
  inputMin.type        = 'number';
  inputMin.placeholder = 'R$';
  inputMin.value       = initialMin || '';
  inputMin.className   = 'promos-input-min';
  inputMin.min         = '0';
  inputMin.step        = '0.01';
  line2.appendChild(inputMin);

  const badge = document.createElement('span');
  badge.className = 'promos-coupon-badge';
  line2.appendChild(badge);

  row.appendChild(line2);

  // Estado inicial do badge
  updateCouponBadge(row, initialMin || null, pricePor, initialPct || null, initialCode || null);

  // ── Sincronização % ↔ Preço final ─────────────────────────────────────────
  let syncing = false;

  inputPct.addEventListener('input', () => {
    if (syncing) return;
    syncing = true;
    const pct = parseFloat(inputPct.value);
    const por = parseFloat(pricePor);
    if (!isNaN(pct) && pct > 0 && !isNaN(por) && por > 0) {
      inputFinal.value = (por * (1 - pct / 100)).toFixed(2);
    } else {
      inputFinal.value = '';
    }
    syncing = false;
    notify();
  });

  inputFinal.addEventListener('input', () => {
    if (syncing) return;
    syncing = true;
    const final = parseFloat(inputFinal.value);
    const por   = parseFloat(pricePor);
    if (!isNaN(final) && final > 0 && !isNaN(por) && por > 0 && final < por) {
      inputPct.value = Math.round((1 - final / por) * 100);
    } else {
      inputPct.value = '';
    }
    syncing = false;
    notify();
  });

  // Debounce geral → onChange
  let timer;
  function notify() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const code   = inputCode.value.trim() || null;
      const pctRaw = parseFloat(inputPct.value);
      const minRaw = parseFloat(inputMin.value);
      const pct    = isNaN(pctRaw) || pctRaw <= 0 ? null : pctRaw;
      const minVal = isNaN(minRaw) || minRaw <= 0 ? null : minRaw;
      onChange(code, pct, minVal);
    }, 300);
  }

  inputCode.addEventListener('input', notify);
  inputMin.addEventListener('input',  notify);

  return row;
}

/**
 * Lê o texto editado da textarea e extrai os campos do post (nome, De, Por,
 * %, cupom, link). A textarea é a fonte da verdade do que o usuário vê: o
 * "Post IG" precisa refletir o que está nela, não o `parsed` original.
 * Só inclui no objeto os campos efetivamente encontrados — `coupon` é sempre
 * definido (null quando a linha do cupom foi removida), para honrar remoção.
 */
function parsePostText(text) {
  const out = {};
  if (!text) return out;
  const lines = text.split('\n');
  const brl = s => parseFloat(String(s).replace(/\./g, '').replace(',', '.'));

  // ── Cupom (linha com 🎟) ──────────────────────────────────────────────────
  const couponLine = lines.find(l => /🎟/.test(l));
  if (couponLine) {
    const mb = couponLine.match(/\*([^*]+)\*/);
    const raw = mb
      ? mb[1]
      : couponLine.replace(/🎟️?/g, '').replace(/cupom\s*:?/i, '');
    out.coupon = raw.replace(/\*/g, '').trim() || null;
  } else {
    out.coupon = null; // cupom removido do texto
  }

  // ── Preços De/Por ─────────────────────────────────────────────────────────
  const de  = text.match(/\bde\s*:?\s*R\$\s*([\d.]+,\d{2})/i);
  const por = text.match(/\bpor\s*:?\s*R\$\s*([\d.]+,\d{2})/i);
  if (de)  out.priceDe  = brl(de[1]);
  if (por) out.pricePor = brl(por[1]);
  if (out.priceDe && out.pricePor && out.priceDe > out.pricePor) {
    out.discount = Math.round((1 - out.pricePor / out.priceDe) * 100);
  }

  // ── Link ──────────────────────────────────────────────────────────────────
  const link = text.match(/🔗\s*Compre:\s*(\S+)/i);
  if (link) out.affiliateUrl = link[1].trim();

  // ── Nome (linhas em negrito que não são preço/%/cupom) ────────────────────
  // Com frase de chamada há 2 negritos (hook + nome); o nome é o último.
  const boldLines = [];
  for (const l of lines) {
    const m = l.match(/^\s*(?:[^\p{L}\p{N}*]+\s*)?\*([^*]+)\*\s*$/u);
    if (!m) continue;
    const content = m[1].trim();
    if (/R\$/i.test(content) || /^-?\d+\s*%/.test(content)) continue; // preço/%
    boldLines.push(content);
  }
  if (boldLines.length) out.name = boldLines[boldLines.length - 1];

  return out;
}

/** Atualiza o badge de validade do cupom dentro de um couponRow */
function updateCouponBadge(row, couponMin, pricePor, couponPct, coupon) {
  const badge = row.querySelector('.promos-coupon-badge');
  if (!badge) return;

  if (!coupon) {
    badge.textContent = '';
    badge.className = 'promos-coupon-badge';
    return;
  }

  const minNum  = parseFloat(couponMin);
  const porNum  = parseFloat(pricePor);
  const hasMin  = !isNaN(minNum) && minNum > 0;
  const hasPor  = !isNaN(porNum) && porNum > 0;
  const valid   = !hasMin || !hasPor || porNum >= minNum;

  if (valid) {
    const pctNum = parseFloat(couponPct);
    if (!isNaN(pctNum) && pctNum > 0 && hasPor) {
      const final = porNum * (1 - pctNum / 100);
      badge.textContent = `✅ com cupom: R$ ${final.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } else {
      badge.textContent = '✅ válido';
    }
    badge.className = 'promos-coupon-badge promos-coupon-ok';
  } else {
    badge.textContent = `❌ mín R$ ${minNum.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (produto R$ ${porNum.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
    badge.className = 'promos-coupon-badge promos-coupon-fail';
  }
}

// ── Emoji picker helpers ──────────────────────────────────────────────────

/**
 * Retorna o array de emojis disponíveis para a categoria do produto.
 * Se a categoria não foi detectada, usa o default.
 */
function getEmojiOptions(parsed, group) {
  if (!parsed) return [];
  // Usa a mesma lógica do template: específico do nome primeiro, depois categoria.
  if (window.PromosTemplate?.emojiOptions) {
    const opts = window.PromosTemplate.emojiOptions(parsed, group);
    if (opts.length) return opts;
  }
  const map = window.PromosConfig.EMOJI_MAP;
  const key = parsed.category && map[parsed.category] ? parsed.category : 'default';
  const val = map[key];
  const arr = Array.isArray(val) ? val : [val];
  return group === 'musculosas' ? arr.filter(e => e !== '💪') : arr;
}

/**
 * Monta a linha de botões de emoji.
 * onPick(emoji) é chamado ao clicar num botão.
 */
function buildEmojiPicker(options, postText, onPick) {
  const currentEmoji = extractEmojiFromPost(postText);

  // Lista ampla para o painel "···", agrupada por categoria com rótulo (local,
  // não no topo do módulo: o content script é re-injetado e um `const` de módulo
  // estoura "already declared").
  const MORE_EMOJI_GROUPS = [
    ['Promo',        ['🔥','⚡','✨','🎯','💥','🚨','🤑','💰','💸','🛒','🏷️','🔝','✅','👀','🎉','🥳','💯']],
    ['Beleza',       ['💄','💅','🧴','💇','✂️','🌸','💋','👄','💖','🪞','🧼','🪥']],
    ['Moda',         ['👗','👠','👜','👙','🕶️','🧢','👟','👕','👖','🧦','💍','🥿','👔','🧥']],
    ['Cozinha',      ['🍳','🥘','🍽️','☕','🧊','🔪','🥤','🍷','🧁','🍫','🫕','🥢']],
    ['Casa',         ['🏠','🛋️','🛏️','🛌','😴','💤','🧹','🧺','💡','🪴','🚿','🪟','🧴']],
    ['Eletrônicos',  ['📱','💻','🎧','⌚','📺','🔊','🔌','⌨️','🖱️','📷','🎮','🖥️','🔋','💿','📦','🚚','🌀']],
    ['Fitness',      ['💪','🏋️','🏃','🧘','🥊','⚽','🚴','🥇','🏆','🧬','💊','🥤']],
    ['Infantil/Pet', ['🧸','🎀','👶','🍼','🐾','🐶','🐱','🐟','🦴','🎁']],
    ['Reações',      ['⭐','❤️','🧡','💛','💚','💙','💜','🖤','🤍','😍','🤩','😱','👏','🙌']],
  ];

  const row = document.createElement('div');
  row.className = 'promos-emoji-picker';
  row.style.flexWrap = 'nowrap'; // o wrap acontece no container interno dos emojis

  const label = document.createElement('span');
  label.className = 'promos-emoji-label';
  label.textContent = 'Emoji:';
  row.appendChild(label);

  // Emojis sugeridos num container que faz wrap internamente, deixando o "···"
  // sempre como último item da MESMA linha (não quebra pra linha de baixo).
  const emojisWrap = document.createElement('div');
  emojisWrap.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:5px;flex:1;min-width:0;';
  row.appendChild(emojisWrap);

  for (const emoji of options) {
    const btn = document.createElement('button');
    btn.dataset.emoji = emoji;
    const active = emoji === currentEmoji;
    btn.className = `promos-btn promos-btn-sm promos-btn-emoji${active ? ' promos-btn-emoji-active' : ''}`;
    btn.textContent = emoji;
    btn.title = emoji;
    btn.addEventListener('click', () => onPick(emoji));
    emojisWrap.appendChild(btn);
  }

  // Botão "···" → painel com muitos emojis (quando nenhum sugerido serve).
  const btnMore = document.createElement('button');
  btnMore.className = 'promos-btn promos-btn-sm promos-btn-emoji';
  btnMore.textContent = '···';
  btnMore.title = 'Mais emojis';
  row.appendChild(btnMore);

  // Painel ancorado na TELA (position:fixed no body) — nunca é cortado pela
  // borda do overlay. Remove painéis antigos pra não acumular.
  document.querySelectorAll('.promos-emoji-more-panel').forEach(p => p.remove());
  const panel = document.createElement('div');
  panel.className = 'promos-emoji-more-panel';
  panel.style.cssText =
    'display:none;position:fixed;z-index:2147483647;' +
    'background:#fff;border:1px solid #ccc;border-radius:8px;padding:8px;' +
    'box-shadow:0 4px 16px rgba(0,0,0,.25);width:260px;max-height:320px;overflow:hidden;' +
    'flex-direction:column;gap:6px;';

  // Catálogo completo (PT-BR) carregado de content/emojiCatalog.js. Guard: se
  // não carregou (content script velho), a busca fica vazia e o curado funciona.
  const CATALOG = (typeof window !== 'undefined' && window.PromosEmojiCatalog) || [];
  const normq = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Campo de busca por nome (estilo WhatsApp).
  const search = document.createElement('input');
  search.type = 'text';
  search.placeholder = CATALOG.length ? '🔍 Buscar emoji (ex: perfume, flor)…' : '🔍 Buscar…';
  search.style.cssText = 'width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #ccc;border-radius:6px;font-size:13px;color:#000;background:#fff;';
  panel.appendChild(search);

  // Corpo rolável (curado quando vazio; resultados da busca quando há texto).
  const body = document.createElement('div');
  body.style.cssText = 'overflow-y:auto;display:flex;flex-direction:column;gap:2px;max-height:240px;';
  panel.appendChild(body);

  function makeEmojiBtn(emoji, title) {
    const e = document.createElement('button');
    e.textContent = emoji;
    e.title = title || emoji;
    e.style.cssText = 'font-size:18px;line-height:1;cursor:pointer;border:none;background:transparent;padding:4px;border-radius:6px;color:#000;';
    e.addEventListener('mouseenter', () => { e.style.background = '#eee'; });
    e.addEventListener('mouseleave', () => { e.style.background = 'transparent'; });
    e.addEventListener('click', () => { onPick(emoji); panel.style.display = 'none'; });
    return e;
  }

  function renderCurated() {
    body.innerHTML = '';
    for (const [lbl, emojis] of MORE_EMOJI_GROUPS) {
      const head = document.createElement('div');
      head.textContent = lbl;
      head.style.cssText = 'font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#999;margin:6px 2px 2px;';
      body.appendChild(head);
      const grid = document.createElement('div');
      grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:2px;';
      for (const emoji of emojis) grid.appendChild(makeEmojiBtn(emoji, emoji));
      body.appendChild(grid);
    }
  }

  function renderSearch(q) {
    body.innerHTML = '';
    const nq = normq(q);
    const hits = [];
    for (const it of CATALOG) {
      if (it.k.includes(nq)) { hits.push(it); if (hits.length >= 150) break; }
    }
    if (!hits.length) {
      const empty = document.createElement('div');
      empty.textContent = 'Nenhum emoji encontrado.';
      empty.style.cssText = 'font-size:12px;color:#999;padding:8px 2px;';
      body.appendChild(empty);
      return;
    }
    const grid = document.createElement('div');
    grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:2px;';
    for (const it of hits) grid.appendChild(makeEmojiBtn(it.e, it.n));
    body.appendChild(grid);
  }

  search.addEventListener('input', () => {
    const q = search.value.trim();
    if (q.length >= 1 && CATALOG.length) renderSearch(q);
    else renderCurated();
  });

  renderCurated();
  document.body.appendChild(panel);

  function positionPanel() {
    const r = btnMore.getBoundingClientRect();
    const w = 252;
    const h = Math.min(panel.scrollHeight || 320, 320);
    let left = Math.min(r.right - w, window.innerWidth - w - 8);
    left = Math.max(8, left);
    let top = r.bottom + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4); // abre pra cima se faltar espaço
    panel.style.left = left + 'px';
    panel.style.top  = top + 'px';
  }

  btnMore.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (panel.style.display === 'none') {
      // Re-anexa ao FIM do body (depois do overlay) p/ ficar POR CIMA dele.
      document.body.appendChild(panel);
      panel.style.display = 'flex';
      search.value = '';
      renderCurated();
      positionPanel();
      search.focus();
    } else {
      panel.style.display = 'none';
    }
  });
  // Fecha ao clicar fora.
  document.addEventListener('click', (ev) => {
    if (ev.target !== btnMore && !panel.contains(ev.target)) panel.style.display = 'none';
  });

  return row;
}

/** Extrai o emoji da primeira linha do post (antes do espaço + asterisco) */
function extractEmojiFromPost(postText) {
  if (!postText) return '';
  const firstLine = postText.split('\n')[0];
  // Formato: "{emoji} *nome*" — pega tudo antes do primeiro " *"
  const m = firstLine.match(/^(.+?)\s+\*/);
  return m ? m[1].trim() : '';
}

/** Substitui o emoji na primeira linha do post */
function replaceEmojiInPost(postText, newEmoji) {
  if (!postText) return postText;
  const lines = postText.split('\n');
  // Primeira linha: "{emoji} *nome*"
  lines[0] = lines[0].replace(/^(.+?)(\s+\*)/, newEmoji + '$2');
  return lines.join('\n');
}

async function imgToBlob(imgEl) {
  try {
    const resp = await fetch(imgEl.src);
    if (resp.ok) {
      const buf = await resp.arrayBuffer();
      const arr = new Uint8Array(buf);
      if (arr[0] === 0x89 && arr[1] === 0x50) return new Blob([buf], { type: 'image/png' });
    }
  } catch (_) {}
  return canvasBlob(imgEl);
}

function canvasBlob(imgEl) {
  return new Promise((resolve, reject) => {
    const c = document.createElement('canvas');
    c.width  = imgEl.naturalWidth  || imgEl.width  || 200;
    c.height = imgEl.naturalHeight || imgEl.height || 200;
    try {
      c.getContext('2d').drawImage(imgEl, 0, 0);
      c.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png');
    } catch (e) { reject(e); }
  });
}
