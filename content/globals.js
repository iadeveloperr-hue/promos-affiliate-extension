// Espelha lib/config.js para os content scripts (não suportam ES modules)
// ⚠️ Manter sincronizado com lib/config.js
window.PromosConfig = {
  GROUPS: {
    kate: {
      name: 'Promos da Kate',
      footer: '❣️ Promos da Kate: example.com/grupo',
      telegramFooter: '📲 @yourchannel',
      openingEmojiDefault: '🔥',
      amazonTrackingId: 'yourtag-20',
      mlChannel: '<canal_kate>',
      // Conta do ML que pode gerar link deste grupo (affiliate_tool do link).
      // Vazio = sem trava.
      contas: { mlUserId: '', mlMattTool: '' },
      shopeeSubId: 'KateWhatsApp',
    },
    musculosas: {
      name: 'Ofertas Musculosas',
      footer: '💪 Ofertas Musculosas: https://chat.whatsapp.com/EXAMPLE_GROUP_INVITE',
      telegramFooter: null, // sem canal de Telegram ainda
      openingEmojiDefault: '💪',
      amazonTrackingId: 'yourtag2-20',
      mlChannel: '<canal_musculosas>',
      // Conta do ML que pode gerar link deste grupo (affiliate_tool do link).
      // Vazio = sem trava.
      contas: { mlUserId: '', mlMattTool: '00000000' },
      shopeeSubId: 'MusculosasWhatsApp',
    },
    jotape: {
      name: 'JOTAPETGC',
      layout: 'jotape',
      chamadaFixa: 'QUEM NÃO COMPRAR É MALUCO 😱🔥',
      footer: 'JOTAPETGC:\n🔗 https://chat.whatsapp.com/EXAMPLE_GROUP_INVITE',
      telegramFooter: null,
      openingEmojiDefault: '🇧🇷',
      amazonTrackingId: 'yourtag2-20',
      mlChannel: '<canal_jotape>',
      // Conta do ML que pode gerar link deste grupo (affiliate_tool do link).
      // Vazio = sem trava.
      contas: { mlUserId: '', mlMattTool: '00000000' },
      shopeeSubId: 'JotapeWhatsApp',
    },
  },
  // Valores podem ser string (emoji fixo) ou array (sorteia aleatoriamente a cada post)
  EMOJI_MAP: {
    beleza:      ['💄', '✨', '🧴', '💅'],
    cabelo:      ['💇', '✂️', '🌟'],
    cozinha:     ['🍳', '👨‍🍳', '🥘', '🫕'],
    casa:        ['🏠', '🛒', '🏡'],
    moda:        ['👗', '👔', '🛍️', '✨'],
    calcados:    ['👟', '👠', '🥿'],
    fitness:     ['💪', '🏋️', '⚡', '🔥', '🏃'],
    suplemento:  ['🥤', '💪', '⚡', '🔥', '🏆'],
    decoracao:   ['🛋️', '🏠', '🪴', '✨'],
    eletronicos: ['📱', '💻', '🎧', '⚡'],
    infantil:    ['🧸', '🎀', '🎠', '👶'],
    pet:         ['🐾', '🐶', '🐱', '🦴'],
    default:     ['🔥', '⚡', '✨', '🎯'],
  },
  // Emoji por PALAVRA-CHAVE do nome (mais específico que a categoria).
  // Ordem importa; termos SEM acento (o nome é normalizado antes de comparar).
  KEYWORD_EMOJI: [
    [['tenis', 'chuteira'], ['👟', '🏃', '⚡', '🔥']],
    [['sapatenis', 'sapato', 'mocassim', 'oxford'], '👞'],
    [['sandalia', 'rasteira', 'papete'], '👡'],
    [['chinelo', 'slide'], '🩴'],
    [['bota', 'coturno'], '👢'],
    [['salto', 'scarpin', 'sapatilha'], '👠'],
    [['camiseta', 'camisa', 'blusa', 'regata', 'moletom', 'casaco', 'jaqueta', 'polo', 'cropped'], '👕'],
    [['vestido'], '👗'],
    [['calca', 'jeans', 'legging', 'short', 'bermuda', 'calcao'], '👖'],
    [['sutia', 'lingerie', 'calcinha', 'biquini', 'maio'], '👙'],
    [['bolsa', 'mochila', 'carteira', 'necessaire'], '👜'],
    [['bone', 'chapeu', 'touca'], '🧢'],
    [['oculos'], '🕶️'],
    [['meia', 'meiao'], '🧦'],
    [['whey', 'creatina', 'proteina', 'bcaa', 'glutamina', 'suplemento', 'pre treino', 'pretreino', 'malto', 'hipercalorico', 'termogenico', 'albumina', 'colageno'], ['💪', '🥤', '⚡', '🏆']],
    [['halter', 'anilha', 'kettlebell', 'caneleira', 'elastico', 'corda de pular'], '🏋️'],
    [['batom', 'maquiagem', 'base liquida', 'rimel', 'delineador', 'blush', 'corretivo', 'paleta'], '💄'],
    [['perfume', 'colonia'], ['🌸', '✨', '🧴', '💖', '🔥']],
    [['esmalte'], '💅'],
    [['serum', 'hidratante', 'protetor solar', 'creme facial', 'acido', 'skincare'], '🧴'],
    [['shampoo', 'condicionador', 'secador', 'prancha', 'chapinha', 'babyliss', 'escova alisadora', 'mascara capilar'], '💇'],
    [['air fryer', 'airfryer', 'fritadeira', 'panela', 'liquidificador', 'mixer', 'batedeira', 'cafeteira', 'sanduicheira', 'forno eletrico', 'fogao'], '🍳'],
    [['faca', 'cutelo'], '🔪'],
    [['copo', 'garrafa', 'caneca', 'squeeze', 'termica'], '🥤'],
    [['aspirador', 'robo aspirador'], '🧹'],
    [['lampada', 'luminaria', 'abajur'], '💡'],
    [['travesseiro', 'fronha'], '🛏️'],
    [['almofada', 'cortina', 'tapete', 'edredom', 'lencol', 'toalha', 'jogo de cama', 'manta', 'cobertor'], '🛋️'],
    [['organizador', 'cesto', 'cabide'], '🧺'],
    [['fone', 'headphone', 'headset', 'earbud', 'airpod'], '🎧'],
    [['celular', 'smartphone', 'iphone', 'galaxy', 'motorola', 'xiaomi'], '📱'],
    [['notebook', 'laptop'], '💻'],
    [['smartwatch', 'smart watch', 'relogio'], '⌚'],
    [['televisao', 'smart tv', 'monitor'], '📺'],
    [['caixa de som', 'soundbar', 'jbl', 'alto falante'], '🔊'],
    [['carregador', 'cabo usb', 'powerbank', 'power bank'], '🔌'],
    [['teclado', 'mouse'], '⌨️'],
    [['camera', 'webcam', 'gopro'], '📷'],
    [['ventilador', 'climatizador', 'circulador'], '🌀'],
    [['brinquedo', 'boneca', 'lego', 'pelucia', 'fralda', 'bebe', 'carrinho de bebe'], '🧸'],
    [['racao', 'coleira', 'petisco', 'arranhador', 'aquario'], '🐾'],
  ],
  AFFILIATE: {
    amazon: { mode: 'sitestripe', shorten: 'amzn.to' },
    mercadolivre: { via: 'share_button' },
    shopee: { via: 'panel_or_api' },
  },
  // ── Fase 2 — manter sincronizado com lib/config.js ──
  SCORING: {
    weights: { desconto: 0.30, categoria: 0.25, ranking: 0.15, ticket: 0.30 },
    descontoFull: 60,
    ticketFullBRL: 30,
    commissionRates: { amazon: 0.10, mercadolivre: 0.06, shopee: 0.10 },
    minDesconto: 30,
    minScoreAlto: 60,
  },
  GROUP_CATEGORIES: {
    kate:       ['beleza', 'cabelo', 'cozinha', 'casa', 'moda', 'calcados', 'decoracao', 'infantil', 'pet'],
    musculosas: ['fitness', 'suplemento'],
  },
  RADAR: {
    scheduleHours: [8, 12, 18],
    maxPerRun: { kate: 5, musculosas: 3 },
    sources: [
      'https://www.mercadolivre.com.br/mais-vendidos',
      'https://www.amazon.com.br/bestsellers/',
    ],
    spaDelayMs: 3000,
  },
};
