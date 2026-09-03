(function () {
if (window.PromosBatch) return;
window.PromosBatch = true;

// ── Abrir / fechar painel ────────────────────────────────────────────────────

async function showBatchPanel() {
  removeBatchPanel();

  const { canvaBatch = [], canvaDesignUrl, metaStoryUrl } = await chrome.storage.local.get(['canvaBatch', 'canvaDesignUrl', 'metaStoryUrl']);

  const backdrop = document.createElement('div');
  backdrop.id = 'promos-batch-overlay';
  Object.assign(backdrop.style, {
    position: 'fixed', inset: '0', zIndex: '2147483646',
    background: 'rgba(0,0,0,0.55)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  });
  backdrop.addEventListener('click', e => { if (e.target === backdrop) removeBatchPanel(); });

  const card = document.createElement('div');
  Object.assign(card.style, {
    background: '#fff', borderRadius: '12px', padding: '20px',
    width: '480px', maxHeight: '90vh', overflowY: 'auto',
    boxShadow: '0 8px 32px rgba(0,0,0,0.28)',
    display: 'flex', flexDirection: 'column', gap: '12px',
    boxSizing: 'border-box',
    fontSize: '14px', color: '#1a1a1a',
  });
  makeDraggable(card);

  // Header
  const header = document.createElement('div');
  Object.assign(header.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between' });

  const title = document.createElement('span');
  title.style.cssText = 'font-weight:700;font-size:15px;';
  title.textContent = `📦 Lote do Canva (${canvaBatch.length} produto${canvaBatch.length !== 1 ? 's' : ''})`;
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;font-size:18px;cursor:pointer;color:#666;padding:0 4px;';
  closeBtn.addEventListener('click', removeBatchPanel);
  header.appendChild(closeBtn);
  card.appendChild(header);

  // Lista de produtos
  if (canvaBatch.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'color:#888;text-align:center;padding:24px 0;font-size:13px;';
    empty.textContent = 'Nenhum produto exportado ainda. Clique em "Exportar p/ Canva" em qualquer produto.';
    card.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

    canvaBatch.slice().reverse().forEach((item, idx) => {
      const realIdx = canvaBatch.length - 1 - idx;
      list.appendChild(buildItemRow(item, realIdx, canvaBatch, title, list, metaStoryUrl));
    });
    card.appendChild(list);
  }

  // Rodapé — limpar + abrir Canva
  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:8px;border-top:1px solid #eee;padding-top:12px;margin-top:4px;';

  const btnClear = makeBtn('🧹 Limpar lote', '#f5f5f5', '#333');
  const SHEETS_EXPORT_URL = 'https://docs.google.com/spreadsheets/d/1604bviFZ07q8eKg7GrYKTJUytZKxUwemUK06l1XYK8E/export?format=xlsx&gid=0';

  btnClear.addEventListener('click', async () => {
    if (!confirm('Baixar a planilha do Canva e limpá-la?')) return;

    // 1. Baixa o .xlsx atual como backup
    window.open(SHEETS_EXPORT_URL, '_blank');

    // 2. Limpa os dados da planilha via Apps Script (mantém cabeçalho)
    const { sheetsScriptUrl } = await chrome.storage.local.get('sheetsScriptUrl');
    if (sheetsScriptUrl) {
      try {
        await fetch(sheetsScriptUrl, {
          method: 'POST',
          body: JSON.stringify({ action: 'clear' }),
        });
      } catch (e) {
        console.warn('[Promos] Falha ao limpar planilha:', e);
      }
    }

    // 3. Limpa o lote local
    await chrome.storage.local.set({ canvaBatch: [] });
    removeBatchPanel();
    showBatchPanel();
  });

  const btnCanva = makeBtn('🎨 Abrir Canva', '#E91E8C', '#fff');
  btnCanva.addEventListener('click', () => {
    window.open(canvaDesignUrl || 'https://www.canva.com/', 'promos_canva');
  });

  const btnMeta = makeBtn('📅 Agendar Story', '#1877F2', '#fff');
  btnMeta.addEventListener('click', () => {
    const url = metaStoryUrl || 'https://business.facebook.com/latest/story_composer/';
    window.open(url, 'promos_meta');
  });

  footer.appendChild(btnClear);
  footer.appendChild(btnCanva);
  footer.appendChild(btnMeta);
  card.appendChild(footer);

  backdrop.appendChild(card);
  document.body.appendChild(backdrop);
}

function buildItemRow(item, idx, batch, titleEl, listEl, metaStoryUrl) {
  const row = document.createElement('div');
  row.style.cssText = `display:flex;gap:10px;align-items:flex-start;padding:10px;
    background:#fafafa;border-radius:8px;border:1px solid #eee;`;

  // Thumbnail
  const thumb = document.createElement('img');
  thumb.style.cssText = 'width:56px;height:56px;object-fit:contain;border-radius:6px;background:#f0f0f0;flex-shrink:0;';
  thumb.src = item.imageDataUrl || item.imageUrl || '';
  row.appendChild(thumb);

  // Info + botões
  const info = document.createElement('div');
  info.style.cssText = 'display:flex;flex-direction:column;gap:6px;flex:1;min-width:0;';

  const name = document.createElement('div');
  name.style.cssText = 'font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  name.textContent = item.nome || 'Produto';
  name.title = item.nome || '';

  const date = document.createElement('div');
  date.style.cssText = 'font-size:11px;color:#aaa;display:flex;align-items:center;gap:6px;';
  const dateTxt = document.createElement('span');
  dateTxt.textContent = new Date(item.exportedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  date.appendChild(dateTxt);

  // Selo de cupom: do campo explícito ou detectado na legenda (a linha de cupom
  // usa "🎟"/"Cupom:"; o #cupom das hashtags não tem dois-pontos, não confunde).
  const hasCoupon = !!item.coupon || /🎟|cupom\s*:/i.test(item.legenda || '');
  const cupomBadge = document.createElement('span');
  cupomBadge.style.cssText = hasCoupon
    ? 'font-size:10px;font-weight:700;color:#1a7f37;background:#e8f5e9;border-radius:4px;padding:1px 5px;'
    : 'font-size:10px;color:#bbb;';
  cupomBadge.textContent = hasCoupon ? '🎟️ cupom' : 'sem cupom';
  date.appendChild(cupomBadge);

  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';

  const fb = document.createElement('span');
  fb.style.cssText = 'font-size:11px;color:#4caf50;min-height:14px;';

  // Copiar link de afiliado
  if (item.affiliateUrl) {
    const btnLink = makeBtn('🔗 Link', '#f0f0f0', '#333');
    btnLink.style.fontSize = '12px';
    btnLink.title = item.affiliateUrl;
    btnLink.addEventListener('click', () => {
      navigator.clipboard.writeText(item.affiliateUrl)
        .then(() => { fb.textContent = '✅ Link copiado!'; setTimeout(() => { fb.textContent = ''; }, 2000); })
        .catch(() => { fb.textContent = '❌ Falha'; });
    });
    btns.appendChild(btnLink);
  }

  // Copiar legenda
  const btnLeg = makeBtn('📋 Legenda', '#f0f0f0', '#333');
  btnLeg.style.fontSize = '12px';
  btnLeg.addEventListener('click', () => {
    navigator.clipboard.writeText(item.legenda || '')
      .then(() => { fb.textContent = '✅ Legenda copiada!'; setTimeout(() => { fb.textContent = ''; }, 2000); })
      .catch(() => { fb.textContent = '❌ Falha'; });
  });

  // Copiar imagem
  const btnImg = makeBtn('📋 Imagem', '#f0f0f0', '#333');
  btnImg.style.fontSize = '12px';
  btnImg.addEventListener('click', async () => {
    try {
      const src = item.imageDataUrl || item.imageUrl;
      if (!src) throw new Error('sem imagem');
      const img = new Image();
      img.src = src;
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; setTimeout(rej, 5000); });
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      const blob = await new Promise(res => c.toBlob(res, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      fb.textContent = '✅ Imagem copiada!';
    } catch (_) { fb.textContent = '❌ Falha ao copiar'; }
    setTimeout(() => { fb.textContent = ''; }, 2000);
  });

  // Ver legenda expandida
  let legendaVisible = false;
  const btnVer = makeBtn('👁 Ver', '#f0f0f0', '#333');
  btnVer.style.fontSize = '12px';
  const legendaBox = document.createElement('textarea');
  legendaBox.value = item.legenda || '';
  legendaBox.style.cssText = 'display:none;width:100%;height:100px;font-size:12px;border:1px solid #ddd;border-radius:6px;padding:6px;resize:vertical;box-sizing:border-box;';
  btnVer.addEventListener('click', () => {
    legendaVisible = !legendaVisible;
    legendaBox.style.display = legendaVisible ? 'block' : 'none';
    btnVer.textContent = legendaVisible ? '👁 Fechar' : '👁 Ver';
  });

  // Agendar story no Meta Business Suite
  const btnMeta = makeBtn('📅 Story', '#f0f0f0', '#1877F2');
  btnMeta.style.fontSize = '12px';
  btnMeta.addEventListener('click', async () => {
    const { metaStoryUrl: u } = await chrome.storage.local.get('metaStoryUrl');
    window.open(u || 'https://business.facebook.com/latest/story_composer/', 'promos_meta');
  });

  // Remover item do lote
  const btnDel = makeBtn('✕', '#fce4ec', '#c62828');
  btnDel.style.fontSize = '11px';
  btnDel.title = 'Remover do lote';
  btnDel.addEventListener('click', async () => {
    batch.splice(idx, 1);
    await chrome.storage.local.set({ canvaBatch: batch });
    row.remove();
    titleEl.textContent = `📦 Lote do Canva (${batch.length} produto${batch.length !== 1 ? 's' : ''})`;
  });

  btns.appendChild(btnLeg);
  btns.appendChild(btnImg);
  btns.appendChild(btnVer);
  btns.appendChild(btnMeta);
  btns.appendChild(btnDel);

  info.appendChild(name);
  info.appendChild(date);
  info.appendChild(btns);
  info.appendChild(fb);
  info.appendChild(legendaBox);
  row.appendChild(info);
  return row;
}

function removeBatchPanel() {
  document.getElementById('promos-batch-overlay')?.remove();
}

// ── Helpers ──────────────────────────────────────────────────────────────────


function makeBtn(text, bg, color) {
  const b = document.createElement('button');
  b.textContent = text;
  Object.assign(b.style, {
    background: bg, color, border: 'none', borderRadius: '6px',
    padding: '5px 10px', cursor: 'pointer', fontWeight: '600',
    fontSize: '13px', whiteSpace: 'nowrap',
  });
  return b;
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
    startX = e.clientX; startY = e.clientY;
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
    card.style.cursor = 'grab';
    card.style.userSelect = '';
  });
  card.style.cursor = 'grab';
}

// ── Painel de Frase/Meme ─────────────────────────────────────────────────────

function removeFrasePanel() {
  document.getElementById('promos-frase-overlay')?.remove();
}

function showFrasePanel() {
  removeFrasePanel();

  const backdrop = document.createElement('div');
  backdrop.id = 'promos-frase-overlay';
  Object.assign(backdrop.style, {
    position: 'fixed', inset: '0', zIndex: '2147483647',
    background: 'rgba(0,0,0,0.55)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  });
  backdrop.addEventListener('click', e => { if (e.target === backdrop) removeFrasePanel(); });

  const card = document.createElement('div');
  Object.assign(card.style, {
    background: '#fff', borderRadius: '12px', padding: '20px',
    width: '420px', boxShadow: '0 8px 32px rgba(0,0,0,0.28)',
    display: 'flex', flexDirection: 'column', gap: '14px',
    boxSizing: 'border-box', fontSize: '14px', color: '#1a1a1a',
  });
  makeDraggable(card);

  // Header
  const header = document.createElement('div');
  Object.assign(header.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between' });
  const titleEl = document.createElement('span');
  titleEl.style.cssText = 'font-weight:700;font-size:15px;';
  titleEl.textContent = '📝 Criar Post de Frase';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;font-size:18px;cursor:pointer;color:#666;padding:0 4px;';
  closeBtn.addEventListener('click', removeFrasePanel);
  header.appendChild(titleEl);
  header.appendChild(closeBtn);
  card.appendChild(header);

  const label = document.createElement('label');
  label.style.cssText = 'font-size:12px;font-weight:600;color:#555;';
  label.textContent = 'Digite a frase:';
  card.appendChild(label);

  const textarea = document.createElement('textarea');
  textarea.placeholder = 'Ex: Muito ruim gastar nosso próprio dinheiro, quero gastar o de alguém kkkkk 😭';
  textarea.style.cssText = 'width:100%;height:90px;font-size:13px;color:#1a1a1a;background:#fff;border:1px solid #ddd;border-radius:8px;padding:8px;resize:vertical;box-sizing:border-box;font-family:inherit;';
  card.appendChild(textarea);

  // Preview sempre visível
  const previewWrap = document.createElement('div');
  previewWrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;align-items:center;';

  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1080;
  canvas.style.cssText = 'width:100%;border-radius:8px;border:1px solid #eee;';
  previewWrap.appendChild(canvas);

  const actionRow = document.createElement('div');
  actionRow.style.cssText = 'display:flex;gap:8px;width:100%;align-items:center;';

  const btnCopyImg = makeBtn('📋 Copiar imagem', '#1a73e8', '#fff');
  const btnDown    = makeBtn('⬇️ Baixar', '#f5f5f5', '#333');
  const fb2 = document.createElement('span');
  fb2.style.cssText = 'font-size:12px;color:#4caf50;flex:1;text-align:right;';

  btnCopyImg.style.flex = '1';
  btnDown.style.flex    = '1';

  btnCopyImg.addEventListener('click', async () => {
    try {
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      fb2.textContent = '✅ Copiada!';
    } catch (_) { fb2.textContent = '❌ Falha'; }
    setTimeout(() => { fb2.textContent = ''; }, 2000);
  });

  btnDown.addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    const slug = textarea.value.slice(0, 30).replace(/[^a-zA-Z0-9À-ú ]/g, '').trim().replace(/ /g, '_');
    a.download = `kate-frase-${slug || 'post'}.png`;
    a.click();
  });

  actionRow.appendChild(btnCopyImg);
  actionRow.appendChild(btnDown);
  actionRow.appendChild(fb2);
  previewWrap.appendChild(actionRow);
  card.appendChild(previewWrap);

  // Emoji picker
  const emojiSection = document.createElement('div');
  emojiSection.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

  const emojiLabel = document.createElement('span');
  emojiLabel.style.cssText = 'font-size:12px;font-weight:600;color:#555;';
  emojiLabel.textContent = 'Emojis:';
  emojiSection.appendChild(emojiLabel);

  const emojiGrid = document.createElement('div');
  emojiGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';

  const EMOJIS = [
    '😂','😭','🤣','😅','🥹','😍','🤩','😎','🤑','😤',
    '💀','❤️','🔥','✨','💅','👏','🙌','💪','🛒','💳',
    '🏷️','💸','💰','🎁','🎉','⚡','🚨','👀','📦','🤭',
    '😱','🥰','🫶','💖','🪄','🛍️','💄','👗','👟','🍀',
  ];

  for (const emoji of EMOJIS) {
    const btn = document.createElement('button');
    btn.textContent = emoji;
    btn.style.cssText = 'background:#f5f5f5;border:none;border-radius:6px;padding:4px 6px;font-size:18px;cursor:pointer;line-height:1;';
    btn.title = 'Inserir ' + emoji;
    btn.addEventListener('click', () => {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const val = textarea.value;
      textarea.value = val.slice(0, start) + emoji + val.slice(end);
      textarea.selectionStart = textarea.selectionEnd = start + emoji.length;
      textarea.focus();
      // Dispara live preview
      textarea.dispatchEvent(new Event('input'));
    });
    emojiGrid.appendChild(btn);
  }
  emojiSection.appendChild(emojiGrid);
  card.appendChild(emojiSection);

  // ── Controles de estilo ───────────────────────────────────────────────────
  const styleRow = document.createElement('div');
  styleRow.style.cssText = 'display:flex;gap:10px;align-items:flex-end;';

  // Alinhamento
  const alignWrap = document.createElement('div');
  alignWrap.style.cssText = 'display:flex;flex-direction:column;gap:5px;flex:1;';
  const alignLabel = document.createElement('span');
  alignLabel.style.cssText = 'font-size:12px;font-weight:600;color:#555;';
  alignLabel.textContent = 'Alinhamento:';
  alignWrap.appendChild(alignLabel);

  const alignBtns = document.createElement('div');
  alignBtns.style.cssText = 'display:flex;gap:6px;';
  let fraseAlign = 'center'; // estado

  const mkAlignBtn = (val, icon) => {
    const b = document.createElement('button');
    b.textContent = icon;
    b.title = val === 'center' ? 'Centralizado' : 'Esquerda';
    b.dataset.val = val;
    b.style.cssText = 'flex:1;padding:6px;border-radius:6px;border:2px solid transparent;font-size:18px;cursor:pointer;background:#f5f5f5;transition:border-color .15s;';
    b.addEventListener('click', () => {
      fraseAlign = val;
      alignBtns.querySelectorAll('button').forEach(x => x.style.borderColor = 'transparent');
      b.style.borderColor = '#E91E8C';
      triggerPreview();
    });
    return b;
  };

  const btnAlignC = mkAlignBtn('center', '≡');
  const btnAlignL = mkAlignBtn('left',   '≡');
  btnAlignL.style.textAlign = 'left';
  btnAlignC.style.borderColor = '#E91E8C'; // padrão: centro
  alignBtns.appendChild(btnAlignC);
  alignBtns.appendChild(btnAlignL);
  alignWrap.appendChild(alignBtns);

  // Tamanho de fonte
  const sizeWrap = document.createElement('div');
  sizeWrap.style.cssText = 'display:flex;flex-direction:column;gap:5px;flex:1;';
  const sizeLabel = document.createElement('span');
  sizeLabel.style.cssText = 'font-size:12px;font-weight:600;color:#555;';
  sizeLabel.textContent = 'Tam. da fonte:';
  sizeWrap.appendChild(sizeLabel);

  const sizeInnerRow = document.createElement('div');
  sizeInnerRow.style.cssText = 'display:flex;gap:6px;align-items:center;';
  let fraseFontSize = 0; // 0 = automático

  const sizeSlider = document.createElement('input');
  sizeSlider.type = 'range';
  sizeSlider.min = '30'; sizeSlider.max = '100'; sizeSlider.value = '72';
  sizeSlider.style.cssText = 'flex:1;cursor:pointer;';

  const sizeDisplay = document.createElement('span');
  sizeDisplay.style.cssText = 'font-size:12px;font-weight:600;color:#1a1a1a;min-width:42px;text-align:right;';
  sizeDisplay.textContent = 'Auto';

  const btnAutoSize = document.createElement('button');
  btnAutoSize.textContent = 'Auto';
  btnAutoSize.title = 'Ajuste automático de tamanho';
  btnAutoSize.style.cssText = 'font-size:11px;padding:3px 7px;border-radius:5px;border:1px solid #E91E8C;background:#fff;color:#E91E8C;cursor:pointer;white-space:nowrap;';
  btnAutoSize.addEventListener('click', () => {
    fraseFontSize = 0;
    sizeDisplay.textContent = 'Auto';
    btnAutoSize.style.background = '#E91E8C';
    btnAutoSize.style.color = '#fff';
    triggerPreview();
  });
  btnAutoSize.style.background = '#E91E8C';
  btnAutoSize.style.color = '#fff';

  sizeSlider.addEventListener('input', () => {
    fraseFontSize = parseInt(sizeSlider.value);
    sizeDisplay.textContent = fraseFontSize + 'px';
    btnAutoSize.style.background = '#fff';
    btnAutoSize.style.color = '#E91E8C';
    triggerPreview();
  });

  sizeInnerRow.appendChild(sizeSlider);
  sizeInnerRow.appendChild(sizeDisplay);
  sizeWrap.appendChild(sizeInnerRow);
  sizeWrap.appendChild(btnAutoSize);

  styleRow.appendChild(alignWrap);
  styleRow.appendChild(sizeWrap);
  card.appendChild(styleRow);

  // ── Posição vertical ──────────────────────────────────────────────────────
  const posWrap = document.createElement('div');
  posWrap.style.cssText = 'display:flex;flex-direction:column;gap:5px;';

  const posLabel = document.createElement('span');
  posLabel.style.cssText = 'font-size:12px;font-weight:600;color:#555;';
  posLabel.textContent = 'Posição vertical do texto:';
  posWrap.appendChild(posLabel);

  const posRow = document.createElement('div');
  posRow.style.cssText = 'display:flex;gap:8px;align-items:center;';

  const posSlider = document.createElement('input');
  posSlider.type = 'range';
  posSlider.min = '0'; posSlider.max = '100'; posSlider.value = '50';
  posSlider.style.cssText = 'flex:1;cursor:pointer;';

  const posDisplay = document.createElement('span');
  posDisplay.style.cssText = 'font-size:12px;font-weight:600;color:#1a1a1a;min-width:36px;text-align:right;';
  posDisplay.textContent = '50%';

  let frasePosY = 50; // % da área disponível (0 = topo, 50 = meio, 100 = fundo)

  posSlider.addEventListener('input', () => {
    frasePosY = parseInt(posSlider.value);
    posDisplay.textContent = frasePosY + '%';
    triggerPreview();
  });

  posRow.appendChild(posSlider);
  posRow.appendChild(posDisplay);
  posWrap.appendChild(posRow);
  card.appendChild(posWrap);

  const btnGerar = makeBtn('🎨 Gerar imagem', '#E91E8C', '#fff');
  Object.assign(btnGerar.style, { width: '100%', padding: '10px', fontSize: '14px' });
  btnGerar.addEventListener('click', () => gerarFraseMeme(canvas, textarea.value.trim(), btnGerar, fraseAlign, fraseFontSize, frasePosY));
  card.appendChild(btnGerar);

  // Live preview com debounce
  let debounceTimer = null;
  function triggerPreview() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const val = textarea.value.trim();
      gerarFraseMeme(canvas, val, btnGerar, fraseAlign, fraseFontSize, frasePosY);
    }, 300);
  }
  textarea.addEventListener('input', triggerPreview);

  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  // Desenha canvas inicial com placeholder
  gerarFraseMeme(canvas, '', btnGerar);
  textarea.focus();
}

// Logo recebida pelo message do SW (data URL já resolvida, sem CSP)
let _fraseLogoDataUrl = null;
let _fraseLogoImg     = null;

async function _loadFraseLogo() {
  if (_fraseLogoImg) return _fraseLogoImg;
  if (!_fraseLogoDataUrl) return null;
  return new Promise(resolve => {
    const img = new Image();
    img.onload  = () => { _fraseLogoImg = img; resolve(img); };
    img.onerror = () => resolve(null);
    img.src = _fraseLogoDataUrl;
  });
}

async function gerarFraseMeme(canvas, frase, btnGerar, align = 'center', fixedFontSize = 0, posY = 50) {
  const ctx = canvas.getContext('2d');
  const W = 1080, H = 1080;
  const PAD       = 52;   // margem externa
  const LOGO_SIZE = 200;  // diâmetro do avatar

  // Fundo branco
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // ── Avatar circular ──────────────────────────────────────────────────────
  const cx = PAD + LOGO_SIZE / 2;
  const cy = PAD + LOGO_SIZE / 2;

  const logoImg = await _loadFraseLogo();
  if (logoImg) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, LOGO_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logoImg, PAD, PAD, LOGO_SIZE, LOGO_SIZE);
    ctx.restore();
  } else {
    // Fallback enquanto logo não carrega
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, LOGO_SIZE / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#E91E8C';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 56px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('K', cx, cy);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.restore();
  }

  // ── Nome e handle ao lado do avatar ──────────────────────────────────────
  const nameFont   = 'bold 36px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const handleFont = '28px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const lineGap    = 42;
  const textX      = PAD + LOGO_SIZE + 22;
  // Centro vertical do bloco de 2 linhas alinhado ao centro do avatar
  const blockH     = 36 + lineGap;
  const nameY      = cy - blockH / 2 + 36;

  ctx.textAlign   = 'left';
  ctx.fillStyle   = '#1a1a1a';
  ctx.font        = nameFont;
  ctx.fillText('Promos da Kate', textX, nameY);

  ctx.fillStyle   = '#888888';
  ctx.font        = handleFont;
  ctx.fillText('@kate.promos', textX, nameY + lineGap);

  if (!frase) {
    // Placeholder cinza centralizado
    ctx.fillStyle = '#cccccc';
    ctx.font = 'italic 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Digite a frase acima…', W / 2, H / 2);
    ctx.textAlign = 'left';
    return;
  }

  // Posição vertical do texto: posY% da área entre o cabeçalho e o fundo
  const headerBottom = PAD + LOGO_SIZE + 32; // espaço livre após avatar
  const maxW = align === 'left' ? W - PAD * 2 - 20 : W - PAD * 2;
  const lines = fixedFontSize > 0
    ? wrapFraseLines(ctx, frase, maxW, fixedFontSize, true)
    : wrapFraseLines(ctx, frase, maxW);
  const lineH = Math.round(lines.fontSize * 1.35);
  const totalH = lines.texts.length * lineH;
  const areaH = H - headerBottom - PAD; // área útil total
  // posY=0 → topo da área, posY=50 → centro, posY=100 → fundo
  const anchorY = headerBottom + Math.round(areaH * (posY / 100));
  let y = Math.round(anchorY - totalH / 2) + Math.round(lineH * 0.75);

  ctx.font = `bold ${lines.fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.fillStyle = '#1a1a1a';

  if (align === 'left') {
    ctx.textAlign = 'left';
    for (const line of lines.texts) {
      ctx.fillText(line, PAD + 20, y);
      y += lineH;
    }
  } else {
    ctx.textAlign = 'center';
    for (const line of lines.texts) {
      ctx.fillText(line, W / 2, y);
      y += lineH;
    }
  }
  ctx.textAlign = 'left';

  if (btnGerar) {
    btnGerar.textContent = '🔄 Gerar novamente';
    btnGerar.disabled = false;
  }
}

function wrapFraseLines(ctx, text, maxW, fontSize = 72, fixed = false) {
  ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  const words = text.split(' ');
  const texts = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && cur) { texts.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) texts.push(cur);
  // Reduz automaticamente só se não for tamanho fixo
  if (!fixed && (texts.some(l => ctx.measureText(l).width > maxW) || texts.length > 6) && fontSize > 30) {
    return wrapFraseLines(ctx, text, maxW, fontSize - 4, false);
  }
  return { texts, fontSize };
}

// ── Listener do service worker ───────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'showBatch') showBatchPanel();
  if (msg.action === 'showFrase') {
    if (msg.logoDataUrl) {
      _fraseLogoDataUrl = msg.logoDataUrl;
      _fraseLogoImg     = null; // invalida cache para recarregar com nova data URL
    }
    showFrasePanel();
  }
});

})();
