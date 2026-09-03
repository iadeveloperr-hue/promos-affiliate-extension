// Painel Garimpo — só aparece em web.whatsapp.com
window.PromosGarimpo = { showGarimpo };

let _rescanHotkey = null;   // listener Alt+R (limpo ao fechar o painel)

async function showGarimpo() {
  removeGarimpo();
  window.PromosOverlay?.removeOverlay?.();

  // Painel flutuante no canto — não bloqueia o scroll do chat
  const panel = document.createElement('div');
  panel.id = 'promos-garimpo-panel';

  // ── Header ───────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'promos-header';
  header.innerHTML = '<span class="promos-title">🕵️ Garimpo de mensagens</span>';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'promos-close';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', removeGarimpo);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // ── Instruções ───────────────────────────────────────────────────────────
  const instrucoes = document.createElement('div');
  instrucoes.style.cssText = 'padding:10px 14px 6px;font-size:13px;color:var(--promos-text-muted,#666);line-height:1.6';
  instrucoes.innerHTML =
    '<b>Como capturar mais itens:</b><br>' +
    '• Abra o painel <b>antes</b> de rolar — o WhatsApp só mantém mensagens visíveis.<br>' +
    '• Role devagar em cada grupo.<br>' +
    '• A captura é <b>automática</b> ao trocar de grupo — não precisa reescanear na mão.<br>' +
    '• Se faltar algo, <b>Alt+R</b> reescaneia o grupo atual (rede de segurança).';
  panel.appendChild(instrucoes);

  // ── Contador + Reescanear ─────────────────────────────────────────────────
  const counterRow = document.createElement('div');
  counterRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 14px 10px';

  const counter = document.createElement('div');
  counter.style.cssText = 'font-size:13px;font-weight:600;flex:1';
  updateCounter(counter, window.PromosWhatsAppParser.messageCount);
  counterRow.appendChild(counter);

  const btnRescan = document.createElement('button');
  btnRescan.className = 'promos-btn promos-btn-sm promos-btn-secondary';
  btnRescan.textContent = '🔄 Reescanear';
  btnRescan.title = 'Fallback: a captura já é automática ao trocar de grupo. Use só se algo não aparecer.';
  // Escondido por padrão: a re-ancoragem automática (sensor de troca de grupo)
  // tornou o reescanear manual desnecessário. Mantido como rede de segurança
  // caso o WhatsApp mude o DOM e o sensor pare de detectar a troca.
  btnRescan.style.display = 'none';
  btnRescan.addEventListener('click', () => {
    // Para, reinicia e força re-scan do estado atual do DOM
    window.PromosWhatsAppParser.startObserver(n => updateCounter(counter, n));
  });
  counterRow.appendChild(btnRescan);
  panel.appendChild(counterRow);

  // ── Atalho Alt+R: reescanear manual (rede de segurança) ───────────────────
  // Local do painel (não usa chrome.commands → não conflita com os atalhos
  // Ctrl+Shift+… já registrados). Ignorado enquanto você digita no WhatsApp.
  _rescanHotkey = (e) => {
    if (!(e.altKey && (e.key === 'r' || e.key === 'R'))) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault();
    btnRescan.click();
    counter.style.transition = 'background .2s';
    counter.style.background = 'rgba(255,193,7,.35)';   // flash: confirma o rescan
    setTimeout(() => { counter.style.background = ''; }, 250);
  };
  document.addEventListener('keydown', _rescanHotkey, true);

  // ── Botão Garimpar ────────────────────────────────────────────────────────
  const btnGarimpar = document.createElement('button');
  btnGarimpar.className = 'promos-btn promos-btn-primary';
  btnGarimpar.style.cssText = 'margin:0 14px 14px;width:calc(100% - 28px)';
  btnGarimpar.textContent = '🕵️ Garimpar agora';
  panel.appendChild(btnGarimpar);

  // ── Área de resultados ────────────────────────────────────────────────────
  const results = document.createElement('div');
  results.className = 'promos-queue-list';
  panel.appendChild(results);

  document.body.appendChild(panel);

  // Inicia observer com atualização do contador em tempo real
  window.PromosWhatsAppParser.startObserver(n => updateCounter(counter, n));

  // ── Handler do botão ──────────────────────────────────────────────────────
  btnGarimpar.addEventListener('click', async () => {
    btnGarimpar.disabled = true;
    btnGarimpar.textContent = '⏳ Processando…';
    results.innerHTML = '';

    const links = window.PromosWhatsAppParser.extractLinks();
    if (!links.length) {
      results.innerHTML = '<div class="promos-queue-empty">Nenhum link de marketplace encontrado nas mensagens visíveis.</div>';
      btnGarimpar.disabled = false;
      btnGarimpar.textContent = '🕵️ Garimpar agora';
      return;
    }

    // Status de progresso
    const statusEl = document.createElement('div');
    statusEl.style.cssText = 'padding:8px 14px;font-size:13px';
    statusEl.textContent = `🔗 ${links.length} link(s) encontrado(s). Processando…`;
    results.appendChild(statusEl);

    // Processa localmente (sem abrir abas — não dispara o anti-bot do ML)
    try {
      const res = await window.PromosGarimpoEngine.processLinks(links, (done, total) => {
        statusEl.textContent = `⏳ Processando ${done}/${total}…`;
      });
      showGarimpoResults(results, statusEl, res);
      btnGarimpar.textContent = '🕵️ Garimpar novamente';
    } catch (err) {
      statusEl.textContent = '❌ Erro ao processar: ' + err.message;
      btnGarimpar.textContent = '🕵️ Garimpar agora';
    } finally {
      btnGarimpar.disabled = false;
    }
  });
}

function updateCounter(el, n) {
  el.textContent = n === 0
    ? '📭 Nenhuma mensagem com links acumulada ainda'
    : `📬 ${n} mensagem(ns) com links de marketplace acumulada(s)`;
}

function showGarimpoResults(container, statusEl, res) {
  const r = res.reasons || {};
  const lines = [`✅ <b>${res.enqueued}</b> adicionado(s) à fila`];
  if (r.jaNaFila)        lines.push(`🔁 ${r.jaNaFila} já garimpado(s)`);
  if (r.duplicado)       lines.push(`${r.duplicado} já postado(s) antes (histórico)`);
  if (r.semNome)         lines.push(`${r.semNome} sem nome na mensagem (não dá pra classificar)`);
  if (r.semParser)       lines.push(`${r.semParser} página não reconhecida`);
  if (r.verificacao)     lines.push(`${r.verificacao} bloqueado(s) pela verificação anti-robô do ML`);
  if (r.resolveInvalido) lines.push(`${r.resolveInvalido} link inválido`);
  if (r.erro)            lines.push(`${r.erro} erro(s) ao processar`);
  if (res.errors?.length) lines.push(`⚠️ ${res.errors.join(' | ')}`);
  statusEl.innerHTML = lines.join('<br>');

  // Detalhe das falhas (para diagnóstico) — link original → URL final da aba
  const fails = (res.failures || []).filter(f => f.reason !== 'duplicado');
  if (fails.length) {
    const det = document.createElement('details');
    det.style.cssText = 'padding:8px 14px;font-size:12px';
    const sum = document.createElement('summary');
    sum.style.cssText = 'cursor:pointer;font-weight:600';
    sum.textContent = `🔎 Ver ${fails.length} item(ns) que falharam`;
    det.appendChild(sum);
    for (const f of fails) {
      const row = document.createElement('div');
      row.style.cssText = 'margin:6px 0;padding:6px;border-left:3px solid #cf222e;background:#fafafa;word-break:break-all';
      row.innerHTML =
        `<b>motivo:</b> ${f.reason}${f.erro ? ' — ' + f.erro : ''}<br>` +
        `<b>link grupo:</b> ${f.rawUrl || '?'}<br>` +
        (f.resolvedUrl ? `<b>resolvido:</b> ${f.resolvedUrl}<br>` : '') +
        (f.finalUrl ? `<b>aba final:</b> ${f.finalUrl}` : '');
      det.appendChild(row);
    }
    container.appendChild(det);
  }

  if (res.enqueued > 0) {
    const btnFila = document.createElement('button');
    btnFila.className = 'promos-btn promos-btn-sm promos-btn-secondary';
    btnFila.style.cssText = 'margin:8px 14px;';
    btnFila.textContent = '📋 Ver Fila de Revisão';
    btnFila.addEventListener('click', () => {
      removeGarimpo();
      window.PromosQueue.showQueue();
    });
    container.appendChild(btnFila);
  }
}

function removeGarimpo() {
  window.PromosWhatsAppParser?.stopObserver?.();
  if (_rescanHotkey) { document.removeEventListener('keydown', _rescanHotkey, true); _rescanHotkey = null; }
  document.getElementById('promos-garimpo-panel')?.remove();
}
