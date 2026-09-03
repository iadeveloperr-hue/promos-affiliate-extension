// Gerador de post/story para Instagram — usa Canvas API (sem libs externas).
// IIFE + guard evita SyntaxError quando o content script é injetado duas vezes (SPA).
(function () {
if (window.PromosInstagram) return;

const IG_HASHTAGS = {
  beleza:      '#beleza #maquiagem #skincare #promoção #oferta #desconto #achadinhos',
  cabelo:      '#cabelo #haircare #beleza #promoção #oferta #desconto #achadinhos',
  cozinha:     '#cozinha #airfryer #receitas #promoção #oferta #desconto #achadinhos',
  casa:        '#casa #decoração #homedecor #promoção #oferta #desconto #achadinhos',
  moda:        '#moda #fashion #roupa #estilo #promoção #oferta #desconto #achadinhos',
  calcados:    '#calcados #tenis #shoes #promoção #oferta #desconto #achadinhos',
  fitness:     '#fitness #treino #academia #workout #promoção #oferta #desconto',
  suplemento:  '#suplemento #whey #proteina #fitness #promoção #oferta #desconto',
  decoracao:   '#decoração #casa #homedecor #promoção #oferta #desconto #achadinhos',
  eletronicos: '#eletronicos #tech #tecnologia #gadgets #promoção #oferta #desconto',
  infantil:    '#infantil #bebe #kids #mamae #promoção #oferta #desconto #achadinhos',
  pet:         '#pet #cachorro #gato #petlovers #promoção #oferta #desconto #achadinhos',
  default:     '#promoção #oferta #desconto #cupom #achadinhos #compras #economize',
};

// ── Ponto de entrada ──────────────────────────────────────────────────────────

// Pré-carrega fonte Nunito ExtraBold para que o canvas use a mesma família do Canva
let _nunitoLoaded = false;
async function ensureFont() {
  if (_nunitoLoaded) return;
  try {
    const url = 'https://fonts.gstatic.com/s/nunito/v26/XRXI3I6Li01BKofiOc5wtlZ2di8HDLshRTM9jo7eTWk.woff2';
    const f = new FontFace('Nunito', `url(${url})`, { weight: '800', style: 'italic' });
    await f.load();
    document.fonts.add(f);
    const f2 = new FontFace('Nunito', `url(https://fonts.gstatic.com/s/nunito/v26/XRXI3I6Li01BKofiOc5wtlZ2di8HDOchRTM9jo7eTWk.woff2)`, { weight: '800', style: 'normal' });
    await f2.load();
    document.fonts.add(f2);
    _nunitoLoaded = true;
  } catch (_) { /* usa fallback */ }
}

async function showIGPanel(data) {
  // data: { group, parsed, affiliateUrl, imageEl, imageUrlAlt }
  removeIGPanel();
  await ensureFont();

  const imgEl = data.imageEl;

  // Aguarda a imagem carregar, se ainda não estiver pronta
  if (imgEl && imgEl.naturalWidth === 0) {
    await new Promise(res => {
      imgEl.addEventListener('load',  res, { once: true });
      imgEl.addEventListener('error', res, { once: true });
      setTimeout(res, 4000);
    });
  }

  // currentImg pode ser substituída após remoção de fundo ou troca de fonte
  let currentImg = imgEl;

  // Pre-fetch da imagem via blob para permitir operações de canvas (CORS)
  if (imgEl?.src) {
    currentImg = await fetchImageForCanvas(imgEl.src).catch(() => imgEl);
  }

  // Pré-carrega a imagem alternativa (marketplace) se existir
  let altImg = null;
  if (data.imageUrlAlt) {
    altImg = await fetchImageForCanvas(data.imageUrlAlt).catch(() => null);
  }

  // Palavra do headline (editável)
  if (!data.headlineWord) {
    data.headlineWord = extractKeyword(data.parsed?.name || '');
  }

  // Post (1:1): canvas gerado; Story: usa o template PNG real do Canva
  const postCanvas  = buildCanvas(data, currentImg, false);
  const storyCanvas = await buildStoryWithTemplate(data, currentImg).catch(() => buildCanvas(data, currentImg, true));
  const legenda     = buildLegenda(data);

  // ── Backdrop ────────────────────────────────────────────────────────────────
  const backdrop = document.createElement('div');
  backdrop.id = 'promos-ig-overlay';
  backdrop.addEventListener('click', e => { if (e.target === backdrop) removeIGPanel(); });

  // ── Card ────────────────────────────────────────────────────────────────────
  const card = document.createElement('div');
  card.id = 'promos-ig-card';
  makeDraggable(card);

  // Header
  const header = document.createElement('div');
  header.className = 'promos-header';
  header.innerHTML = '<span class="promos-title">📸 Post Instagram</span>';
  const closeBtn = igBtn('✕', 'promos-close');
  closeBtn.addEventListener('click', removeIGPanel);
  header.appendChild(closeBtn);
  card.appendChild(header);

  // ── Seletor de imagem ─────────────────────────────────────────────────────
  // Mostra as duas fontes (WhatsApp + marketplace) e permite escolher qual usar.
  const imgRow = document.createElement('div');
  imgRow.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:4px 0 8px;border-bottom:1px solid #eee;';

  const imgSourcesRow = document.createElement('div');
  imgSourcesRow.style.cssText = 'display:flex;gap:10px;align-items:flex-start;';

  // Thumb da imagem atual (WhatsApp / selecionada)
  function makeThumb(img, label, isActive) {
    const wrap = document.createElement('div');
    wrap.style.cssText = `display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;`;
    const thumb = document.createElement('img');
    thumb.style.cssText = `width:64px;height:64px;object-fit:contain;border-radius:8px;background:#f9f9f9;
      border:2px solid ${isActive ? '#E91E8C' : '#ddd'};transition:border .15s;`;
    if (img?.src) thumb.src = img.src;
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:10px;color:#666;text-align:center;line-height:1.2;max-width:64px;';
    lbl.textContent = label;
    wrap.appendChild(thumb);
    wrap.appendChild(lbl);
    return { wrap, thumb };
  }

  const hasWhatsapp = !!imgEl?.src;
  const hasAlt      = !!altImg;

  const waThumbObj  = hasWhatsapp ? makeThumb(currentImg, 'WhatsApp', !hasAlt || true) : null;
  const altThumbObj = hasAlt      ? makeThumb(altImg, 'Marketplace', false)             : null;

  // Imagem selecionada começa como a do WhatsApp (se houver) ou a do marketplace
  let activeSource = hasWhatsapp ? 'wa' : 'alt';
  if (!hasWhatsapp && hasAlt) {
    currentImg = altImg;
    activeSource = 'alt';
  }

  function setActive(source) {
    activeSource = source;
    if (waThumbObj)  waThumbObj.thumb.style.borderColor  = source === 'wa'  ? '#E91E8C' : '#ddd';
    if (altThumbObj) altThumbObj.thumb.style.borderColor = source === 'alt' ? '#E91E8C' : '#ddd';
  }

  if (waThumbObj) {
    waThumbObj.wrap.addEventListener('click', async () => {
      if (activeSource === 'wa') return;
      currentImg = await fetchImageForCanvas(imgEl.src).catch(() => imgEl);
      imgThumb.src = currentImg.src || '';
      setActive('wa');
      removeFb.textContent = '';
      await regenerate();
    });
    imgSourcesRow.appendChild(waThumbObj.wrap);
  }

  if (altThumbObj) {
    altThumbObj.wrap.addEventListener('click', async () => {
      if (activeSource === 'alt') return;
      currentImg = altImg;
      imgThumb.src = altImg.src || '';
      setActive('alt');
      removeFb.textContent = '';
      await regenerate();
    });
    imgSourcesRow.appendChild(altThumbObj.wrap);
  }

  // Thumb grande da imagem ativa + botão remover fundo
  const activeCol = document.createElement('div');
  activeCol.style.cssText = 'display:flex;flex-direction:column;gap:6px;flex:1;';

  const imgThumb = document.createElement('img');
  imgThumb.style.cssText = 'width:72px;height:72px;object-fit:contain;border:1px solid #eee;border-radius:8px;background:#f9f9f9;';
  if (currentImg?.src) imgThumb.src = currentImg.src;

  const btnRemoveBg = igBtn('🪄 Remover fundo', 'promos-btn promos-btn-sm promos-btn-secondary');
  const removeFb = document.createElement('span');
  removeFb.style.cssText = 'font-size:11px;color:#666;';

  activeCol.appendChild(imgThumb);
  activeCol.appendChild(btnRemoveBg);
  activeCol.appendChild(removeFb);

  imgSourcesRow.appendChild(activeCol);
  imgRow.appendChild(imgSourcesRow);
  card.appendChild(imgRow);

  // Chave imgbb (opcional — só para enviar imagem com fundo removido ao Canva)
  const { imgbbKey: storedKey } = await chrome.storage.local.get('imgbbKey');
  if (storedKey) {
    const keyBadge = document.createElement('span');
    keyBadge.style.cssText = 'font-size:11px;color:#4caf50;';
    keyBadge.textContent = '🔑 imgbb ✓';
    activeCol.appendChild(keyBadge);
  } else {
    const keyLink = document.createElement('a');
    keyLink.href = 'https://api.imgbb.com/';
    keyLink.target = '_blank';
    keyLink.style.cssText = 'font-size:11px;color:#E91E8C;cursor:pointer;';
    keyLink.textContent = '+ Adicionar chave imgbb (opcional)';
    keyLink.addEventListener('click', async (e) => {
      e.preventDefault();
      const key = prompt('Cole sua API key gratuita do imgbb.com:\n(Permite enviar a imagem sem fundo ao Canva)');
      if (key?.trim()) {
        await chrome.storage.local.set({ imgbbKey: key.trim() });
        keyLink.textContent = '🔑 imgbb ✓';
        keyLink.style.color = '#4caf50';
      }
      window.open('https://api.imgbb.com/', '_blank');
    });
    activeCol.appendChild(keyLink);
  }

  btnRemoveBg.addEventListener('click', async () => {
    btnRemoveBg.disabled = true;
    removeFb.textContent = '⏳ Processando…';
    try {
      const bgCanvas = removeBackground(currentImg);
      const aborted  = bgCanvas._bgRemovalAborted;
      const newImg   = new Image();
      newImg.src     = bgCanvas.toDataURL('image/png');
      await new Promise(r => { newImg.onload = r; newImg.onerror = r; setTimeout(r, 4000); });
      currentImg = newImg;
      imgThumb.src = newImg.src;
      removeFb.textContent = aborted
        ? '⚠️ Produto claro — fundo mantido p/ não sumir'
        : '✅ Fundo removido';
      await regenerate();
    } catch (e) {
      removeFb.textContent = '❌ Falha — tente de novo';
      btnRemoveBg.disabled = false;
    }
  });

  // ── Campo: palavra do headline ─────────────────────────────────────────────
  const hwRow = document.createElement('div');
  hwRow.style.cssText = 'display:flex;align-items:center;gap:8px;';

  const hwLabel = document.createElement('label');
  hwLabel.style.cssText = 'font-size:13px;font-weight:600;color:#444;white-space:nowrap';
  hwLabel.textContent = '✦ Destaque:';
  hwRow.appendChild(hwLabel);

  const hwInput = document.createElement('input');
  hwInput.type  = 'text';
  hwInput.value = data.headlineWord;
  hwInput.placeholder = 'ex: SECADOR, TÊNIS, CREATINA';
  hwInput.style.cssText = 'flex:1;padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;font-weight:700;text-transform:uppercase;';
  hwRow.appendChild(hwInput);

  const hwBtn = igBtn('↺ Atualizar', 'promos-btn promos-btn-sm promos-btn-secondary');
  hwRow.appendChild(hwBtn);
  card.appendChild(hwRow);

  // ── Campo: cupom ──────────────────────────────────────────────────────────
  const cupomRow = document.createElement('div');
  cupomRow.style.cssText = 'display:flex;align-items:center;gap:8px;';

  const cupomLabel = document.createElement('label');
  cupomLabel.style.cssText = 'font-size:13px;font-weight:600;color:#444;white-space:nowrap';
  cupomLabel.textContent = '🎟 Cupom:';
  cupomRow.appendChild(cupomLabel);

  const cupomInput = document.createElement('input');
  cupomInput.type        = 'text';
  cupomInput.value       = data.parsed?.coupon || '';
  cupomInput.placeholder = 'ex: KATE10, PROMO20 (opcional)';
  cupomInput.style.cssText = 'flex:1;padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;font-weight:700;text-transform:uppercase;';
  cupomInput.addEventListener('input', () => {
    if (!data.parsed) data.parsed = {};
    data.parsed.coupon = cupomInput.value.trim().toUpperCase() || undefined;
  });
  cupomRow.appendChild(cupomInput);

  const cupomBtn = igBtn('↺ Atualizar', 'promos-btn promos-btn-sm promos-btn-secondary');
  cupomRow.appendChild(cupomBtn);
  card.appendChild(cupomRow);
  cupomBtn.addEventListener('click', () => {
    if (!data.parsed) data.parsed = {};
    data.parsed.coupon = cupomInput.value.trim().toUpperCase() || undefined;
    regenerate();
  });
  cupomInput.addEventListener('keydown', e => { if (e.key === 'Enter') cupomBtn.click(); });

  async function regenerate() {
    data.headlineWord = hwInput.value.trim() || extractKeyword(data.parsed?.name || '');
    if (!data.parsed) data.parsed = {};
    data.parsed.coupon = cupomInput.value.trim().toUpperCase() || undefined;
    const newPost  = buildCanvas(data, currentImg, false);
    const newStory = await buildStoryWithTemplate(data, currentImg).catch(() => buildCanvas(data, currentImg, true));
    newPost.className  = 'promos-ig-canvas-post';
    newStory.className = 'promos-ig-canvas-story';
    card.querySelector('.promos-ig-canvas-post')?.replaceWith(newPost);
    card.querySelector('.promos-ig-canvas-story')?.replaceWith(newStory);
    curPost  = newPost;
    curStory = newStory;
  }
  hwBtn.addEventListener('click', regenerate);
  hwInput.addEventListener('keydown', e => { if (e.key === 'Enter') regenerate(); });

  // ── Previews lado a lado ────────────────────────────────────────────────────
  const previews = document.createElement('div');
  previews.className = 'promos-ig-previews';

  // Post 1:1
  const postWrap = document.createElement('div');
  postWrap.className = 'promos-ig-preview-wrap';
  const postLabel = document.createElement('div');
  postLabel.className = 'promos-ig-label';
  postLabel.textContent = 'Post (1:1)';
  postCanvas.className = 'promos-ig-canvas-post';
  postWrap.appendChild(postLabel);
  postWrap.appendChild(postCanvas);
  previews.appendChild(postWrap);

  // Story 9:16
  const storyWrap = document.createElement('div');
  storyWrap.className = 'promos-ig-preview-wrap';
  const storyLabel = document.createElement('div');
  storyLabel.className = 'promos-ig-label';
  storyLabel.textContent = 'Story (9:16)';
  storyCanvas.className = 'promos-ig-canvas-story';
  storyWrap.appendChild(storyLabel);
  storyWrap.appendChild(storyCanvas);
  previews.appendChild(storyWrap);

  card.appendChild(previews);

  // ── Canvases atuais (atualizados em regenerate) ─────────────────────────────
  let curPost  = postCanvas;
  let curStory = storyCanvas;

  // ── Download buttons ────────────────────────────────────────────────────────
  const dlRow = document.createElement('div');
  dlRow.className = 'promos-actions';

  const btnDlPost  = igBtn('⬇️ Baixar post',  'promos-btn promos-btn-primary');
  const btnDlStory = igBtn('⬇️ Baixar story', 'promos-btn promos-btn-secondary');
  dlRow.appendChild(btnDlPost);
  dlRow.appendChild(btnDlStory);
  card.appendChild(dlRow);

  // ── Copiar imagem do produto (sem fundo) ────────────────────────────────────
  const copyImgRow = document.createElement('div');
  copyImgRow.className = 'promos-actions';
  const btnCopyProd = igBtn('📋 Copiar imagem do produto (sem fundo)', 'promos-btn promos-btn-secondary');
  btnCopyProd.style.width = '100%';
  copyImgRow.appendChild(btnCopyProd);
  card.appendChild(copyImgRow);

  const copyImgFb = document.createElement('div');
  copyImgFb.className = 'promos-copy-feedback';
  card.appendChild(copyImgFb);

  btnDlPost.addEventListener('click',  () => downloadCanvas(curPost,  'post-kate.png'));
  btnDlStory.addEventListener('click', () => downloadCanvas(curStory, 'story-kate.png'));
  btnCopyProd.addEventListener('click', () =>
    copyImageEl(currentImg).then(() => igFeedback(copyImgFb, '✅ Imagem copiada! Cole no Canva.'))
                           .catch(() => igFeedback(copyImgFb, '❌ Falha ao copiar imagem')));

  // ── Legenda ─────────────────────────────────────────────────────────────────
  const legendaLabel = document.createElement('div');
  legendaLabel.style.cssText = 'font-weight:600;font-size:13px;color:#444';
  legendaLabel.textContent = '📝 Legenda para o Instagram:';
  card.appendChild(legendaLabel);

  const ta = document.createElement('textarea');
  ta.className = 'promos-textarea';
  ta.style.minHeight = '140px';
  ta.value = legenda;
  card.appendChild(ta);

  // ── Copy legenda ────────────────────────────────────────────────────────────
  const feedback = document.createElement('div');
  feedback.className = 'promos-copy-feedback';
  card.appendChild(feedback);

  const copyRow = document.createElement('div');
  copyRow.className = 'promos-actions';
  const btnCopyLeg = igBtn('📋 Copiar legenda', 'promos-btn promos-btn-secondary');
  copyRow.appendChild(btnCopyLeg);
  card.appendChild(copyRow);

  btnCopyLeg.addEventListener('click', () => {
    navigator.clipboard.writeText(ta.value)
      .then(() => igFeedback(feedback, '✅ Legenda copiada!'))
      .catch(() => igFeedback(feedback, '❌ Falha ao copiar'));
  });

  // ── Exportar p/ Canva Bulk Create ──────────────────────────────────────────
  const canvaRow = document.createElement('div');
  canvaRow.className = 'promos-actions';
  canvaRow.style.cssText = 'border-top:1px solid #eee;padding-top:12px;margin-top:4px;';

  const canvaBtnRow = document.createElement('div');
  canvaBtnRow.style.cssText = 'display:flex;gap:6px;align-items:stretch;';

  const btnCanva = igBtn('🎨 Exportar p/ Canva', 'promos-btn promos-btn-primary');
  btnCanva.style.flex = '1';
  canvaBtnRow.appendChild(btnCanva);

  // Botão pequeno: só abre a aba do template do Canva (não exporta).
  const btnOpenCanva = igBtn('Canva', 'promos-btn promos-btn-secondary');
  btnOpenCanva.style.cssText += 'flex:0 0 auto;white-space:nowrap;';
  btnOpenCanva.title = 'Abrir o template do Canva numa aba';
  btnOpenCanva.addEventListener('click', async () => {
    const { canvaDesignUrl } = await chrome.storage.local.get('canvaDesignUrl');
    window.open(canvaDesignUrl || 'https://www.canva.com/', 'promos_canva');
  });
  canvaBtnRow.appendChild(btnOpenCanva);

  canvaRow.appendChild(canvaBtnRow);

  const canvaFb = document.createElement('div');
  canvaFb.className = 'promos-copy-feedback';
  canvaRow.appendChild(canvaFb);
  card.appendChild(canvaRow);

  btnCanva.addEventListener('click', async () => {
    btnCanva.disabled = true;
    igFeedback(canvaFb, '⏳ Preparando…');
    try {
      const { sheetsScriptUrl, imgbbKey } = await chrome.storage.local.get(['sheetsScriptUrl', 'imgbbKey']);
      const originalUrl = data.imageEl?.src || '';
      let imageUrl = originalUrl;
      if (imgbbKey && currentImg) {
        igFeedback(canvaFb, '⏳ Enviando imagem…');
        imageUrl = await uploadToImgbb(currentImg, imgbbKey).catch(() => originalUrl);
      }
      const payload = buildCanvaPayload(data, imageUrl);

      // 1. Salva no Lote local PRIMEIRO — é independente da planilha. Assim o
      //    produto nunca se perde se o Apps Script falhar (404/instabilidade).
      await saveToBatch({
        nome:         payload.nome,
        legenda:      ta.value,
        coupon:       data.parsed?.coupon || '',
        affiliateUrl: data.affiliateUrl || '',
        imageUrl,
        imageDataUrl: currentImg ? await canvasToDataUrl(currentImg) : '',
        exportedAt:   Date.now(),
      });

      // 2. Envia à planilha (ou baixa CSV). Falha aqui NÃO descarta o Lote.
      if (sheetsScriptUrl) {
        igFeedback(canvaFb, '⏳ Enviando para planilha…');
        try {
          const resp = await fetch(sheetsScriptUrl, { method: 'POST', body: JSON.stringify(payload) });
          if (!resp.ok) throw new Error('Apps Script retornou erro ' + resp.status);
          igFeedback(canvaFb, '✅ Salvo no Lote e na planilha! Abra o Bulk Create no Canva.');
        } catch (sheetErr) {
          console.error('[Promos] Falha ao enviar à planilha:', sheetErr);
          // Item já está no Lote — avisa, mas não trata como falha total.
          canvaFb.textContent = '⚠️ Salvo no Lote, mas a planilha falhou (' + sheetErr.message + ')';
        }
      } else {
        const csv = buildCanvaCSV(payload);
        downloadText(csv, 'produto-canva.csv', 'text/csv');
        igFeedback(canvaFb, '✅ Salvo no Lote + CSV baixado. Configure nas Opções para envio automático.');
      }
      // A aba do Canva NÃO abre mais automaticamente aqui — use o botão "Canva"
      // ao lado quando quiser abrir o template.
    } catch (err) {
      console.error('[Promos] Exportar p/ Canva:', err);
      canvaFb.textContent = '❌ Erro: ' + err.message; // fica até próxima ação
    } finally {
      btnCanva.disabled = false;
    }
  });

  // ── Limpar planilha ─────────────────────────────────────────────────────────
  const btnClear = igBtn('🧹 Limpar planilha', 'promos-btn promos-btn-secondary');
  btnClear.style.width = '100%';
  btnClear.style.marginTop = '6px';
  canvaRow.appendChild(btnClear);

  btnClear.addEventListener('click', async () => {
    const { sheetsScriptUrl } = await chrome.storage.local.get('sheetsScriptUrl');
    if (!sheetsScriptUrl) {
      igFeedback(canvaFb, '⚠️ Configure a URL do Apps Script nas Opções.');
      return;
    }
    if (!confirm('Apagar TODAS as linhas de produtos da planilha? (mantém o cabeçalho)')) return;
    btnClear.disabled = true;
    igFeedback(canvaFb, '⏳ Limpando planilha…');
    try {
      const resp = await fetch(sheetsScriptUrl, { method: 'POST', body: JSON.stringify({ action: 'clear' }) });
      if (!resp.ok) throw new Error('Apps Script retornou erro ' + resp.status);
      igFeedback(canvaFb, '✅ Planilha limpa!');
    } catch (err) {
      igFeedback(canvaFb, '❌ Erro: ' + err.message);
    } finally {
      btnClear.disabled = false;
    }
  });

  backdrop.appendChild(card);
  document.body.appendChild(backdrop);
}

function removeIGPanel() {
  document.getElementById('promos-ig-overlay')?.remove();
}

// ── Canvas builder ────────────────────────────────────────────────────────────
// Layout inspirado no template manual:
//  1. Fundo colorido (gradiente da marca)
//  2. Headline no topo: "PRODUTO COM X% OFF"
//  3. Card central: produto sobre fundo rosé/azul claro + badge % + "achadinho"
//  4. Card branco embaixo: De / Por / pill de cupom / handle

function buildCanvas(data, imgEl, isStory) {
  const W = 1080;
  const H = isStory ? 1920 : 1080;

  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const isMusculosas = data.group === 'musculosas';
  // Cores da marca
  const BG1   = isMusculosas ? '#1565C0' : '#E91E8C';
  const BG2   = isMusculosas ? '#4A148C' : '#C2185B';
  const LIGHT = isMusculosas ? '#90CAF9' : '#FCE4EC'; // card do produto
  const DARK  = isMusculosas ? '#0D47A1' : '#AD1457';

  const PAD = isStory ? 54 : 46;

  // ── Proporções das 3 seções (em fração de H) ──────────────────────────────
  const HEAD_H    = Math.round(H * (isStory ? 0.17 : 0.20));
  const PROD_H    = Math.round(H * (isStory ? 0.47 : 0.46));
  const PRICE_H   = Math.round(H * (isStory ? 0.36 : 0.34));
  const prodY     = HEAD_H;
  const priceY    = HEAD_H + PROD_H;

  // ── 1. Fundo global ────────────────────────────────────────────────────────
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, BG1);
  bgGrad.addColorStop(1, BG2);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // ── 2. HEADLINE ───────────────────────────────────────────────────────────
  const keyword  = data.headlineWord || extractKeyword(data.parsed?.name || '');
  const pct      = data.parsed?.discount;
  const headLine1 = keyword.toUpperCase();
  const headLine2 = pct ? `COM ${pct}% OFF` : 'EM OFERTA';
  const sparkle   = '✦';

  const FS_H1 = isStory ? 92 : 68;
  const FS_H2 = isStory ? 78 : 58;

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font      = `bold ${FS_H1}px Arial Black, Arial, sans-serif`;
  ctx.fillText(`${sparkle} ${headLine1} ${sparkle}`, W / 2, HEAD_H * 0.50);
  ctx.font      = `bold ${FS_H2}px Arial Black, Arial, sans-serif`;
  ctx.fillText(headLine2, W / 2, HEAD_H * 0.90);
  ctx.textAlign = 'left';

  // ── 3. CARD DO PRODUTO ────────────────────────────────────────────────────
  const PROD_PAD  = isStory ? 36 : 30;
  const PROD_R    = isStory ? 48 : 40;

  ctx.save();
  // Sombra do card
  ctx.shadowColor   = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur    = 30;
  ctx.shadowOffsetY = 8;
  roundRect(ctx, PROD_PAD, prodY + PROD_PAD, W - PROD_PAD * 2, PROD_H - PROD_PAD * 2, PROD_R);
  ctx.fillStyle = LIGHT;
  ctx.fill();
  ctx.restore();

  // Imagem do produto dentro do card
  if (imgEl && imgEl.naturalWidth > 0) {
    const inner  = { x: PROD_PAD * 2, y: prodY + PROD_PAD * 2 };
    const innerW = W - inner.x * 2;
    const innerH = PROD_H - PROD_PAD * 4;
    const ratio  = Math.min(innerW / imgEl.naturalWidth, innerH / imgEl.naturalHeight);
    const dw     = imgEl.naturalWidth  * ratio;
    const dh     = imgEl.naturalHeight * ratio;
    const dx     = (W - dw) / 2;
    const dy     = inner.y + (innerH - dh) / 2;

    ctx.save();
    ctx.shadowColor   = 'rgba(0,0,0,0.12)';
    ctx.shadowBlur    = 24;
    ctx.shadowOffsetY = 10;
    ctx.drawImage(imgEl, dx, dy, dw, dh);
    ctx.restore();
  }

  // Badge de % no canto inferior esquerdo do card
  if (pct) {
    const BR = isStory ? 84 : 70;
    const bx = PROD_PAD * 2 + BR;
    const by = prodY + PROD_H - PROD_PAD - BR;

    // Anel dourado
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur  = 16;
    ctx.beginPath();
    ctx.arc(bx, by, BR, 0, Math.PI * 2);
    const goldGrad = ctx.createRadialGradient(bx - BR * 0.2, by - BR * 0.2, BR * 0.1, bx, by, BR);
    goldGrad.addColorStop(0, '#FFE57F');
    goldGrad.addColorStop(0.6, '#FFC107');
    goldGrad.addColorStop(1, '#E65100');
    ctx.fillStyle = goldGrad;
    ctx.fill();
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font      = `bold ${isStory ? 46 : 38}px Arial Black, Arial, sans-serif`;
    ctx.fillText(`${pct}%`, bx, by + (isStory ? 14 : 12));
    ctx.font      = `bold ${isStory ? 28 : 22}px Arial, sans-serif`;
    ctx.fillText('OFF', bx, by + (isStory ? 50 : 42));
    ctx.textAlign = 'left';
  }

  // "achadinho de hoje ✦" no canto inferior direito do card
  ctx.save();
  ctx.fillStyle   = DARK;
  ctx.font        = `italic bold ${isStory ? 32 : 26}px Georgia, serif`;
  ctx.textAlign   = 'right';
  ctx.globalAlpha = 0.75;
  ctx.fillText('achadinho de hoje ✦', W - PROD_PAD * 2, prodY + PROD_H - PROD_PAD - (isStory ? 16 : 14));
  ctx.restore();

  // ── 4. CARD DE PREÇO (branco) ─────────────────────────────────────────────
  const WC_PAD = isStory ? 38 : 32;
  const WC_R   = isStory ? 44 : 36;
  const cardBottom = H - (isStory ? 18 : 14);

  ctx.save();
  ctx.shadowColor   = 'rgba(0,0,0,0.20)';
  ctx.shadowBlur    = 24;
  ctx.shadowOffsetY = -4;
  roundRectFull(ctx, WC_PAD, priceY + WC_PAD, W - WC_PAD * 2, cardBottom - priceY - WC_PAD, WC_R);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  // Nome do produto (pill no topo do card branco)
  const nameFull   = data.parsed?.name || 'Produto';
  const PILL_FS    = isStory ? 26 : 20;
  const namePill   = truncateText(ctx, nameFull, `bold ${PILL_FS}px Arial, sans-serif`, W - WC_PAD * 4 - 60);
  const PILL_H     = isStory ? 54 : 44;
  const PILL_Y     = priceY + WC_PAD + (isStory ? 24 : 18);
  ctx.font         = `bold ${PILL_FS}px Arial, sans-serif`;
  const pillTextW  = ctx.measureText(namePill).width;
  const pillW      = Math.min(pillTextW + (isStory ? 52 : 44), W - WC_PAD * 4);
  const pillX      = (W - pillW) / 2;

  ctx.save();
  roundRectFull(ctx, pillX, PILL_Y, pillW, PILL_H, PILL_H / 2);
  const pillGrad = ctx.createLinearGradient(pillX, 0, pillX + pillW, 0);
  pillGrad.addColorStop(0, BG1);
  pillGrad.addColorStop(1, BG2);
  ctx.fillStyle = pillGrad;
  ctx.fill();
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font      = `bold ${PILL_FS}px Arial, sans-serif`;
  ctx.fillText(namePill, W / 2, PILL_Y + PILL_H * 0.67);

  // Calcula espaço disponível e distribui os elementos verticalmente
  const de  = data.parsed?.priceDe;
  const por = data.parsed?.pricePor;
  const hasCupom = !!data.parsed?.coupon;

  // Botão "Link aqui" no fundo do card
  const LINK_H   = isStory ? 70 : 56;
  const LINK_Y   = cardBottom - WC_PAD - LINK_H;

  ctx.save();
  roundRectFull(ctx, WC_PAD * 2, LINK_Y, W - WC_PAD * 4, LINK_H, LINK_H / 2);
  ctx.fillStyle = '#eeeeee';
  ctx.fill();
  ctx.restore();
  ctx.textAlign   = 'center';
  ctx.fillStyle   = '#555555';
  ctx.font        = `bold ${isStory ? 30 : 24}px Arial, sans-serif`;
  ctx.fillText('🔗  Link aqui', W / 2, LINK_Y + LINK_H * 0.64);

  // Área de preço entre a pill e o botão Link
  const priceAreaTop = PILL_Y + PILL_H;
  const priceAreaBot = LINK_Y - (isStory ? 16 : 12);
  const priceAreaH   = priceAreaBot - priceAreaTop;

  // Distribuição interna da área de preço
  const deH   = (de && por) ? (isStory ? 50 : 40) : 0;
  const porLH = isStory ? 52 : 40;  // "Por:" label
  const porVH = isStory ? 120 : 96; // valor grande
  const cupH  = hasCupom ? (isStory ? 58 : 46) : 0;
  const totalH = deH + porLH + porVH + cupH;
  let ty = priceAreaTop + (priceAreaH - totalH) / 2 + deH;

  // De: riscado
  if (de && por) {
    ctx.textAlign   = 'center';
    ctx.fillStyle   = '#aaaaaa';
    ctx.font        = `${isStory ? 36 : 28}px Arial, sans-serif`;
    const deStr     = `De: ${fmtBR(de)}`;
    const deY       = priceAreaTop + (priceAreaH - totalH) / 2 + deH * 0.8;
    ctx.fillText(deStr, W / 2, deY);
    const deW = ctx.measureText(deStr).width;
    ctx.strokeStyle = '#aaaaaa';
    ctx.lineWidth   = isStory ? 2.5 : 2;
    ctx.beginPath();
    ctx.moveTo((W - deW) / 2, deY - (isStory ? 14 : 10));
    ctx.lineTo((W + deW) / 2, deY - (isStory ? 14 : 10));
    ctx.stroke();
  }

  // Por: label + valor
  ctx.textAlign = 'center';
  ctx.fillStyle = DARK;
  ctx.font      = `bold ${isStory ? 44 : 34}px Arial, sans-serif`;
  ctx.fillText('Por:', W / 2, ty + porLH * 0.85);

  ctx.font      = `bold ${isStory ? 108 : 86}px Arial Black, Arial, sans-serif`;
  ctx.fillStyle = BG1;
  if (por) ctx.fillText(`R$ ${fmtBR(por)}`, W / 2, ty + porLH + porVH * 0.82);
  ty += porLH + porVH;

  // Cupom
  if (hasCupom) {
    ty += isStory ? 14 : 10;
    const cupomStr = `🎟  Cupom: ${data.parsed.coupon}`;
    ctx.font        = `bold ${isStory ? 28 : 22}px Arial, sans-serif`;
    const cpW       = ctx.measureText(cupomStr).width + (isStory ? 44 : 36);
    const cpH       = isStory ? 52 : 42;
    const cpX       = (W - cpW) / 2;
    ctx.save();
    roundRectFull(ctx, cpX, ty, cpW, cpH, cpH / 2);
    ctx.fillStyle = '#FFF9C4';
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#795548';
    ctx.fillText(cupomStr, W / 2, ty + cpH * 0.68);
  }

  ctx.textAlign = 'left';

  return canvas;
}

// ── Story com template real do Canva ─────────────────────────────────────────
// Carrega template-kate-story.png (1080×1920) e sobrepõe o conteúdo dinâmico
// nas zonas mapeadas por varredura de pixels.

async function buildStoryWithTemplate(data, imgEl) {
  const W = 1080, H = 1920;

  // Carrega o template PNG
  const templateUrl = chrome.runtime.getURL('content/template-kate-story.png');
  const tmpl = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src = templateUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // 1. Fundo = template (limpo, sem placeholders — só desenhamos por cima)
  ctx.drawImage(tmpl, 0, 0, W, H);

  const parsed = data.parsed || {};
  const pct    = parsed.discount;
  const por    = parsed.pricePor;
  const de     = parsed.priceDe;
  const isMusculosas = data.group === 'musculosas';

  // ── ZONA 1: Headline (y = 0–235) ─────────────────────────────────────────
  // Texto em branco, negrito itálico, centralizado
  const FONT = _nunitoLoaded ? 'Nunito' : 'Arial Black, Arial';
  const keyword = (data.headlineWord || extractKeyword(parsed.name || '')).toUpperCase();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = '#ffffff';
  const FAM = `"${FONT}", sans-serif`;
  fitText(ctx, keyword, 960, p => `italic 800 ${p}px ${FAM}`, 92);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(keyword, W / 2, 108);

  if (pct) {
    const comStr = `COM ${pct}% OFF`;
    fitText(ctx, comStr, 960, p => `italic 800 ${p}px ${FAM}`, 70);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(comStr, W / 2, 188);
  }

  // ── ZONA 2: Pílula dourada (centro ≈266) — nome curto do produto ─────────
  const nameFull = parsed.name || '';
  const tmpFont  = `800 38px "${FONT}", sans-serif`;
  const pillText = simplifyName(ctx, nameFull, tmpFont, 660);
  ctx.font = tmpFont;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(pillText, W / 2, 270);

  // ── ZONA 3: Imagem do produto ────────────────────────────────────────────
  // Card rosa: y≈346–1330. Badge crimson no canto inf-esq (centro ≈234,1000)
  // e "achadinho de hoje" no canto inf-dir. Produto ocupa o miolo superior
  // (y≈400–960) para não colidir com badge/achadinho.
  if (imgEl && imgEl.naturalWidth > 0) {
    const AREA_X = 215, AREA_Y = 400, AREA_W = 650, AREA_H = 555;
    const ratio  = Math.min(AREA_W / imgEl.naturalWidth, AREA_H / imgEl.naturalHeight);
    const dw     = imgEl.naturalWidth  * ratio;
    const dh     = imgEl.naturalHeight * ratio;
    const dx     = AREA_X + (AREA_W - dw) / 2;
    const dy     = AREA_Y + (AREA_H - dh) / 2;
    ctx.save();
    ctx.shadowColor   = 'rgba(0,0,0,0.15)';
    ctx.shadowBlur    = 20;
    ctx.shadowOffsetY = 8;
    ctx.drawImage(imgEl, dx, dy, dw, dh);
    ctx.restore();
  }

  // ── ZONA 4: Texto do badge (círculo crimson, centro ≈234,1000) ───────────
  if (pct) {
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = '#ffffff';
    const pctFS = String(pct).length >= 3 ? 56 : 66;
    ctx.font = `800 ${pctFS}px "${FONT}", sans-serif`;
    ctx.fillText(`${pct}%`, 234, 985);
    ctx.font = `800 40px "${FONT}", sans-serif`;
    ctx.fillText('OFF', 234, 1042);
  }

  // ── ZONA 5: Card branco (y≈1362–1644) ────────────────────────────────────
  const isMusculosasColor = isMusculosas ? '#1565C0' : '#E91E8C';

  // De: riscado (y≈1408)
  if (de && por) {
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = '#aaaaaa';
    ctx.font         = '38px Arial, sans-serif';
    const deStr = `De: R$ ${fmtBR(de)}`;
    ctx.fillText(deStr, W / 2, 1408);
    const deW = ctx.measureText(deStr).width;
    ctx.strokeStyle = '#aaaaaa';
    ctx.lineWidth   = 2.5;
    ctx.beginPath();
    ctx.moveTo((W - deW) / 2, 1408);
    ctx.lineTo((W + deW) / 2, 1408);
    ctx.stroke();
  }

  // "Por:" label (y≈1475)
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = '#333333';
  ctx.font         = `800 46px "${FONT}", sans-serif`;
  ctx.fillText('Por:', W / 2, 1478);

  // Valor (y≈1560) — encolhe pra caber na largura do card branco
  if (por) {
    const porStr = `R$ ${fmtBR(por)}`;
    fitText(ctx, porStr, 660, p => `800 ${p}px "${FONT}", sans-serif`, parsed.coupon ? 96 : 104);
    ctx.fillStyle = isMusculosasColor;
    ctx.fillText(porStr, W / 2, 1560);
  }

  // Cupom (y≈1625) — só se houver
  if (parsed.coupon) {
    ctx.font      = `700 32px "${FONT}", sans-serif`;
    ctx.fillStyle = '#795548';
    ctx.fillText(`🎟 Cupom: ${parsed.coupon}`, W / 2, 1625);
  }

  // ── ZONA 6: Pílula inferior (y≈1740) — chamada ───────────────────────────
  ctx.font      = `700 40px "${FONT}", sans-serif`;
  ctx.fillStyle = isMusculosasColor;
  ctx.fillText('🔗  Link aqui', W / 2, 1742);

  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
  return canvas;
}

// ── Helpers de geometria ──────────────────────────────────────────────────────

function roundRect(ctx, x, y, w, h, topRadius) {
  const r = topRadius;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function roundRectFull(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Extrai a primeira palavra "significativa" do nome (pula artigos/preposições)
function extractKeyword(name) {
  const skip = new Set(['de', 'da', 'do', 'com', 'para', 'e', 'em', 'a', 'o']);
  const words = name.split(/\s+/);
  const kw = words.find(w => w.length > 2 && !skip.has(w.toLowerCase())) || words[0] || 'Oferta';
  return kw.length > 12 ? kw.slice(0, 12) : kw;
}

// Simplifica nome do produto: pega as primeiras palavras significativas até caber na largura.
// Ex: "Creatina Monohidratada 250g Growth Supplements" → "Creatina Monohidratada Growth"
function simplifyName(ctx, name, font, maxWidth) {
  ctx.font = font;
  // Remove tokens numéricos/unidades do meio, mantém marca e tipo
  const skip = new Set(['de', 'da', 'do', 'com', 'para', 'e', 'em', 'a', 'o', 'os', 'as', 'um', 'uma']);
  const tokens = name.split(/\s+/).filter(w => w.length > 0);
  // Separa palavras textuais de tokens de quantidade (ex: "250g", "2x", "Kit")
  const words = tokens.filter(w => !/^\d/.test(w));
  // Tenta encaixar progressivamente, pulando palavras de quantidade
  let result = '';
  for (const w of words) {
    const candidate = result ? `${result} ${w}` : w;
    if (ctx.measureText(candidate).width <= maxWidth) {
      if (!skip.has(w.toLowerCase())) result = candidate;
      else if (result) result = candidate; // preposição só entra se não for a primeira palavra
    } else {
      break;
    }
  }
  if (!result) result = truncateText(ctx, name, font, maxWidth);
  return result;
}

function truncateText(ctx, text, font, maxWidth) {
  ctx.font = font;
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (ctx.measureText(t + '…').width > maxWidth && t.length > 1) t = t.slice(0, -1);
  return t + '…';
}

// ── Legenda ────────────────────────────────────────────────────────────────────

function buildLegenda(data) {
  const parsed = data.parsed || {};
  const cat    = parsed.category || 'default';
  const tags   = IG_HASHTAGS[cat] || IG_HASHTAGS.default;

  const emoji = (parsed.openingEmoji || parsed.category && window.PromosConfig?.EMOJI_MAP?.[parsed.category]?.[0]) || '🔥';
  const name  = parsed.name || 'Produto';
  const por   = parsed.pricePor;
  const de    = parsed.priceDe;
  const pct   = parsed.discount;
  const isMusculosas = data.group === 'musculosas';

  const lines = [];
  lines.push(`${emoji} ${name}`);
  lines.push('');

  if (de && por && pct) {
    lines.push(`💰 De R$ ${fmtBR(de)} por apenas R$ ${fmtBR(por)} (−${pct}% OFF)`);
  } else if (por) {
    lines.push(`💰 Por apenas R$ ${fmtBR(por)}`);
  }

  if (parsed.coupon) {
    lines.push(`🎟️ Cupom: ${parsed.coupon}`);
  }

  lines.push('');
  lines.push('🔗 Link na bio 👆');
  lines.push('');

  if (isMusculosas) {
    lines.push('💪 Grupo de ofertas fitness → linktr.ee/promosdakate');
  } else {
    lines.push('❣️ Entre no grupo VIP → linktr.ee/promosdakate');
  }

  lines.push('');
  lines.push('・・・');
  lines.push(tags);

  return lines.join('\n');
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function wrapText(ctx, text, maxWidth, maxLines) {
  const words = text.split(' ');
  const lines = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    } else {
      current = test;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);

  // Trunca última linha com reticências se necessário
  const last = lines[lines.length - 1];
  if (last && ctx.measureText(last).width > maxWidth) {
    let truncated = last;
    while (ctx.measureText(truncated + '…').width > maxWidth && truncated.length > 1) {
      truncated = truncated.slice(0, -1);
    }
    lines[lines.length - 1] = truncated + '…';
  }

  return lines;
}

// ── Canva Bulk Create ─────────────────────────────────────────────────────────

function buildCanvaPayload(data, imageUrl) {
  const parsed  = data.parsed || {};
  const keyword = (data.headlineWord || extractKeyword(parsed.name || '')).toUpperCase();
  const pct     = parsed.discount;
  const por     = parsed.pricePor;
  const de      = parsed.priceDe;

  const headline = pct ? `${keyword} com ${pct}% OFF` : `${keyword} em OFERTA`;
  const nome     = simplifyNameRaw(parsed.name || '');
  const preco_de = de  ? `De: R$ ${fmtBR(de)}` : '';
  const desconto = pct ? `${pct}%` : '';

  let preco_inteiro = '', preco_decimal = '';
  if (por) {
    const { inteiro, decimal } = splitPriceBR(por);
    preco_inteiro = inteiro;
    preco_decimal = decimal;
  }

  const cupom = (data.parsed?.coupon || '').toUpperCase();

  return { headline, nome, preco_de, desconto, preco_inteiro, preco_decimal, cupom, imagem: imageUrl || '' };
}

function buildCanvaCSV(payload) {
  const headers = Object.keys(payload);
  const values  = Object.values(payload);
  const csvRow  = values.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  return '﻿' + headers.join(',') + '\r\n' + csvRow + '\r\n';
}

// Versão de simplifyName sem canvas context (para uso no CSV)
function simplifyNameRaw(name) {
  const skip  = new Set(['de', 'da', 'do', 'com', 'para', 'e', 'em', 'a', 'o', 'os', 'as']);
  const words = name.split(/\s+/).filter(w => w.length > 0 && !/^\d/.test(w));
  const result = [];
  for (const w of words) {
    if (result.join(' ').length > 40) break;
    if (!skip.has(w.toLowerCase()) || result.length > 0) result.push(w);
  }
  return result.slice(0, 5).join(' ') || name.slice(0, 40);
}

// Upload de imagem para imgbb — retorna URL pública
async function uploadToImgbb(imgEl, apiKey) {
  const canvas = document.createElement('canvas');
  canvas.width  = imgEl.naturalWidth  || imgEl.width;
  canvas.height = imgEl.naturalHeight || imgEl.height;
  canvas.getContext('2d').drawImage(imgEl, 0, 0);
  const base64 = canvas.toDataURL('image/png').split(',')[1];

  const form = new FormData();
  form.append('image', base64);
  const resp = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, { method: 'POST', body: form });
  const json = await resp.json();
  if (!json.success) throw new Error('imgbb: ' + (json.error?.message || 'falha'));
  return json.data.url;
}

function downloadText(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

// Busca a imagem como blob (contorna CORS para operações de canvas)
async function fetchImageForCanvas(src) {
  const resp = await fetch(src);
  const blob = await resp.blob();
  const url  = URL.createObjectURL(blob);
  const img  = new Image();
  img.src    = url;
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; setTimeout(rej, 6000); });
  return img;
}

// Remove fundo branco/claro via flood-fill BFS a partir dos cantos.
// A cor de referência é FIXADA no pixel do canto e nunca deriva — evita
// "comer" o produto mesmo quando ele tem tons claros.
function removeBackground(imgEl, tolerance = 24) {
  const W = imgEl.naturalWidth  || imgEl.width;
  const H = imgEl.naturalHeight || imgEl.height;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(imgEl, 0, 0);

  const imgData = ctx.getImageData(0, 0, W, H);
  const d       = imgData.data;
  const visited = new Uint8Array(W * H);

  // Amostra cor do fundo nos cantos e bordas (média dos cantos claros)
  const cornerPts = [[0,0],[W-1,0],[0,H-1],[W-1,H-1]];
  let bgR = 0, bgG = 0, bgB = 0, bgN = 0;
  for (const [cx, cy] of cornerPts) {
    const i = (cy * W + cx) * 4;
    if (d[i] > 200 && d[i+1] > 200 && d[i+2] > 200) {
      bgR += d[i]; bgG += d[i+1]; bgB += d[i+2]; bgN++;
    }
  }
  if (bgN === 0) return canvas; // sem fundo claro detectado, retorna original

  bgR = bgR / bgN; bgG = bgG / bgN; bgB = bgB / bgN;

  // BFS — cada pixel é testado contra a COR FIXA do fundo, não do vizinho
  const queue = [];
  const seedPts = [
    [0,0],[W-1,0],[0,H-1],[W-1,H-1],
    [Math.floor(W/2),0],[0,Math.floor(H/2)],
    [W-1,Math.floor(H/2)],[Math.floor(W/2),H-1],
  ];
  for (const [sx, sy] of seedPts) {
    const i = (sy * W + sx) * 4;
    if (d[i] > 200 && d[i+1] > 200 && d[i+2] > 200) {
      queue.push(sy * W + sx);
    }
  }

  let qi = 0;
  let removed = 0;
  while (qi < queue.length) {
    const pos = queue[qi++];
    if (visited[pos]) continue;
    visited[pos] = 1;

    const i = pos * 4;
    const r = d[i], g = d[i+1], b = d[i+2];

    // Distância contra a cor FIXA do fundo
    if (Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB) > tolerance * 3) continue;

    d[i + 3] = 0; // transparente
    removed++;

    const x = pos % W, y = Math.floor(pos / W);
    if (x > 0)   queue.push(pos - 1);
    if (x < W-1) queue.push(pos + 1);
    if (y > 0)   queue.push(pos - W);
    if (y < H-1) queue.push(pos + W);
  }

  // Segurança: se o flood comeu mais de 70% da imagem, provavelmente o produto
  // é claro e encosta no fundo — desfaz e devolve o original (produto > sem produto).
  if (removed / (W * H) > 0.70) {
    const fresh = document.createElement('canvas');
    fresh.width = W; fresh.height = H;
    fresh.getContext('2d').drawImage(imgEl, 0, 0);
    fresh._bgRemovalAborted = true;
    return fresh;
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

// Converte qualquer formato de preço (número, "1.299", "39,90", "1.234,56",
// "R$ 1.234,56") num Number confiável.
function toNumberBR(v) {
  if (typeof v === 'number') return v;
  if (v == null) return NaN;
  let s = String(v).trim().replace(/[^\d.,]/g, '');
  if (s.includes(',')) {
    // vírgula = decimal; pontos = milhar
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes('.')) {
    const parts = s.split('.');
    // último grupo com 3 dígitos → ponto é separador de milhar (1.299 = 1299)
    if (parts[parts.length - 1].length === 3) s = parts.join('');
    // senão, ponto é decimal (39.90) — mantém
  }
  return Number(s);
}

function fmtBR(n) {
  const num = toNumberBR(n);
  if (isNaN(num)) return String(n);
  const [int, dec] = num.toFixed(2).split('.');
  const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${intFmt},${dec}`;
}

// Divide um preço em parte inteira (com milhar) e decimal (",XX"), sempre 2 dígitos.
function splitPriceBR(v) {
  const num = toNumberBR(v);
  if (isNaN(num)) return { inteiro: String(v), decimal: '00' };
  const [int, dec] = num.toFixed(2).split('.');
  return {
    inteiro: int.replace(/\B(?=(\d{3})+(?!\d))/g, '.'),
    decimal: dec, // só os 2 dígitos, SEM vírgula — ela fica fixa no template do Canva
  };
}

function downloadCanvas(canvas, filename) {
  const a = document.createElement('a');
  a.download = filename;
  a.href = canvas.toDataURL('image/png');
  a.click();
}

// Copia o canvas (PNG) para a área de transferência
async function copyCanvas(canvas) {
  const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('falha ao gerar PNG');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

// Copia uma <img> (ex: produto com fundo removido) como PNG transparente
async function copyImageEl(img) {
  const c = document.createElement('canvas');
  c.width  = img.naturalWidth  || img.width;
  c.height = img.naturalHeight || img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  await copyCanvas(c);
}

// Encolhe a fonte até o texto caber em maxW. makeFont(px) retorna a string de fonte.
// Deixa ctx.font configurado no tamanho final.
function fitText(ctx, text, maxW, makeFont, startPx, minPx = 12) {
  let px = startPx;
  ctx.font = makeFont(px);
  while (ctx.measureText(text).width > maxW && px > minPx) {
    px -= 2;
    ctx.font = makeFont(px);
  }
  return px;
}

function igBtn(text, className) {
  const btn = document.createElement('button');
  btn.className = className;
  btn.innerHTML = text;
  return btn;
}

function igFeedback(el, msg) {
  el.textContent = msg;
  setTimeout(() => { el.textContent = ''; }, 2500);
}

window.PromosInstagram = { showIGPanel };

// Bridge: permite setar chrome.storage a partir do contexto da página
window.addEventListener('promos:setStorage', (e) => {
  if (e.detail && typeof e.detail === 'object') {
    chrome.storage.local.set(e.detail);
  }
});
window.addEventListener('promos:getStorage', async (e) => {
  if (!e.detail?.keys) return;
  const data = await chrome.storage.local.get(e.detail.keys);
  window.dispatchEvent(new CustomEvent('promos:storageResult', { detail: data }));
});

// Salva produto no lote local (chrome.storage) — máx 20 itens.
// Resiliente a estouro de cota: as imagens (data URL) são o que mais pesa, então
// se o set falhar vamos descartando imagens dos itens mais antigos e tentando de
// novo — o produto NUNCA se perde por causa do tamanho da foto.
async function saveToBatch(item) {
  const { canvaBatch = [] } = await chrome.storage.local.get('canvaBatch');
  canvaBatch.push(item);
  while (canvaBatch.length > 20) canvaBatch.shift();

  try {
    await chrome.storage.local.set({ canvaBatch });
    return;
  } catch (err) {
    console.warn('[Promos] storage cheio ao salvar no Lote, aliviando imagens antigas:', err);
  }
  // 2ª tentativa: zera a imagem de todos menos o item recém-adicionado
  for (let i = 0; i < canvaBatch.length - 1; i++) canvaBatch[i].imageDataUrl = '';
  try {
    await chrome.storage.local.set({ canvaBatch });
    return;
  } catch (err2) {
    console.warn('[Promos] ainda cheio, salvando sem imagens:', err2);
  }
  // Último recurso: salva sem nenhuma imagem (preserva nome/legenda/link)
  canvaBatch.forEach(it => { it.imageDataUrl = ''; });
  await chrome.storage.local.set({ canvaBatch });
}

// Converte img element → data URL via canvas (para persistir a imagem sem a aba).
// Reduz para no máx. 600px e usa JPEG: foto em PNG é grande demais e estoura a
// cota do storage depois de poucos itens.
async function canvasToDataUrl(imgEl) {
  try {
    const sw = imgEl.naturalWidth  || imgEl.width  || 400;
    const sh = imgEl.naturalHeight || imgEl.height || 400;
    const scale = Math.min(1, 600 / sw);
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(imgEl, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.8);
  } catch (_) { return ''; }
}

function makeDraggable(card) {
  let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;

  card.addEventListener('mousedown', e => {
    if (['INPUT','BUTTON','SELECT','TEXTAREA','A'].includes(e.target.tagName)) return;
    e.preventDefault();

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
    card.style.cursor     = 'grabbing';
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
    card.style.cursor     = '';
    card.style.userSelect = '';
  });

  card.style.cursor = 'grab';
}

})();
