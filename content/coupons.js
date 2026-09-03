// Cofre de cupons — painel flutuante com os cupons garimpados dos grupos.
// Aberto pelo menu de contexto "🎟️ Cupons garimpados" em qualquer página dos
// marketplaces. Lista os cupons frescos (<7 dias) do marketplace atual, com
// botão copiar; você testa no checkout. Exposto como global (sem ES modules).
window.PromosCoupons = { showPanel: showCouponsPanel };

async function showCouponsPanel() {
  removeCouponsPanel();

  const currentSite = detectCouponSite();
  const panel = document.createElement('div');
  panel.id = 'promos-coupons-panel';

  // Header
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid rgba(128,128,128,0.25);';
  const title = document.createElement('span');
  title.style.cssText = 'font-weight:700;font-size:14px;';
  title.textContent = '🎟️ Cupons garimpados';
  header.appendChild(title);
  const close = document.createElement('button');
  close.className = 'promos-close';
  close.textContent = '✕';
  close.title = 'Fechar';
  close.addEventListener('click', removeCouponsPanel);
  header.appendChild(close);
  panel.appendChild(header);

  // Filtro por marketplace
  const SITES = [
    ['atual',        currentSite ? `📍 ${siteLabel(currentSite)}` : null],
    ['mercadolivre', '🟡 ML'],
    ['amazon',       '🟠 Amazon'],
    ['shopee',       '🔶 Shopee'],
    ['todos',        'Todos'],
  ].filter(([, t]) => t);

  const tabs = document.createElement('div');
  tabs.style.cssText = 'display:flex;gap:5px;padding:10px 14px 0;flex-wrap:wrap;';
  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:10px 14px 14px;overflow-y:auto;';

  let activeFilter = currentSite || 'todos';

  for (const [id, label] of SITES) {
    const b = document.createElement('button');
    b.className = 'promos-btn promos-btn-sm promos-btn-secondary';
    b.textContent = label;
    b.dataset.filter = id === 'atual' ? currentSite : id;
    b.addEventListener('click', () => {
      activeFilter = b.dataset.filter;
      tabs.querySelectorAll('button').forEach(x =>
        x.style.outline = x.dataset.filter === activeFilter ? '2px solid #f5a623' : 'none');
      renderCoupons(list, activeFilter);
    });
    if (b.dataset.filter === activeFilter) b.style.outline = '2px solid #f5a623';
    tabs.appendChild(b);
  }
  panel.appendChild(tabs);

  // Barra do testador automático
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 14px 0;';
  const testBtn = document.createElement('button');
  testBtn.className = 'promos-btn promos-btn-sm promos-btn-primary';
  testBtn.textContent = '⚡ Testar todos aqui';
  testBtn.title = 'Abra o carrinho/checkout com o produto e clique aqui: a extensão digita cada cupom e diz qual funcionou';
  const status = document.createElement('span');
  status.style.cssText = 'font-size:11px;color:#999;flex:1;min-width:0;';
  bar.appendChild(testBtn);
  bar.appendChild(status);
  panel.appendChild(bar);

  panel.appendChild(list);

  let stop = false;
  testBtn.addEventListener('click', async () => {
    if (testBtn.dataset.running === '1') { stop = true; return; }
    const codes = Array.from(list.querySelectorAll('[data-coupon-code]'))
      .map(el => el.dataset.couponCode);
    if (!codes.length) { status.textContent = 'Nenhum cupom com código nesta lista.'; return; }

    stop = false;
    testBtn.dataset.running = '1';
    testBtn.textContent = '⏹️ Parar';
    const { erro } = await window.PromosCouponTester.run(codes, {
      onStatus: (t) => { status.textContent = t || ''; },
      onResult: (code, r) => setCouponResult(list, code, r),
      shouldStop: () => stop,
    });
    testBtn.dataset.running = '0';
    testBtn.textContent = '⚡ Testar todos aqui';
    if (erro) status.textContent = `⚠️ ${erro}`;
    else if (!status.textContent) status.textContent = 'Pronto.';
  });

  document.body.appendChild(panel);
  await renderCoupons(list, activeFilter);

  // Puxa os cupons garimpados no outro perfil do Chrome (o garimpo roda só num
  // deles). Depois do 1º render para o painel não ficar esperando o disco.
  status.textContent = 'Buscando cupons do outro Chrome…';
  const sync = await window.PromosStore.syncCouponsShared().catch(() => ({ ok: false }));
  if (sync.ok) {
    if (sync.added > 0) await renderCoupons(list, activeFilter);
    status.textContent = sync.added > 0 ? `+${sync.added} do outro Chrome` : '';
  } else {
    status.textContent = '⚠️ Sem o programa-ponte: só os cupons deste Chrome.';
  }
}

/** Pinta o resultado do teste na linha do cupom. */
function setCouponResult(list, code, r) {
  const row = list.querySelector(`[data-coupon-code="${CSS.escape(code)}"]`);
  if (!row) return;
  let tag = row.querySelector('.promos-coupon-result');
  if (!tag) {
    tag = document.createElement('div');
    tag.className = 'promos-coupon-result';
    tag.style.cssText = 'font-size:11px;font-weight:600;';
    row.querySelector('[data-coupon-info]')?.appendChild(tag);
  }
  const icon = r.status === 'ok' ? '✅' : r.status === 'fail' ? '❌' : '⚠️';
  const color = r.status === 'ok' ? '#1a7f37' : r.status === 'fail' ? '#c0392b' : '#b57a00';
  tag.style.color = color;
  tag.textContent = `${icon} ${r.msg}`;
  row.style.order = r.status === 'ok' ? '-1' : '0';
}

async function renderCoupons(list, filter) {
  list.innerHTML = '';
  const coupons = await window.PromosStore.getCoupons(filter === 'todos' ? null : filter);

  if (!coupons.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:18px;text-align:center;color:#999;font-size:13px;';
    empty.textContent = 'Nenhum cupom fresco aqui ainda. Garimpe os grupos que eles aparecem (validade: 7 dias).';
    list.appendChild(empty);
    return;
  }

  for (const c of coupons) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid rgba(128,128,128,0.3);border-radius:8px;';
    if (c.code) row.dataset.couponCode = c.code;

    const info = document.createElement('div');
    info.dataset.couponInfo = '1';
    info.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;';

    const line1 = document.createElement('div');
    line1.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
    const label = document.createElement('b');
    label.style.cssText = 'font-size:13px;font-family:monospace;';
    label.textContent = c.label;
    line1.appendChild(label);
    if (c.pct && c.code) {
      const pct = document.createElement('span');
      pct.style.cssText = 'font-size:11px;font-weight:700;color:#1a7f37;';
      pct.textContent = `-${c.pct}%`;
      line1.appendChild(pct);
    }
    if (c.generic) {
      const g = document.createElement('span');
      g.style.cssText = 'font-size:10px;padding:1px 6px;border-radius:99px;background:rgba(245,166,35,0.18);color:#b57a00;';
      g.textContent = 'promo geral';
      g.title = 'Anúncio geral da plataforma (sem código) — confira no app/site';
      line1.appendChild(g);
    }
    info.appendChild(line1);

    const meta = document.createElement('div');
    meta.style.cssText = 'font-size:11px;color:#999;';
    meta.textContent = `${siteLabel(c.marketplace)} · visto ${couponAge(c.seenAt)}`;
    info.appendChild(meta);
    row.appendChild(info);

    if (c.code) {
      const btn = document.createElement('button');
      btn.className = 'promos-btn promos-btn-sm promos-btn-primary';
      btn.textContent = '📋 Copiar';
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(c.code)
          .then(() => { btn.textContent = '✅'; setTimeout(() => { btn.textContent = '📋 Copiar'; }, 1500); })
          .catch(() => { btn.textContent = '❌'; });
      });
      row.appendChild(btn);
    }
    list.appendChild(row);
  }
}

function removeCouponsPanel() {
  document.getElementById('promos-coupons-panel')?.remove();
}

function detectCouponSite() {
  const h = location.hostname;
  if (/amazon\.com\.br/.test(h)) return 'amazon';
  if (/mercadoli[bv]re/.test(h)) return 'mercadolivre';
  if (/shopee\.com\.br/.test(h)) return 'shopee';
  return null;
}

function siteLabel(s) {
  return s === 'amazon' ? 'Amazon' : s === 'mercadolivre' ? 'Mercado Livre' : s === 'shopee' ? 'Shopee' : s;
}

function couponAge(ts) {
  const h = Math.floor((Date.now() - ts) / 3600000);
  if (h < 1)  return 'agora há pouco';
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}
