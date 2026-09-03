(function () {
  'use strict';
  window.PromosTemplate = {};

  /**
   * Monta o texto do post de WhatsApp.
   *
   * Regras (CLAUDE.md):
   *  - Linha em branco depois do NOME
   *  - Entre "De" e "Por": SEM linha em branco
   *  - Linha em branco entre os demais blocos
   *  - Cupom: só se houver
   *  - Rodapé: 1 linha (label + URL juntos)
   *  - Preço: R$ 1.234,56
   */
  window.PromosTemplate.build = function build(parsed, affiliateUrl, group) {
    const cfg   = window.PromosConfig.GROUPS[group];
    const emoji = chooseEmoji(parsed, group);

    // Grupos com layout próprio (cfg.layout) não seguem o formato padrão.
    if (cfg && cfg.layout === 'jotape') return buildJotape(parsed, affiliateUrl, cfg, emoji);

    const lines = [];

    // ── Frase de chamada (opcional) + nome ────────────────────────────────
    // Um único emoji, sempre na PRIMEIRA linha (onde rende mais — notificação/
    // prévia do WhatsApp): na frase quando houver, senão no nome.
    const hook = (parsed.hook || '').trim();
    const nome = (parsed.name || '').trim();
    if (hook) {
      lines.push(`${emoji} *${hook}*`);
      lines.push('');           // linha em branco após a frase
      lines.push(`*${nome}*`);  // nome sem emoji (a frase já carrega o emoji)
    } else {
      lines.push(`${emoji} *${nome}*`);
    }
    lines.push('');  // linha em branco após nome

    // ── Bloco De/Por ──────────────────────────────────────────────────────
    const couponValid = parsed.coupon &&
      (!parsed.couponMin || !parsed.pricePor || parsed.pricePor >= parsed.couponMin);
    // Por PADRÃO o "Por" é o preço da fila/página — NÃO aplica o cupom sozinho
    // (cupons têm condições: mínimo de unidades, "até X%", etc → risco de preço
    // errado pra baixo). Só aplica se o usuário pedir explicitamente no overlay
    // (parsed.applyCoupon), editando o % do cupom.
    const priceFinal = (parsed.applyCoupon && couponValid && parsed.couponPct && parsed.pricePor)
      ? parsed.pricePor * (1 - parsed.couponPct / 100)
      : null;
    const displayPor = priceFinal ?? parsed.pricePor;

    // Só mostra "De" quando ele é MAIOR que o "Por" (desconto real). Se vier
    // ausente, igual ou menor (dado ruim/sem promoção), mostra só o "Por".
    if (parsed.priceDe && displayPor && parsed.priceDe > displayPor) {
      // Recalcula desconto total de priceDe até o preço que será exibido
      const totalDiscount = Math.round((1 - displayPor / parsed.priceDe) * 100);
      lines.push(`~De: ${fmt(parsed.priceDe)}~ *-${totalDiscount}%*`);
      lines.push(`*Por: ${fmt(displayPor)}*`);
    } else if (displayPor) {
      lines.push(`*Por: ${fmt(displayPor)}*`);
    }
    lines.push('');

    // ── Cupom (opcional) ──────────────────────────────────────────────────
    if (couponValid) {
      const isClickCoupon = /^\d+%|^R\$/.test(parsed.coupon);
      lines.push(isClickCoupon
        ? `🎟️ *${parsed.coupon}*`
        : `🎟️ Cupom: *${parsed.coupon}*`
      );
      lines.push('');
    }

    // ── Link ──────────────────────────────────────────────────────────────
    lines.push(`🔗 Compre: ${affiliateUrl}`);
    lines.push('');  // linha em branco antes do rodapé

    // ── Rodapé (1 linha) ──────────────────────────────────────────────────
    lines.push(cfg.footer);

    return lines.join('\n');
  };

  /**
   * Layout do grupo JOTAPETGC. Diferenças em relação ao padrão:
   *  - chamada FIXA na 1ª linha (cfg.chamadaFixa), não a frase editável;
   *  - sem negrito, sem riscado e sem o "-X%";
   *  - "De R$X ❌" / "Por R$Y ✅", preço colado no cifrão;
   *  - linha "Loja Verificada no ML" quando o produto é do Mercado Livre;
   *  - rodapé em duas linhas (nome do grupo, depois o link).
   */
  function buildJotape(parsed, affiliateUrl, cfg, emoji) {
    const lines = [];
    const nome = (parsed.name || "").trim();

    lines.push(cfg.chamadaFixa);
    lines.push("");
    lines.push(emoji + " " + nome);
    lines.push("");

    // Mesma regra do padrão: o cupom NÃO altera o preço sozinho.
    const couponValid = parsed.coupon &&
      (!parsed.couponMin || !parsed.pricePor || parsed.pricePor >= parsed.couponMin);
    const priceFinal = (parsed.applyCoupon && couponValid && parsed.couponPct && parsed.pricePor)
      ? parsed.pricePor * (1 - parsed.couponPct / 100)
      : null;
    const displayPor = priceFinal != null ? priceFinal : parsed.pricePor;

    if (parsed.priceDe && displayPor && parsed.priceDe > displayPor) {
      lines.push("De " + fmtColado(parsed.priceDe) + " ❌");
      lines.push("Por " + fmtColado(displayPor) + " ✅");
    } else if (displayPor) {
      lines.push("Por " + fmtColado(displayPor) + " ✅");
    }
    lines.push("");

    if (couponValid) {
      const isClickCoupon = /^[0-9]+%|^R[$]/.test(parsed.coupon);
      lines.push(isClickCoupon ? "🎟️ " + parsed.coupon : "🎟️ Cupom: " + parsed.coupon);
      lines.push("");
    }

    if (parsed.site === "mercadolivre") lines.push("Loja Verificada no ML");
    lines.push("🔗 " + affiliateUrl);
    lines.push("");
    lines.push(cfg.footer);

    return lines.join("\n");
  }

  /** Preço colado, como o grupo escreve: R$189,00 */
  function fmtColado(n) {
    const t = fmt(n);
    return t.slice(0, 2) + t.slice(3);   // "R$ 189,00" -> "R$189,00"
  }

  /**
   * Converte o texto do post de WhatsApp para o formato Telegram:
   *  - remove os marcadores de formatação do WhatsApp (* e ~), que apareceriam
   *    LITERAIS ao colar no Telegram (ele não interpreta markdown colado);
   *  - troca o rodapé do grupo (cfg.footer) pelo rodapé do canal (telegramFooter).
   * O link de afiliado fica clicável sozinho (o Telegram auto-linka URLs cruas).
   * Retorna null se o grupo não tem canal de Telegram (sem telegramFooter).
   */
  window.PromosTemplate.toTelegram = function toTelegram(waText, group) {
    const cfg = window.PromosConfig.GROUPS[group];
    if (!cfg || !cfg.telegramFooter) return null;
    let text = (waText || '').replace(/[*~]/g, '');
    if (cfg.footer && text.includes(cfg.footer)) {
      text = text.replace(cfg.footer, cfg.telegramFooter);   // troca o rodapé
    } else {
      // rodapé do WhatsApp não encontrado (texto editado) — garante o do canal
      text = text.replace(/\s*$/, '') + '\n\n' + cfg.telegramFooter;
    }
    return text;
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Formata número para R$ 1.234,56 */
  function fmt(n) {
    if (n == null) return '';
    return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /** Normaliza texto p/ comparação: minúsculas, sem acento. */
  function norm(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  /**
   * Regra de contexto: perfume masc/fem precisa de DUAS condições (é perfume +
   * gênero), o que a tabela de palavra-chave simples não expressa bem.
   * Retorna um conjunto de emojis ou null.
   */
  function perfumeSet(name) {
    const n = norm(name);
    const isPerfume = /\b(perfume|colonia|parfum|fragrancia)\b/.test(n) ||
                      /\beau de\b/.test(n) || /\b(edt|edp)\b/.test(n) || /\bdeo ?colonia\b/.test(n);
    if (!isPerfume) return null;
    const masc = /\b(masculin\w*|pour homme|for men|for him|homme)\b/.test(n);
    const fem  = /\b(feminin\w*|pour femme|for women|for her|femme)\b/.test(n);
    if (masc && !fem) return ['🔥', '💎', '✨', '🧴'];
    if (fem && !masc) return ['🌸', '🌹', '💐', '✨'];
    return ['🌸', '✨', '🧴', '💖', '🔥']; // perfume sem gênero claro
  }

  /** Emoji(s) específico(s) pela palavra-chave do NOME — string OU array, ou null. */
  function emojiFromName(name) {
    const n = norm(name);
    if (!n) return null;
    const ps = perfumeSet(name); // regra de contexto tem prioridade
    if (ps) return ps;
    const list = window.PromosConfig.KEYWORD_EMOJI || [];
    for (const [keywords, emoji] of list) {
      for (const kw of keywords) {
        if (n.includes(kw)) return emoji; // emoji pode ser string ou array
      }
    }
    return null;
  }

  /**
   * Escolhe o emoji de abertura:
   *  1. palavra-chave do NOME (mais específico: tênis→👟, camisa→👕)
   *  2. categoria do produto (EMOJI_MAP)
   *  3. default do grupo / default geral
   * Aceita o objeto `parsed` (usa name + category).
   */
  // Musculosas: o rodapé já traz 💪, então nunca sugerir 💪 de abertura (repete).
  function bannedEmoji(group) { return group === 'musculosas' ? '💪' : null; }

  function chooseEmoji(parsed, group) {
    const map = window.PromosConfig.EMOJI_MAP;
    const banned = bannedEmoji(group);
    const clean = (v) => (Array.isArray(v) ? v : [v]).filter(e => e && e !== banned);
    const rand  = (arr) => arr[Math.floor(Math.random() * arr.length)];

    // Emoji escolhido manualmente no overlay tem prioridade absoluta (respeita 💪).
    if (parsed && typeof parsed === 'object' && parsed.openingEmoji) return parsed.openingEmoji;
    const category = parsed && typeof parsed === 'object' ? parsed.category : parsed;
    const name     = parsed && typeof parsed === 'object' ? parsed.name : null;

    // 1. palavra-chave do nome (se sobrar algo após remover o emoji banido)
    const byName = clean(emojiFromName(name));
    if (byName.length) return byName[0]; // 1º do set = primário

    // 2. categoria
    if (category && map[category]) {
      const c = clean(map[category]);
      if (c.length) return rand(c);
    }
    // 3. default do grupo / geral
    const gd = clean(group && window.PromosConfig.GROUPS[group]?.openingEmojiDefault);
    if (gd.length) return rand(gd);
    return rand(clean(map.default)) || '🔥';
  }

  /**
   * Lista de emojis para o seletor do overlay: o específico do nome primeiro,
   * depois os da categoria, depois alguns gerais. Sem repetição.
   */
  function emojiOptions(parsed, group) {
    const map = window.PromosConfig.EMOJI_MAP;
    const banned = bannedEmoji(group);
    const out = [];
    const add = (e) => { if (e && e !== banned && !out.includes(e)) out.push(e); };

    const byName = emojiFromName(parsed && parsed.name);
    if (Array.isArray(byName)) byName.forEach(add); else add(byName);
    const category = parsed && parsed.category;
    const catVal = category && map[category] ? map[category] : null;
    if (catVal) (Array.isArray(catVal) ? catVal : [catVal]).forEach(add);
    (Array.isArray(map.default) ? map.default : [map.default]).forEach(add);
    return out;
  }

  // Exposto para o overlay reutilizar a mesma lógica
  window.PromosTemplate.chooseEmoji  = chooseEmoji;
  window.PromosTemplate.emojiOptions = emojiOptions;
})();
