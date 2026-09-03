// Trava de conta: o link de afiliado só é gerado se o marketplace estiver
// logado na conta DAQUELE grupo.
//
// Sem isto, gerar um post com a conta errada é silencioso — o link funciona, o
// post fica perfeito, e a comissão vai para a conta errada. Só se descobre no
// relatório, semanas depois.
//
// Como cada marketplace se identifica (verificado ao vivo):
//   Mercado Livre → "user_id":"<ID>" no HTML da página + nickname no
//                   cabeçalho (.nav-header-user-nickname). O user_id é o que
//                   vale: não muda se a pessoa trocar o nome de exibição.
//   Amazon        → só a saudação "Olá, <primeiro nome>", que é fraca (duas
//                   contas podem ter o mesmo nome). Por isso, na Amazon a
//                   verificação decisiva é outra: conferir o `tag=` do link
//                   curto já gerado (ver verificarTagAmazon no service worker).
//   Shopee        → nickname do painel, quando disponível.
//
// A conta esperada não vem escrita no código: é CAPTURADA uma vez, quando você
// confirma no overlay que aquela é a conta certa do grupo. Assim não dependemos
// de eu adivinhar nome de conta, e trocar de conta é um clique.
const CHAVE_STORAGE = 'contasPorGrupo';   // { [grupo]: { [site]: {id, nome, em} } }

window.PromosAccountGuard = { detectar, verificar, gravarConta, esquecerConta,
                              mattToolEsperado, gravarMattTool, contaDoConfig, CHAVE_STORAGE };

/** Identidade logada nesta página. { id, nome } — id null quando não dá para saber. */
function detectar(site) {
  try {
    if (site === 'mercadolivre') return detectarML();
    if (site === 'amazon')       return detectarAmazon();
    if (site === 'shopee')       return detectarShopee();
  } catch (_) {}
  return { id: null, nome: null };
}

function detectarML() {
  const html = document.documentElement.innerHTML;
  const id   = (html.match(/"user_id"\s*:\s*"?(\d{6,})"?/) || [])[1] || null;
  const nome =
    document.querySelector('.nav-header-user-nickname')?.textContent.trim() ||
    (html.match(/"nickname"\s*:\s*"([^"]{3,40})"/) || [])[1] ||
    null;
  return { id, nome };
}

function detectarAmazon() {
  // "Olá, Bruno" — identifica pouco, mas serve para você VER com qual conta
  // está antes de confirmar. A trava real na Amazon é o tag do link gerado.
  const saud = document.querySelector('#nav-link-accountList-nav-line-1')?.textContent.trim() || null;
  const nome = saud ? saud.replace(/^ol[áa],?\s*/i, '').trim() : null;
  const deslogado = !nome || /fa[çc]a seu login|entre|sign in/i.test(saud || '');
  return { id: deslogado ? null : `nome:${nome.toLowerCase()}`, nome: deslogado ? null : nome };
}

function detectarShopee() {
  const el = document.querySelector('[class*="username"], [class*="account-name"]');
  const nome = el ? el.textContent.trim() : null;
  return { id: nome ? `nome:${nome.toLowerCase()}` : null, nome };
}

/**
 * Pode gerar link para este grupo nesta página?
 *  { ok:true }                        → conta confere
 *  { ok:false, motivo }               → conta DIFERENTE (bloqueia)
 *  { ok:true, semReferencia, atual }  → grupo ainda sem conta gravada
 *  { ok:true, semIdentidade }         → não deu para ler a conta (não bloqueia)
 */
async function verificar(site, grupo) {
  const atual = detectar(site);

  // 1º: o que está no config da build (vale para quem receber o pacote).
  const doConfig = contaDoConfig(site, grupo);
  if (doConfig) {
    if (!atual.id) return { ok: true, semIdentidade: true, atual };
    return atual.id === doConfig.id
      ? { ok: true }
      : { ok: false, atual, esperada: doConfig, motivo: 'conta diferente da configurada' };
  }

  // 2º: o que foi aprendido nesta máquina (build sem contas configuradas).
  const todas = await lerContas();
  const esperada = todas[grupo] && todas[grupo][site];

  if (!atual.id) return { ok: true, semIdentidade: true, atual };
  if (!esperada) return { ok: true, semReferencia: true, atual };

  if (esperada.id !== atual.id) {
    const nomeGrupo = window.PromosConfig.GROUPS[grupo]?.name || grupo;
    return {
      ok: false,
      atual, esperada,
      motivo: `Conta errada para ${nomeGrupo}.\n\n`
        + `Logado como: ${atual.nome || atual.id}\n`
        + `Esperado:    ${esperada.nome || esperada.id}\n\n`
        + `Entre com a conta do grupo e tente de novo — assim a comissão não vai para a conta errada.`,
    };
  }
  return { ok: true };
}

/** Grava a conta atual como sendo a do grupo (você confirma no overlay). */
async function gravarConta(site, grupo, conta) {
  const todas = await lerContas();
  todas[grupo] = todas[grupo] || {};
  todas[grupo][site] = { id: conta.id, nome: conta.nome, em: Date.now() };
  await chrome.storage.local.set({ [CHAVE_STORAGE]: todas });
}

/** Esquece a conta gravada (trocou de conta de propósito). */
async function esquecerConta(site, grupo) {
  const todas = await lerContas();
  if (todas[grupo]) { delete todas[grupo][site]; await chrome.storage.local.set({ [CHAVE_STORAGE]: todas }); }
}

async function lerContas() {
  const r = await chrome.storage.local.get(CHAVE_STORAGE);
  return r[CHAVE_STORAGE] || {};
}

/**
 * affiliate_tool esperado do grupo (conta de afiliado do ML). Só existe depois que
 * a conta foi confirmada e um link foi gerado com ela.
 */
async function mattToolEsperado(grupo) {
  const doConfig = mattToolDoConfig(grupo);
  if (doConfig) return doConfig;
  const todas = await lerContas();
  const reg = todas[grupo] && todas[grupo].mercadolivre;
  return (reg && reg.mattTool) || null;
}

/** Guarda o affiliate_tool na conta do grupo — só se a conta já foi confirmada. */
async function gravarMattTool(grupo, mattTool) {
  const todas = await lerContas();
  if (!todas[grupo] || !todas[grupo].mercadolivre) return false;  // conta ainda não confirmada
  todas[grupo].mercadolivre.mattTool = String(mattTool);
  await chrome.storage.local.set({ [CHAVE_STORAGE]: todas });
  return true;
}

/** Conta esperada declarada no config da build. null = sem trava. */
function contaDoConfig(site, grupo) {
  const cfg = window.PromosConfig.GROUPS[grupo];
  if (!cfg || !cfg.contas) return null;
  if (site === "mercadolivre" && cfg.contas.mlUserId) {
    return { id: String(cfg.contas.mlUserId), nome: "conta do " + cfg.name };
  }
  return null;
}

/** affiliate_tool declarado no config (tem prioridade sobre o aprendido). */
function mattToolDoConfig(grupo) {
  const cfg = window.PromosConfig.GROUPS[grupo];
  return (cfg && cfg.contas && cfg.contas.mlMattTool) ? String(cfg.contas.mlMattTool) : null;
}
