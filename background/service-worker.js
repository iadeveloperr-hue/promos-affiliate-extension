import { GROUPS, RADAR } from '../lib/config.js';
import '../lib/linkResolver.js';  // side-effect: registra globalThis.PromosLinkResolver

// Ordem de injeção importa: globals primeiro, depois dependências, depois content.js
const CONTENT_SCRIPTS = [
  'content/globals.js',
  'lib/store.js',
  'lib/linkResolver.js',
  'lib/scoring.js',
  'lib/demandProfile.js',
  'lib/radarEngine.js',
  'parsers/commissionParser.js',
  'parsers/whatsappParser.js',
  'parsers/mlPanelScraper.js',
  'parsers/rankingParser.js',
  'parsers/amazon.js',
  'parsers/mercadolivre.js',
  'parsers/shopee.js',
  'parsers/index.js',
  'lib/affiliate.js',
  'lib/template.js',
  'content/accountGuard.js',
  'content/emojiCatalog.js',
  'content/overlay.js',
  'content/instagram.js',
  'lib/queueSync.js',
  'content/couponTester.js',
  'content/coupons.js',
  'content/queue.js',
  'content/garimpo.js',
  'content/batch.js',
  'content/content.js',
];

const MENU_ITEMS = [
  { id: 'kate',             title: `📢 Gerar post — ${GROUPS.kate.name}` },
  { id: 'musculosas',       title: `📢 Gerar post — ${GROUPS.musculosas.name}` },
  { id: 'jotape',           title: `📢 Gerar post — ${GROUPS.jotape.name}` },
  { id: 'fila-revisao',     title: '📋 Fila de Revisão' },
  { id: 'rodar-radar',      title: '🔍 Rodar Radar agora' },
  { id: 'garimpar',         title: '🕵️ Garimpar mensagens (WhatsApp)' },
  { id: 'ver-cupons',       title: '🎟️ Cupons garimpados' },
  { id: 'capturar-ml',      title: '📊 Capturar comissões ML (painel)' },
  { id: 'capturar-ranking', title: '🏆 Capturar ranking (esta página)' },
];

async function createContextMenus() {
  await new Promise(resolve => chrome.contextMenus.removeAll(resolve));
  for (const item of MENU_ITEMS) {
    await new Promise(resolve => {
      chrome.contextMenus.create(
        { id: item.id, title: item.title, contexts: ['page', 'link', 'image'] },
        () => { if (chrome.runtime.lastError) { /* ID duplicado — ignorar */ } resolve(); }
      );
    });
  }
}

// ── Alarmes automáticos (8h, 12h, 18h) ───────────────────────────────────────

function setupRadarAlarms() {
  for (const hour of RADAR.scheduleHours) {
    const name = `radar-${hour}h`;
    chrome.alarms.get(name, existing => {
      if (!existing) {
        chrome.alarms.create(name, {
          when: nextAlarmTime(hour),
          periodInMinutes: 24 * 60,
        });
        console.log(`[Promos] Alarme ${name} agendado para ${new Date(nextAlarmTime(hour)).toLocaleTimeString('pt-BR')}`);
      }
    });
  }
}

function nextAlarmTime(hour) {
  const now    = new Date();
  const target = new Date(now);
  target.setHours(hour, 0, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  return target.getTime();
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (!alarm.name.startsWith('radar-')) return;
  console.log(`[Promos] Radar automático disparado: ${alarm.name}`);
  runRadar()
    .then(r => console.log('[Promos] Radar concluído:', r))
    .catch(e => console.error('[Promos] Radar falhou:', e));
});

// ── Listeners de ciclo de vida ────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
  setupRadarAlarms();
  refreshBadge();
});
chrome.runtime.onStartup.addListener(() => {
  createContextMenus();
  setupRadarAlarms();
  refreshBadge();
});

// ── Badge — contador de itens na fila ─────────────────────────────────────────

chrome.storage.onChanged.addListener((changes) => {
  if ('reviewQueue' in changes) {
    updateBadge((changes.reviewQueue.newValue || []).length);
  }
});

function refreshBadge() {
  chrome.storage.local.get('reviewQueue', ({ reviewQueue }) => {
    updateBadge((reviewQueue || []).length);
  });
}

function updateBadge(count) {
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#e53935' });
}

// ── Despacho compartilhado (menu de contexto + atalhos de teclado) ─────────────

// Mapeia comando/atalho → grupo (gerar post)
const COMMAND_TO_GROUP = { 'gerar-kate': 'kate', 'gerar-musculosas': 'musculosas', 'gerar-jotape': 'jotape' };

/** Executa a ação de um item (menu ou atalho) na aba dada. */
async function dispatchAction(id, tab) {
  if (!tab) return;
  if (id === 'fila-revisao')          await injectAndSend(tab.id, { action: 'showQueue' });
  else if (id === 'garimpar')         await injectAndSend(tab.id, { action: 'showGarimpo' });
  else if (id === 'ver-cupons')       await injectAndSend(tab.id, { action: 'showCoupons' });
  else if (id === 'abrir-lote')       await injectAndSend(tab.id, { action: 'showBatch' });
  else if (id === 'rodar-radar')      runRadarAndNotify(tab.id);
  else if (id === 'capturar-ml')      await injectAndSend(tab.id, { action: 'capturarMl' });
  else if (id === 'capturar-ranking') await injectAndSend(tab.id, { action: 'capturarRanking' });
  else if (id === 'criar-frase') {
    const logoDataUrl = await loadLogoDataUrl();
    await injectAndSend(tab.id, { action: 'showFrase', logoDataUrl });
  }
  else if (COMMAND_TO_GROUP[id])      await injectAndSend(tab.id, { action: 'extract', group: COMMAND_TO_GROUP[id] });
  else if (GROUPS[id])                await injectAndSend(tab.id, { action: 'extract', group: id });
}

// ── Menu de contexto ──────────────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener((info, tab) => {
  dispatchAction(info.menuItemId, tab);
});

// ── Atalhos de teclado ────────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await dispatchAction(command, tab);
});

// ── Mensagens dos content scripts ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Conferem QUEM recebe a comissão do link já gerado (mais forte que a
  // identidade da página): tag da Amazon e affiliate_tool do Mercado Livre.
  if (msg.action === 'verificarTagAmazon') {
    verificarTagAmazon(msg.url).then(sendResponse).catch(() => sendResponse({ tag: null }));
    return true;
  }
  if (msg.action === 'verificarMattTool') {
    verificarMattTool(msg.url).then(sendResponse).catch(() => sendResponse({ mattTool: null }));
    return true;
  }
  if (msg.action === 'checkLinkPreview') {
    checkLinkPreview(msg.url)
      .then(sendResponse)
      .catch(() => sendResponse({ hasPreview: false, imageUrl: null }));
    return true;
  }
  if (msg.action === 'generateShopeeLink') {
    const timeout = new Promise(res => setTimeout(() => res(null), 25000));
    Promise.race([generateShopeeAffiliateLink(msg.productUrl, msg.subId), timeout])
      .then(link => sendResponse({ link: link || null }))
      .catch(() => sendResponse({ link: null }));
    return true;
  }
  if (msg.action === 'getExtensionResource') {
    fetch(chrome.runtime.getURL(msg.path))
      .then(r => r.arrayBuffer())
      .then(buf => {
        const bytes = new Uint8Array(buf);
        let bin = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK)
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        sendResponse({ dataUrl: `data:${msg.mime || 'image/png'};base64,` + btoa(bin) });
      })
      .catch(() => sendResponse({ dataUrl: null }));
    return true;
  }
  if (msg.action === 'resolveLink') {
    globalThis.PromosLinkResolver.resolve(msg.url)
      .then(sendResponse)
      .catch(() => sendResponse({ isValid: false }));
    return true;
  }
  // Como resolveLink, mas com FALLBACK de aba real quando o fetch falha
  // (encurtadores que bloqueiam requisição sem navegador, ex.: lucreshop).
  // Usar só em ações únicas do usuário (aprovação) — NUNCA no garimpo em lote.
  if (msg.action === 'resolveLinkDeep') {
    resolveLinkDeepFn(msg.url)
      .then(sendResponse)
      .catch(() => sendResponse({ isValid: false }));
    return true;
  }
  if (msg.action === 'fetchMlDe') {
    // De real do ML: busca a página (mesmo fetch do resolver, sem abrir aba) e
    // extrai o "Antes" do HTML. Best-effort — devolve {priceDe:null} se falhar.
    fetchMlDe(msg.productUrl, msg.pricePor)
      .then(sendResponse)
      .catch(() => sendResponse({ priceDe: null }));
    return true;
  }
  if (msg.action === 'generateHook') {
    generateHook(msg.parsed || {}, msg.group, msg.examples || [])
      .then(sendResponse)
      .catch(e => sendResponse({ error: 'erro', detail: (e.message || '').slice(0, 200) }));
    return true;
  }
  if (msg.action === 'garimparLinks') {
    garimparLinks(msg.links)
      .then(sendResponse)
      .catch(e => sendResponse({ enqueued: 0, skipped: 0, errors: [e.message] }));
    return true;
  }
  if (msg.action === 'fetchImage') {
    // A CSP do WhatsApp Web bloqueia img-src externo; o SW busca e devolve data: URL
    fetchImageAsDataUrl(msg.url)
      .then(dataUrl => sendResponse({ dataUrl }))
      .catch(() => sendResponse({ dataUrl: null }));
    return true;
  }
  if (msg.action === 'focusWhatsApp') {
    focusWhatsApp().then(sendResponse);
    return true;
  }
  if (msg.action === 'openProductAndApprove') {
    openProductAndApprove(msg.candidate, msg.grupo)
      .then(sendResponse)
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  // Lê/grava um arquivo compartilhado entre os perfis (via native host).
  // Usado pelo cofre de cupons: cada perfil tem seu chrome.storage isolado.
  if (msg.action === 'sharedFile') {
    chrome.runtime.sendNativeMessage(
      'com.promos.opener',
      { cmd: msg.mode === 'write' ? 'writeShared' : 'readShared', file: msg.file, data: msg.data || '' },
      resp => {
        if (chrome.runtime.lastError) sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        else sendResponse({ ok: true, data: resp?.data ?? '' });
      }
    );
    return true;
  }
  // Abre uma URL em OUTRO perfil do Chrome via native host (cross-profile).
  if (msg.action === 'openInOtherProfile') {
    chrome.runtime.sendNativeMessage(
      'com.promos.opener',
      { url: msg.url, profileDir: msg.profileDir, chromePath: msg.chromePath || '' },
      resp => {
        if (chrome.runtime.lastError) sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        else sendResponse({ ok: true, resp });
      }
    );
    return true;
  }
  // Recebido neste perfil quando o produto chegou pela URL (#promosApprove) de
  // outro perfil: injeta o ambiente na aba atual e monta o post com a conta logada aqui.
  if (msg.action === 'handoffApprove') {
    handoffApprove(_sender?.tab?.id, msg.candidate, msg.grupo)
      .then(sendResponse)
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});

// Dedup de abas do WhatsApp Web. O botão "Enviar p/ WA" vindo do perfil
// secundário abre web.whatsapp.com via ponte nativa (chrome.exe <url>), e o
// Chrome SEMPRE cria uma aba nova — que recarrega o WhatsApp e demora. Aqui, se
// já existe uma aba do WhatsApp, focamos a existente e descartamos a recém-criada.
chrome.tabs.onCreated.addListener(async (tab) => {
  const url = tab.pendingUrl || tab.url || '';
  if (!/^https:\/\/web\.whatsapp\.com\//i.test(url)) return;
  try {
    const waTabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    const existing = waTabs.find(t => t.id !== tab.id);
    if (!existing) return; // não há WA aberto ainda → deixa esta carregar (1ª vez)
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
    await chrome.tabs.remove(tab.id);
  } catch (_) {}
});

async function handoffApprove(tabId, candidate, grupo) {
  if (!tabId) return { ok: false, error: 'sem aba' };
  await delay(3500); // SPA + redirect do meli.la + barra de afiliado renderizar
  await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPTS });
  // Fire-and-forget: não aguarda (ML pode levar >30s p/ gerar o link)
  chrome.tabs.sendMessage(tabId, { action: 'buildPostFromCandidate', candidate, grupo });
  return { ok: true };
}

/** Segue o amzn.to e devolve o tag de afiliado do destino ({tag:null} = não deu para saber). */
async function verificarTagAmazon(url) {
  if (!url) return { tag: null };
  try {
    const direto = new URL(url).searchParams.get("tag");
    if (direto) return { tag: direto.toLowerCase() };
    const resp = await fetch(url, { redirect: "follow", credentials: "omit" });
    const tag = new URL(resp.url).searchParams.get("tag");
    return { tag: tag ? tag.toLowerCase() : null };
  } catch (_) { return { tag: null }; }
}

/** Segue o meli.la e devolve o affiliate_tool (conta de afiliado) do destino. */
async function verificarMattTool(url) {
  if (!url) return { mattTool: null };
  try {
    const direto = new URL(url).searchParams.get("affiliate_tool");
    if (direto) return { mattTool: String(direto) };
    const resp = await fetch(url, { redirect: "follow", credentials: "omit" });
    let t = new URL(resp.url).searchParams.get("affiliate_tool");
    if (!t) { const html = await resp.text(); t = (html.match(/affiliate_tool=(\d{4,})/) || [])[1] || null; }
    return { mattTool: t ? String(t) : null };
  } catch (_) { return { mattTool: null }; }
}
async function focusWhatsApp() {
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
    return { found: true };
  }
  await chrome.tabs.create({ url: 'https://web.whatsapp.com', active: true });
  return { found: false };
}

/**
 * Abre a página do produto numa aba ATIVA (1ª plano, ritmo humano → o ML não
 * bloqueia) e dispara a montagem do post com o link de afiliado nessa aba.
 */
/** Resolve um link com fallback de aba real (encurtadores que bloqueiam fetch). */
async function resolveLinkDeepFn(url) {
  const r = await globalThis.PromosLinkResolver.resolve(url).catch(() => null);
  if (r && r.isValid) return r;
  return resolveLinkViaTab(url).catch(() => ({ isValid: false }));
}

/**
 * Busca o preço original ("De") real da página do ML, sem abrir aba.
 * O "De" transcrito do grupo de WhatsApp costuma vir inflado; este é o preço
 * de tabela de fato exibido na página. Best-effort: null se o fetch ou a
 * extração falharem (o chamador mantém o De do grupo nesse caso).
 */
async function fetchMlDe(productUrl, pricePor = null) {
  if (!productUrl) return { priceDe: null };
  try {
    const resp = await fetch(productUrl, {
      redirect: 'follow',
      credentials: 'omit',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      },
    });
    const html = await resp.text();
    const priceDe = globalThis.PromosLinkResolver.extractMlDeFromHtml(html, pricePor);
    return { priceDe: priceDe || null };
  } catch (_) {
    return { priceDe: null };
  }
}

/** URL LIMPA do produto a partir do resultado do resolver (qualquer marketplace). */
function cleanProductUrl(r) {
  if (!r || !r.isValid) return null;
  if (r.marketplace === 'mercadolivre' && r.mlbId) {
    return `https://www.mercadolivre.com.br/p/MLB${String(r.mlbId).replace(/\D/g, '')}`;
  }
  return r.productUrl ? String(r.productUrl).split('#')[0] : null;
}

/** URL direta do produto montada só com os IDs do candidato (sem rede). */
function directProductUrl(c) {
  const site = c.site || c.marketplace || '';
  if (site === 'mercadolivre' && c.mlbId) {
    const d = String(c.mlbId).replace(/\D/g, '');
    if (d) return `https://www.mercadolivre.com.br/p/MLB${d}`;
  }
  if (site === 'amazon' && c.asin) return `https://www.amazon.com.br/dp/${c.asin}`;
  if (site === 'shopee' && c.shopId && c.itemId) return `https://shopee.com.br/product/${c.shopId}/${c.itemId}`;
  return null;
}

/** É uma URL de um marketplace que sabemos monetizar (Amazon/ML/Shopee)? */
function isSupportedMarketplaceUrl(url) {
  return /amazon\.com\.br|amzn\.to|mercadoli[bv]re\.com|meli\.la|shopee\.com\.br|shope\.ee/i.test(String(url || ''));
}

async function openProductAndApprove(candidate, grupo) {
  // Abre DIRETO na página do produto. Resolve a URL limpa antes (igual ao
  // cross-profile): evita a tela /social/ do ML, que exige clicar "ir para o
  // produto" e atrasa a barra de afiliado — principal causa do meli.la não gerar.
  let url = directProductUrl(candidate);
  if (!url) {
    const raw = candidate.rawUrl || candidate.productUrl || candidate.url;
    if (!raw) return { ok: false, error: 'sem URL do produto' };
    const r = await resolveLinkDeepFn(raw).catch(() => null);
    url = cleanProductUrl(r);
    if (!url) {
      // Não resolveu para um produto de marketplace suportado. Se o link cru
      // também não é Amazon/ML/Shopee (ex: promosdaluh→Época, que não dá
      // afiliado), NÃO abre aba nenhuma — evita o vai-e-volta de abas.
      if (!isSupportedMarketplaceUrl(raw)) {
        return { ok: false, error: 'nao-marketplace' };
      }
      url = raw; // é marketplace mas não deu pra limpar — abre assim mesmo
    }
  }

  const tab = await chrome.tabs.create({ url, active: true });
  await waitForTabLoad(tab.id);
  await delay(4000); // redirect do meli.la + SPA + barra de afiliado
  // ML: a forma /p/MLB<id> às vezes dá 404 ("esta página não existe"); a forma
  // produto.../MLB-<id> abre (e vice-versa). Se 404, troca pelo formato alternativo.
  await fixMl404IfNeeded(tab.id, url);
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_SCRIPTS });
  // Fire-and-forget: não aguarda resposta para não fechar o canal antes do ML
  // gerar o link de afiliado (pode levar >30s se houver tela intermediária).
  chrome.tabs.sendMessage(tab.id, { action: 'buildPostFromCandidate', candidate, grupo });
  return { ok: true };
}

/** Formato alternativo de URL do ML (catálogo /p/MLB<id> ↔ anúncio /MLB-<id>). */
function mlAltUrl(u) {
  const base = String(u).split('#')[0].split('?')[0];
  let m;
  if ((m = base.match(/\/p\/MLB(\d+)/)))  return `https://produto.mercadolivre.com.br/MLB-${m[1]}`;
  if ((m = base.match(/\/MLB-?(\d+)/)))   return `https://www.mercadolivre.com.br/p/MLB${m[1]}`;
  return null;
}

/** Se a aba ML está numa página 404, navega para o formato alternativo de URL. */
async function fixMl404IfNeeded(tabId, url) {
  if (!/mercadolivre\.com\.br/i.test(url)) return;
  const alt = mlAltUrl(url);
  if (!alt) return;
  let is404 = false;
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => /n[ãa]o existe|p[áa]gina n[ãa]o encontrada|page not found/i
        .test((document.body?.innerText || '').slice(0, 4000)),
    });
    is404 = !!res?.result;
  } catch (_) {}
  if (!is404) return;
  await chrome.tabs.update(tabId, { url: alt });
  await waitForTabLoad(tabId);
  await delay(3000);
}

/**
 * Abre o painel Shopee "Link personalizado" em background, preenche a URL e
 * o Sub_id 1, clica em "Obter link" e captura o link s.shopee.com.br gerado.
 * Fecha a aba ao terminar. Retorna null se falhar.
 */
async function generateShopeeAffiliateLink(productUrl, subId) {
  const CUSTOM_LINK_URL = 'https://affiliate.shopee.com.br/offer/custom_link';
  let tab;
  try {
    tab = await chrome.tabs.create({ url: CUSTOM_LINK_URL, active: false });
    await waitForTabLoad(tab.id);
    await delay(3500); // SPA da Shopee precisa de tempo para renderizar

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (productUrl, subId) => {
        return new Promise((resolve) => {
          try {
            // Preenche textarea com a URL do produto
            const textarea = document.querySelector('textarea');
            if (!textarea) { resolve({ error: 'textarea não encontrada', link: null }); return; }

            const nativeTextareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            nativeTextareaSetter.call(textarea, productUrl);
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));

            // Preenche Sub_id 1 (primeiro input de texto)
            const inputs = [...document.querySelectorAll('input[type="text"], input:not([type])')];
            if (inputs[0] && subId) {
              const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              nativeInputSetter.call(inputs[0], subId);
              inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
              inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
            }

            // Aguarda um tick para o React processar e clica em "Obter link"
            setTimeout(() => {
              const btn = [...document.querySelectorAll('button')].find(b => /obter\s*link/i.test(b.textContent.trim()));
              if (!btn) { resolve({ error: 'botão Obter link não encontrado', link: null }); return; }
              btn.click();

              // Polling por até 12s aguardando o link gerado aparecer
              const SHORT_RE = /https?:\/\/s\.shopee\.com\.br\/\S+|https?:\/\/shope\.ee\/\S+/;
              let tries = 0;
              const poll = setInterval(() => {
                tries++;
                for (const el of document.querySelectorAll('input, textarea')) {
                  const m = el.value.match(SHORT_RE);
                  if (m) { clearInterval(poll); resolve({ link: m[0] }); return; }
                }
                const m = document.body.innerText.match(SHORT_RE);
                if (m) { clearInterval(poll); resolve({ link: m[0] }); return; }
                if (tries >= 60) { clearInterval(poll); resolve({ error: 'timeout aguardando link', link: null }); }
              }, 200);
            }, 500);
          } catch (e) {
            resolve({ error: e.message, link: null });
          }
        });
      },
      args: [productUrl, subId],
    });

    const res = result?.result;
    if (res?.error) console.warn('[Promos] Shopee custom link:', res.error);
    return res?.link || null;
  } catch (e) {
    console.warn('[Promos] generateShopeeAffiliateLink falhou:', e.message);
    return null;
  } finally {
    if (tab) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

/** Busca uma imagem e converte para data: URL (base64). SW não tem FileReader. */
async function fetchImageAsDataUrl(url) {
  if (!url) return null;
  const resp = await fetch(url, { credentials: 'omit' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const buf = await resp.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000; // evita estouro de pilha no String.fromCharCode
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  const type = resp.headers.get('content-type') || 'image/jpeg';
  return `data:${type};base64,${btoa(bin)}`;
}

// ── Motor Radar ───────────────────────────────────────────────────────────────

async function runRadar() {
  const results = { enqueued: 0, skipped: 0, errors: [], sources: [] };

  for (const url of RADAR.sources) {
    let tab;
    try {
      tab = await chrome.tabs.create({ url, active: false });
      await waitForTabLoad(tab.id);
      // Aguarda renderização da SPA (ML/Amazon carregam via JS)
      await delay(RADAR.spaDelayMs);
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_SCRIPTS });
      const result = await sendMessageToTab(tab.id, { action: 'parseAndScoreForRadar' });
      results.enqueued += result?.enqueued || 0;
      results.skipped  += result?.skipped  || 0;
      results.sources.push({ url, enqueued: result?.enqueued || 0, details: result?.details || '' });
    } catch (e) {
      results.errors.push(`${url}: ${e.message}`);
      console.error('[Promos] Radar erro em', url, e);
    } finally {
      if (tab) chrome.tabs.remove(tab.id).catch(() => {});
    }
  }

  return results;
}

async function runRadarAndNotify(originTabId) {
  // Avisa que o radar está rodando
  try {
    await injectAndSend(originTabId, { action: 'radarStatus', status: 'running' });
  } catch (_) {}

  const results = await runRadar().catch(e => ({ enqueued: 0, errors: [e.message] }));

  // Abre a fila de revisão na aba de origem com o resultado
  try {
    await injectAndSend(originTabId, {
      action: 'radarStatus',
      status: 'done',
      enqueued: results.enqueued,
      errors: results.errors,
    });
  } catch (_) {}

  if (results.enqueued > 0) {
    // Abre a fila para o usuário revisar
    await injectAndSend(originTabId, { action: 'showQueue' });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    const timeout = setTimeout(resolve, 20000); // fallback 20s
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * Resolve um link abrindo-o numa aba em segundo plano e deixando o NAVEGADOR
 * seguir todos os redirects (inclusive meta-refresh/JS que o fetch não segue).
 * Lê a URL final; se cair numa página ML que não é produto (ex.: /social/),
 * raspa o item_id do DOM. Fecha a aba ao terminar. Retorna {isValid:false} se
 * não conseguir. Uso pontual (aprovação) — abre 1 aba.
 */
async function resolveLinkViaTab(url) {
  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    await waitForTabLoad(tab.id);
    await delay(2500); // deixa redirect JS/meta-refresh acontecer

    // Tenta a URL final algumas vezes (redirects encadeados podem demorar).
    for (let i = 0; i < 4; i++) {
      const finalUrl = (await chrome.tabs.get(tab.id).catch(() => null))?.url || '';
      const r = globalThis.PromosLinkResolver.extract(finalUrl);
      if (r.isValid) return r;
      await delay(2000);
    }

    // URL final não é produto (ex.: /social/ de afiliado): raspa o item_id do DOM.
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const html = document.documentElement.innerHTML;
          const m = html.match(/"item_id"\s*:\s*"(MLB\d{6,})"/);
          const canon = document.querySelector('link[rel="canonical"]')?.href || '';
          return { mlb: m ? m[1] : null, canon };
        },
      });
      const out = res?.result || {};
      if (out.mlb) {
        return {
          marketplace: 'mercadolivre',
          productUrl: `https://produto.mercadolivre.com.br/MLB-${out.mlb.slice(3)}`,
          asin: null, mlbId: out.mlb, shopId: null, itemId: null, isValid: true,
        };
      }
      if (out.canon) {
        const r = globalThis.PromosLinkResolver.extract(out.canon);
        if (r.isValid) return r;
      }
    } catch (_) {}

    return { isValid: false };
  } finally {
    if (tab) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, res => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res);
    });
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Frase de chamada por IA (Claude Haiku 4.5) ────────────────────────────────

/**
 * Gera 2-3 frases de chamada para o produto/grupo via API da Claude.
 * Modelo Haiku 4.5 (rápido/barato), max_tokens baixo (teto de custo rígido).
 * Retorna { phrases: [...] } ou { error, detail }.
 */
async function generateHook(parsed, group, examples = []) {
  const { anthropicApiKey } = await chrome.storage.local.get('anthropicApiKey');
  if (!anthropicApiKey) return { error: 'sem-chave' };

  const voz = group === 'musculosas'
    ? 'Público fitness/academia. Tom energético, direto e motivacional.'
    : 'Público feminino/geral (casa, beleza, moda, cozinha). Tom leve, divertido e próximo, com bom humor.';

  const nome  = parsed.name || '';
  const por   = parsed.pricePor != null ? `R$ ${parsed.pricePor}` : '';
  const de    = parsed.priceDe  != null ? `R$ ${parsed.priceDe}`  : '';
  const desc  = parsed.discount != null ? `${parsed.discount}% OFF` : '';

  // Few-shot: frases reais já aprovadas (do banco do usuário) como referência
  // de estilo. Limita a 8 p/ não inflar a entrada.
  const exemplos = (examples || [])
    .map(s => String(s || '').trim())
    .filter(Boolean)
    .slice(0, 8);
  const exemplosBloco = exemplos.length
    ? '\nEXEMPLOS de frases que funcionam bem neste estilo (inspire-se no TOM, não copie):\n' +
      exemplos.map(s => `- ${s}`).join('\n') + '\n'
    : '';

  const system =
    'Você é COPYWRITER de frases de chamada (hooks) para posts de promoção em grupos de WhatsApp de ofertas. A frase é a PRIMEIRA linha do post — tem que fazer a pessoa PARAR e querer ver a oferta.\n' +
    voz + '\n' +
    'FORMA:\n' +
    '- Curta (máx ~6 palavras), de impacto, TODA EM CAIXA ALTA.\n' +
    '- SEM emoji (o sistema adiciona), SEM preço, SEM "compre", SEM link, SEM nome técnico do produto.\n' +
    'CONTEÚDO (é o que separa boa de genérica):\n' +
    '- APROVEITE um detalhe CONCRETO do produto (sabor, cor, edição, tamanho, marca) — é o que tira do genérico.\n' +
    '- PROIBIDO clichê vazio sem nada específico (ex.: "GANHOS MAIORES", "RESULTADO RÁPIDO", "FORÇA EM DOBRO").\n' +
    'VARIE DE VERDADE — entregue exatamente 6 frases nesta divisão:\n' +
    '- 2 com HUMOR (leve, engraçado, pode brincar com o produto).\n' +
    '- 2 explorando um DETALHE concreto do produto (ex.: o sabor, a cor).\n' +
    '- 2 falando DIRETO com o público provável DO PRODUTO (decida pelo produto, não só pelo grupo: um suplemento saborizado/colorido pode mirar maromba E público feminino).\n' +
    'Exemplos de TOM (de outros produtos, só referência — NÃO copie): "CHEGA DE COPO DE REQUEIJÃO", "ESSE CHEIRO É PURO GOLPE", "TREINO PEDE, ELA ENTREGA".\n' +
    exemplosBloco +
    'Responda APENAS com JSON: {"frases": ["FRASE 1", ..., "FRASE 6"]}';

  const userMsg =
    `Produto: ${nome}\n` +
    `Preço: ${por}${de ? ` (de ${de})` : ''}${desc ? ` — ${desc}` : ''}\n` +
    `Categoria: ${parsed.category || '—'}\n\n` +
    'Primeiro identifique (na sua cabeça) UM detalhe concreto do produto e o público provável. ' +
    'Depois gere as 6 frases na divisão pedida (2 humor, 2 detalhe do produto, 2 público).';

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 550,           // 6 frases variadas (algumas com humor) cabem com folga
        system,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      return { error: `http-${resp.status}`, detail: t.slice(0, 200) };
    }
    const data = await resp.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const phrases = parseHookJson(text);
    if (!phrases.length) return { error: 'sem-frases', detail: text.slice(0, 200) };
    return { phrases };
  } catch (e) {
    return { error: 'fetch', detail: (e.message || '').slice(0, 200) };
  }
}

/** Extrai as frases do JSON da IA; cai para linhas se o JSON falhar. */
function parseHookJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const obj = JSON.parse(m[0]);
      if (Array.isArray(obj.frases)) {
        return obj.frases.map(s => String(s).trim()).filter(Boolean).slice(0, 6);
      }
    } catch (_) {}
  }
  return text.split('\n')
    .map(l => l.replace(/^[-*\d.\s"]+/, '').replace(/"+\s*$/, '').trim())
    .filter(l => l.length >= 3 && l.length <= 70)
    .slice(0, 6);
}

// ── Garimpo ───────────────────────────────────────────────────────────────────

async function garimparLinks(links) {
  // links: array de { url, msgTime } ou strings (retrocompatível)
  const results = {
    enqueued: 0,
    reasons: { duplicado: 0, semParser: 0, semNome: 0, verificacao: 0, resolveInvalido: 0, erro: 0 },
    errors: [],
    failures: [], // { rawUrl, resolvedUrl, finalUrl, reason } para diagnóstico
  };

  for (const link of links) {
    const rawUrl  = typeof link === 'string' ? link : link.url;
    const msgMeta = typeof link === 'string' ? {} : {
      msgTime:  link.msgTime  || null,
      coupon:   link.coupon   || null,
      hook:     link.hook     || null,
      priceDe:  link.priceDe  ?? null,
      pricePor: link.pricePor ?? null,
    };

    // 1. Resolve o link para URL canônica
    let resolved;
    try {
      resolved = await globalThis.PromosLinkResolver.resolve(rawUrl);
    } catch (_) {
      results.reasons.resolveInvalido++;
      continue;
    }
    if (!resolved?.isValid) {
      results.reasons.resolveInvalido++;
      results.failures.push({ rawUrl, resolvedUrl: null, finalUrl: null, reason: 'resolveInvalido' });
      continue;
    }

    // 2. Abre a página do produto em background e parseia
    let tab;
    try {
      tab = await chrome.tabs.create({ url: resolved.productUrl, active: false });
      await waitForTabLoad(tab.id);
      await delay(3000); // aguarda SPA e possível redirect do ML

      // Anti-bot do ML: se caiu na verificação de conta, espera e recarrega 1x
      // (cool-down legítimo; NÃO resolvemos CAPTCHA). Persistiu → reporta.
      if (await isGated(tab.id)) {
        await delay(6000);
        await chrome.tabs.update(tab.id, { url: resolved.productUrl });
        await waitForTabLoad(tab.id);
        await delay(3000);
        if (await isGated(tab.id)) {
          results.reasons.verificacao++;
          const finalUrl = (await chrome.tabs.get(tab.id).catch(() => null))?.url || null;
          results.failures.push({ rawUrl, resolvedUrl: resolved.productUrl, finalUrl, reason: 'verificacao' });
          continue; // finally remove a aba
        }
      }

      const msg = { action: 'parseAndScoreForGarimpo', msgMeta };
      let res;
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_SCRIPTS });
        res = await sendMessageToTab(tab.id, msg);
      } catch (connErr) {
        // Tab pode ter redirecionado após o load — aguarda e tenta novamente
        if (connErr.message?.includes('establish connection') || connErr.message?.includes('Receiving end')) {
          await waitForTabLoad(tab.id);
          await delay(2000);
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_SCRIPTS });
          res = await sendMessageToTab(tab.id, msg);
        } else {
          throw connErr;
        }
      }

      if (res?.enqueued) {
        results.enqueued += res.enqueued;
      } else {
        const reason = res?.reason || 'erro';
        results.reasons[reason] = (results.reasons[reason] || 0) + 1;
        // Captura a URL final da aba (após redirects) para diagnóstico
        let finalUrl = null;
        try { finalUrl = (await chrome.tabs.get(tab.id))?.url || null; } catch (_) {}
        results.failures.push({ rawUrl, resolvedUrl: resolved.productUrl, finalUrl, reason });
      }
    } catch (e) {
      results.reasons.erro++;
      results.errors.push(`${new URL(resolved.productUrl).pathname.slice(0, 40)}: ${e.message.slice(0, 60)}`);
      let finalUrl = null;
      try { finalUrl = tab ? (await chrome.tabs.get(tab.id))?.url || null : null; } catch (_) {}
      results.failures.push({ rawUrl, resolvedUrl: resolved.productUrl, finalUrl, reason: 'erro', erro: e.message.slice(0, 80) });
    } finally {
      if (tab) chrome.tabs.remove(tab.id).catch(() => {});
    }

    // Espaça as aberturas para não disparar o anti-bot do ML
    await delay(1500);
  }

  results.skipped = Object.values(results.reasons).reduce((a, b) => a + b, 0);
  return results;
}

/** True se a aba caiu numa página de verificação anti-bot do Mercado Livre. */
async function isGated(tabId) {
  try {
    const url = (await chrome.tabs.get(tabId))?.url || '';
    return /account-verification|\/gz\/|challenge|captcha/i.test(url);
  } catch (_) {
    return false;
  }
}

/** Lê kate-logo.png da extensão e retorna como data URL (sem CSP). */
async function loadLogoDataUrl() {
  try {
    const resp = await fetch(chrome.runtime.getURL('content/kate-logo.png'));
    const buf  = await resp.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK)
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    return 'data:image/png;base64,' + btoa(bin);
  } catch (_) { return null; }
}

/** Verifica se uma URL gera prévia GRANDE no WhatsApp (og:image >= 300×300). */
async function checkLinkPreview(url) {
  const TIMEOUT = new Promise(res =>
    setTimeout(() => res({ hasLargePreview: false, hasMiniPreview: false, imageUrl: null, finalUrl: null }), 12000)
  );
  return Promise.race([TIMEOUT, _checkLinkPreviewInner(url)]);
}

async function _checkLinkPreviewInner(url) {
  try {
    const resp = await fetch(url, {
      redirect: 'follow',
      credentials: 'omit',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WhatsApp/2.2413.6)' },
    });
    const finalHost = new URL(resp.url).hostname;

    // Amazon e Shopee: links de produto sempre têm prévia grande no WhatsApp.
    // Ambos bloqueiam ou limitam o UA do crawler, causando falso negativo.
    if (finalHost.includes('amazon.com') || finalHost.includes('shopee.com') || finalHost.includes('shopee.com.br')) {
      return { hasLargePreview: true, hasMiniPreview: false, imageUrl: null, finalUrl: resp.url };
    }

    const html = await resp.text();

    const getMetaContent = (prop) => {
      const m = html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
             || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, 'i'));
      return m ? m[1] : null;
    };

    const imageUrl = getMetaContent('og:image');
    if (!imageUrl) return { hasLargePreview: false, hasMiniPreview: false, imageUrl: null, finalUrl: resp.url };

    // 1. Tenta dimensões declaradas nas meta tags
    const w = parseInt(getMetaContent('og:image:width')  || '0');
    const h = parseInt(getMetaContent('og:image:height') || '0');

    if (w && h) {
      // Meta tags declaram tamanho → usa diretamente
      const hasLargePreview = !(w < 300 || h < 300);
      return { hasLargePreview, hasMiniPreview: !hasLargePreview, imageUrl, finalUrl: resp.url };
    }

    // 2. Meta tags sem dimensões → baixa a imagem e mede o tamanho real.
    //    WhatsApp exige ≥ 300×300 para prévia grande.
    try {
      const imgResp = await fetch(imageUrl, { redirect: 'follow', credentials: 'omit' });
      if (imgResp.ok) {
        const blob = await imgResp.blob();
        const bmp  = await createImageBitmap(blob);
        const iw   = bmp.width;
        const ih   = bmp.height;
        bmp.close();
        const hasLargePreview = iw >= 300 && ih >= 300;
        return { hasLargePreview, hasMiniPreview: !hasLargePreview, imageUrl, finalUrl: resp.url };
      }
    } catch (_) { /* se não conseguir baixar, cai no fallback */ }

    // 3. Fallback conservador: sem dimensões e sem download → avisa sem prévia
    return { hasLargePreview: false, hasMiniPreview: false, imageUrl, finalUrl: resp.url };
  } catch (e) {
    return { hasLargePreview: false, hasMiniPreview: false, imageUrl: null, finalUrl: null };
  }
}

async function injectAndSend(tabId, message) {
  try {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.url || /^(chrome|about|data|javascript):/.test(tab.url)) return;
    await chrome.scripting.executeScript({
      target: { tabId },
      files: CONTENT_SCRIPTS,
    });
    chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    console.error('[Promos] executeScript falhou:', err);
  }
}
