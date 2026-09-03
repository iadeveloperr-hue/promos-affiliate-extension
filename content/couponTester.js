// Testador automático de cupons.
// Roda na página de carrinho/checkout: acha o campo "cupom", digita cada código
// do cofre, aplica, espera a resposta e classifica (✅ válido / ❌ inválido / ⚠️
// indefinido) — sem você abrir/fechar o painel a cada tentativa.
//
// O DOM dos marketplaces muda direto, então há dois caminhos:
//   1. heurística (placeholder/aria-label/label perto do input);
//   2. modo aprendizado — você clica no campo uma vez e o seletor fica salvo
//      por hostname em chrome.storage.local (`couponFieldMap`).
// Exposto como global (sem ES modules).

window.PromosCouponTester = { run: runCouponTests, teach: teachField, findField };

const TESTER_TIMEOUT_MS   = 8000;   // espera máx. pela resposta do site
const TESTER_SETTLE_MS    = 600;    // espera após digitar, antes de aplicar
const TESTER_BETWEEN_MS   = 900;    // respiro entre cupons (evita rate-limit)

const RX_COUPON_FIELD = /cupom|cup[oó]n|c[oó]digo|coupon|voucher|promo/i;
const RX_APPLY        = /aplicar|adicionar|validar|inserir|usar|confirmar|ok\b|apply/i;
const RX_OPEN_FIELD   = /(adicionar|inserir|tenho|usar|aplicar).{0,20}(cupom|c[oó]digo)|cupom de desconto/i;
const RX_FAIL         = /inv[áa]lid|n[ãa]o (é|e|foi|está|esta|pôde|pode)|expirad|vencid|n[ãa]o encontrad|indispon[íi]vel|erro|n[ãa]o existe|j[áa] (foi )?utilizad|n[ãa]o se aplica|requisit|confira se o cupom/i; // "Confira se o cupom está correto" = recusa do ML (visto ao vivo)
const RX_OK           = /aplicad|adicionad|ativad|desconto de|cupom v[áa]lido|sucesso/i;
// Cupom que já está no carrinho: existe e vale — conta como acerto, não erro.
const RX_ALREADY      = /j[áa] (foi )?(adicionad|aplicad|inserid|utilizad|ativad)/i;

// ── Descoberta do campo ──────────────────────────────────────────────────────

/**
 * Documentos onde procurar: o da página + o de cada iframe same-origin.
 * O ML abre os cupons num iframe (`cl-iframe-modal--coupons`), então o campo
 * NÃO está no documento principal.
 */
function allDocs() {
  const docs = [document];
  for (const f of document.querySelectorAll('iframe')) {
    try {
      const d = f.contentDocument;
      if (d && d.body) docs.push(d);
    } catch (_) { /* cross-origin — inacessível, ignora */ }
  }
  return docs;
}

/** Acha o input de cupom (na página ou dentro de um iframe). Ou null. */
async function findField() {
  const docs = allDocs();

  // 1. seletor aprendido para este site
  const saved = await savedSelector();
  if (saved) {
    for (const d of docs) {
      const el = safeQuery(d, saved);
      if (isUsableInput(el)) return el;
    }
  }

  // 2. heurística: input de texto cuja "vizinhança" fala de cupom
  for (const d of docs) {
    const inputs = Array.from(d.querySelectorAll('input:not([type=hidden])'))
      .filter(isUsableInput);
    for (const el of inputs) {
      if (RX_COUPON_FIELD.test(fieldContext(el))) return el;
    }
  }
  return null;
}

/** Texto ao redor do input que ajuda a identificá-lo. */
function fieldContext(el) {
  const bits = [
    el.placeholder, el.name, el.id, el.getAttribute('aria-label'),
    el.getAttribute('data-testid'), el.getAttribute('title'),
  ];
  if (el.labels) for (const l of el.labels) bits.push(l.textContent);
  // container próximo (2 níveis) — pega o rótulo mesmo sem <label for>
  let p = el.parentElement;
  for (let i = 0; i < 2 && p; i++, p = p.parentElement) {
    if (p.textContent && p.textContent.length < 200) bits.push(p.textContent);
  }
  return bits.filter(Boolean).join(' ');
}

function isUsableInput(el) {
  if (!el || el.tagName !== 'INPUT') return false;
  if (el.disabled || el.readOnly) return false;
  const t = (el.type || 'text').toLowerCase();
  if (!['text', 'search', 'tel', ''].includes(t)) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/**
 * Alguns sites escondem o campo atrás de um "Adicionar cupom". Clica nele e
 * espera o input aparecer.
 */
async function revealField() {
  for (const trigger of findRevealTriggers()) {
    trigger.click();
    const el = await waitFor(() => findField(), 4000);
    if (el) return el;
  }
  return null;
}

/**
 * Gatilhos do tipo "Inserir código do cupom". No ML isso não é um <button> —
 * é um link/span dentro do resumo da compra. Então varre qualquer elemento
 * clicável cujo texto PRÓPRIO (sem os filhos) fale de cupom, do mais interno
 * para o mais externo (o handler costuma estar no pai).
 */
function findRevealTriggers() {
  const out = [];
  for (const d of allDocs()) {
    for (const el of d.querySelectorAll('button, a, [role=button], summary, span, div, li, label')) {
      const t = (el.textContent || '').trim();
      if (t.length > 60 || !RX_OPEN_FIELD.test(t)) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      // só o mais interno que ainda contém o texto inteiro
      if (Array.from(el.children).some(c => RX_OPEN_FIELD.test((c.textContent || '').trim()))) continue;
      out.push(el);
      if (el.parentElement) out.push(el.parentElement); // fallback: handler no pai
    }
  }
  return out;
}

// ── Modo aprendizado ─────────────────────────────────────────────────────────

/**
 * Pede um clique no campo de cupom e salva o seletor para este hostname.
 * Resolve com o elemento (ou null se o usuário cancelar com Esc).
 */
function teachField(onStatus) {
  return new Promise(resolve => {
    const hint = document.createElement('div');
    hint.id = 'promos-teach-hint';
    hint.textContent = '👆 Clique no campo onde você digita o cupom (Esc cancela)';
    document.body.appendChild(hint);

    // Clique dentro de um iframe não borbulha pro documento de cima, então o
    // listener entra em cada documento — e volta a entrar de tempos em tempos,
    // porque o iframe do modal só nasce depois do clique.
    const listening = new Set();
    const attach = () => {
      for (const d of allDocs()) {
        if (listening.has(d)) continue;
        listening.add(d);
        d.addEventListener('click', onClick, true);
        d.addEventListener('keydown', onKey, true);
      }
    };
    const rescan = setInterval(attach, 500);

    const cleanup = () => {
      clearInterval(rescan);
      hint.remove();
      for (const d of listening) {
        d.removeEventListener('click', onClick, true);
        d.removeEventListener('keydown', onKey, true);
      }
    };
    const onClick = async (e) => {
      const el = e.target;
      if (hint.contains(el)) return;
      if (!isUsableInput(el)) {
        // Não é o campo — provavelmente é o botão que ABRE o campo (no ML,
        // "Inserir código do cupom" abre um modal). Deixa o clique passar,
        // espera o campo aparecer e segue pedindo.
        hint.textContent = '⏳ Abrindo… se aparecer o campo do cupom, clique nele.';
        const found = await waitFor(() => findField(), 4000);
        if (found) hint.textContent = '👆 Agora clique no campo do cupom (Esc cancela)';
        else hint.textContent = '👆 Clique no campo onde você digita o cupom (Esc cancela)';
        return;
      }
      e.preventDefault(); e.stopPropagation();
      cleanup();
      await saveSelector(cssPath(el));
      onStatus?.('Campo aprendido ✅');
      resolve(el);
    };
    const onKey = (e) => { if (e.key === 'Escape') { cleanup(); resolve(null); } };
    attach();
  });
}

async function savedSelector() {
  const map = await window.PromosStore.get('couponFieldMap', {});
  return map[location.hostname] || null;
}

async function saveSelector(sel) {
  const map = await window.PromosStore.get('couponFieldMap', {});
  map[location.hostname] = sel;
  await window.PromosStore.set('couponFieldMap', map);
}

function safeQuery(doc, sel) {
  try { return doc.querySelector(sel); } catch (_) { return null; }
}

/** Caminho CSS curto e razoavelmente estável até o elemento. */
function cssPath(el) {
  const doc = el.ownerDocument; // pode ser o documento de um iframe
  if (el.id && doc.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
    return `#${CSS.escape(el.id)}`;
  }
  for (const attr of ['data-testid', 'name', 'aria-label', 'placeholder']) {
    const v = el.getAttribute(attr);
    if (v && doc.querySelectorAll(`[${attr}="${CSS.escape(v)}"]`).length === 1) {
      return `[${attr}="${CSS.escape(v)}"]`;
    }
  }
  const parts = [];
  let node = el;
  for (let i = 0; node && node.nodeType === 1 && i < 5; i++, node = node.parentElement) {
    let part = node.tagName.toLowerCase();
    const sibs = node.parentElement
      ? Array.from(node.parentElement.children).filter(c => c.tagName === node.tagName) : [];
    if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
    parts.unshift(part);
    if (node.id) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
  }
  return parts.join(' > ');
}

// ── Aplicação de um cupom ────────────────────────────────────────────────────

/** Escreve no input de um jeito que React/Vue percebam. */
function setValue(el, value) {
  // O prototype certo é o do frame do elemento (o modal do ML é um iframe).
  const win = el.ownerDocument.defaultView || window;
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
              || Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
  el.focus();
  setter.call(el, '');
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
  setter.call(el, value);
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
  el.dispatchEvent(new win.Event('change', { bubbles: true }));
}

/** Botão que aplica o cupom (dentro do form/containers acima do input). */
function findApplyButton(input) {
  const scopes = [];
  let p = input.parentElement;
  for (let i = 0; i < 4 && p; i++, p = p.parentElement) scopes.push(p);
  if (input.form) scopes.unshift(input.form);
  for (const scope of scopes) {
    const btns = Array.from(scope.querySelectorAll('button, [role=button], input[type=submit]'))
      .filter(b => !b.disabled && b.getBoundingClientRect().width > 0);
    const byText = btns.find(b => RX_APPLY.test((b.textContent || b.value || '').trim()));
    if (byText) return byText;
    const submit = btns.find(b => (b.type || '').toLowerCase() === 'submit');
    if (submit) return submit;
  }
  return null;
}

/** Snapshot do que muda quando o cupom pega: totais e mensagens visíveis. */
function pageSnapshot(input) {
  return {
    total: readTotal(),
    text: nearbyText(input),
  };
}

/** Maior valor em R$ visível na página — proxy do total do carrinho. */
function readTotal() {
  const body = document.body.innerText || '';
  const vals = [];
  const rx = /R\$\s?([\d.]+,\d{2})/g;
  let m;
  while ((m = rx.exec(body))) {
    const n = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
    if (!isNaN(n)) vals.push(n);
  }
  return vals.length ? Math.max(...vals) : null;
}

/** Texto da região do campo (onde aparecem os avisos de erro/sucesso). */
function nearbyText(input) {
  let p = input;
  for (let i = 0; i < 5 && p.parentElement; i++) p = p.parentElement;
  // preserva as quebras de linha: é por elas que o diff isola a mensagem nova
  return (p.innerText || '').replace(/[ \t]+/g, ' ').trim();
}

/**
 * Testa um código. Retorna { status:'ok'|'fail'|'unknown', msg, saved }.
 */
async function testOne(input, code) {
  const before = pageSnapshot(input);

  // O site pode repetir EXATAMENTE a mesma mensagem em dois cupons seguidos
  // (ex.: "já foi adicionado"). Comparar texto não detectaria a 2ª resposta —
  // por isso o sinal de "o site respondeu" é a mutação do DOM.
  let mutated = false;
  const scope = messageScope(input);
  const obs = new MutationObserver(() => { mutated = true; });
  obs.observe(scope, { childList: true, subtree: true, characterData: true });

  setValue(input, code);
  await sleep(TESTER_SETTLE_MS);
  mutated = false; // o que mudou até aqui foi a digitação, não a resposta

  const btn = findApplyButton(input);
  if (btn) btn.click();
  else {
    const W = input.ownerDocument.defaultView || window;
    input.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  }

  const answered = await waitFor(() => {
    const now = pageSnapshot(input);
    const movedTotal = now.total !== null && before.total !== null
                    && Math.abs(now.total - before.total) > 0.009;
    if (!mutated && !movedTotal) return null;
    // deu tempo do texto assentar antes de ler
    return { now, text: now.text };
  }, TESTER_TIMEOUT_MS);

  obs.disconnect();

  if (!answered) return { status: 'unknown', msg: 'sem resposta do site', saved: 0 };

  await sleep(300);
  const now  = pageSnapshot(input);
  const text = now.text;
  const saved = (before.total !== null && now.total !== null) ? before.total - now.total : 0;
  const msgLine = pickMessage(text, before.text);

  if (saved > 0.009)      return { status: 'ok', msg: `-${formatBRL(saved)}`, saved };
  // "já foi adicionado" = o cupom EXISTE e está no carrinho — é bom, não erro.
  if (RX_ALREADY.test(text)) return { status: 'ok', msg: 'já está aplicado ✔', saved: 0 };
  if (RX_FAIL.test(text))    return { status: 'fail', msg: msgLine || 'recusado', saved: 0 };
  if (RX_OK.test(text))      return { status: 'ok', msg: msgLine || 'aceito', saved: 0 };
  return { status: 'unknown', msg: msgLine || 'resposta não reconhecida', saved: 0 };
}

/** Container observado em busca da resposta (área do campo, dentro do iframe). */
function messageScope(input) {
  let p = input;
  for (let i = 0; i < 5 && p.parentElement; i++) p = p.parentElement;
  return p;
}

/** A linha que interessa: a mensagem nova, ou a mais "falante" do bloco. */
function pickMessage(text, baseline) {
  const novo = diffText(baseline, text).trim();
  const alvo = novo || text;
  const linha = alvo.split('\n')
    .map(s => s.trim())
    .find(s => s.length > 8 && (RX_FAIL.test(s) || RX_OK.test(s) || RX_ALREADY.test(s)));
  return firstSentence(linha || alvo);
}

function diffText(before, after) {
  if (!before) return after || '';
  if (!after) return '';
  if (after.startsWith(before)) return after.slice(before.length);
  // texto reescrito: compara por linhas para achar o que é novo
  const old = new Set(before.split(/[.\n]/).map(s => s.trim()));
  return after.split(/[.\n]/).map(s => s.trim()).filter(s => s && !old.has(s)).join('. ');
}

function firstSentence(t) {
  const s = (t || '').trim().split(/[.\n]/)[0].trim();
  return s.length > 90 ? s.slice(0, 87) + '…' : s;
}

function formatBRL(n) {
  return 'R$ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// ── Loop principal ───────────────────────────────────────────────────────────

/**
 * Testa uma lista de cupons em sequência.
 * codes: ['NIVEA20', ...]; onResult(code, result) é chamado a cada um.
 * Retorna { results: [...], erro? }.
 */
async function runCouponTests(codes, { onResult, onStatus, shouldStop } = {}) {
  let input = await findField();
  if (!input) {
    onStatus?.('Procurando o campo de cupom…');
    input = await revealField();
  }
  if (!input) {
    onStatus?.('Não achei o campo — me mostre onde é.');
    input = await teachField(onStatus);
  }
  if (!input) return { results: [], erro: 'Campo de cupom não encontrado.' };

  input.scrollIntoView({ block: 'center', behavior: 'smooth' });

  const results = [];
  for (const code of codes) {
    if (shouldStop?.()) break;
    onStatus?.(`Testando ${code}…`);
    let r;
    try {
      r = await testOne(input, code);
    } catch (err) {
      r = { status: 'unknown', msg: String(err && err.message || err), saved: 0 };
    }
    results.push({ code, ...r });
    onResult?.(code, r);

    // o site pode recriar o input após aplicar
    if (!input.isConnected) {
      input = await findField() || await revealField();
      if (!input) { onStatus?.('O campo sumiu depois de aplicar — reabra e rode de novo.'); break; }
    }
    await sleep(TESTER_BETWEEN_MS);
  }
  onStatus?.(null);
  return { results };
}

// ── utilidades ───────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Chama fn a cada 250ms até retornar algo truthy ou estourar o timeout. */
async function waitFor(fn, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(250);
  }
  return null;
}
