// ⚠️ Conferir cada link caractere por caractere. Link errado = post no grupo errado.
export const GROUPS = {
  kate: {
    name: "Promos da Kate",
    // Link próprio (redirect 302 em site/kate/_redirects → convite do grupo).
    footer: "❣️ Promos da Kate: example.com/grupo",
    telegramFooter: "📲 @yourchannel",  // canal Telegram público t.me/yourchannel
    openingEmojiDefault: "🔥",
    amazonTrackingId: "yourtag-20",
    mlChannel: "<canal_kate>",        // cadastrar no painel ML (adiado)
    // Conta do ML que pode gerar link deste grupo (affiliate_tool do link).
    // Vazio = sem trava.
    contas: { mlUserId: "", mlMattTool: "" },
    shopeeSubId: "KateWhatsApp",
  },
  musculosas: {
    name: "Ofertas Musculosas",
    footer: "💪 Ofertas Musculosas: https://chat.whatsapp.com/EXAMPLE_GROUP_INVITE",
    telegramFooter: null,             // sem canal de Telegram ainda
    openingEmojiDefault: "💪",
    amazonTrackingId: "yourtag2-20",
    mlChannel: "<canal_musculosas>",       // cadastrar no painel ML (adiado)
    // Conta do ML que pode gerar link deste grupo (affiliate_tool do link).
    // Vazio = sem trava.
    contas: { mlUserId: "", mlMattTool: "00000000" },
    shopeeSubId: "MusculosasWhatsApp",
  },
  jotape: {
    name: "JOTAPETGC",
    // Layout proprio (ver lib/template.js): chamada fixa, De/Por com X e check,
    // sem negrito/riscado, selo de loja e rodape em duas linhas.
    layout: "jotape",
    chamadaFixa: "QUEM NÃO COMPRAR É MALUCO 😱🔥",
    footer: "JOTAPETGC:\n🔗 https://chat.whatsapp.com/EXAMPLE_GROUP_INVITE",
    telegramFooter: null,
    openingEmojiDefault: "🇧🇷",
    amazonTrackingId: "yourtag2-20",   // TODO: tracking proprio, se o grupo tiver conta
    mlChannel: "<canal_jotape>",
    // Conta do ML que pode gerar link deste grupo (affiliate_tool do link).
    // Vazio = sem trava.
    contas: { mlUserId: "", mlMattTool: "00000000" },
    shopeeSubId: "JotapeWhatsApp",
  },
};

// ML afiliado nível-conta (mesmo nos dois grupos; o link sai do botão Compartilhar): 00000000 (affiliate_tool)
export const AFFILIATE = {
  amazon:       { mode: "sitestripe", shorten: "amzn.to" },
  mercadolivre: { via: "share_button" }, // meli.la
  shopee:       { via: "panel_or_api" },
};

// Valores podem ser string (emoji fixo) ou array (sorteia aleatoriamente a cada post)
export const EMOJI_MAP = {
  beleza:      ["💄", "✨", "🧴", "💅"],
  cabelo:      ["💇", "✂️", "🌟"],
  cozinha:     ["🍳", "👨‍🍳", "🥘", "🫕"],
  casa:        ["🏠", "🛒", "🏡"],
  moda:        ["👗", "👔", "🛍️", "✨"],
  calcados:    ["👟", "👠", "🥿"],
  fitness:     ["💪", "🏋️", "⚡", "🔥", "🏃"],
  suplemento:  ["🥤", "💪", "⚡", "🔥", "🏆"],
  decoracao:   ["🛋️", "🏠", "🪴", "✨"],
  eletronicos: ["📱", "💻", "🎧", "⚡"],
  infantil:    ["🧸", "🎀", "🎠", "👶"],
  pet:         ["🐾", "🐶", "🐱", "🦴"],
  default:     ["🔥", "⚡", "✨", "🎯"],
};

// Emoji por PALAVRA-CHAVE do nome do produto (mais específico que a categoria).
// Ordem importa: o primeiro cujo termo aparecer no nome (sem acento) vence.
// Termos já SEM acento (o nome é normalizado antes da comparação).
export const KEYWORD_EMOJI = [
  // Calçados
  [["tenis", "chuteira"], ["👟", "🏃", "⚡", "🔥"]],
  [["sapatenis", "sapato", "mocassim", "oxford"], "👞"],
  [["sandalia", "rasteira", "papete"], "👡"],
  [["chinelo", "slide"], "🩴"],
  [["bota", "coturno"], "👢"],
  [["salto", "scarpin", "sapatilha"], "👠"],
  // Moda
  [["camiseta", "camisa", "blusa", "regata", "moletom", "casaco", "jaqueta", "polo", "cropped"], "👕"],
  [["vestido"], "👗"],
  [["calca", "jeans", "legging", "short", "bermuda", "calcao"], "👖"],
  [["sutia", "lingerie", "calcinha", "biquini", "maio"], "👙"],
  [["bolsa", "mochila", "carteira", "necessaire"], "👜"],
  [["bone", "chapeu", "touca"], "🧢"],
  [["oculos"], "🕶️"],
  [["meia", "meiao"], "🧦"],
  // Fitness / suplemento
  [["whey", "creatina", "proteina", "bcaa", "glutamina", "suplemento", "pre treino", "pretreino", "malto", "hipercalorico", "termogenico", "albumina", "colageno"], ["💪", "🥤", "⚡", "🏆"]],
  [["halter", "anilha", "kettlebell", "caneleira", "elastico", "corda de pular"], "🏋️"],
  // Beleza
  [["batom", "maquiagem", "base liquida", "rimel", "delineador", "blush", "corretivo", "paleta"], "💄"],
  [["perfume", "colonia"], ["🌸", "✨", "🧴", "💖", "🔥"]],
  [["esmalte"], "💅"],
  [["serum", "hidratante", "protetor solar", "creme facial", "acido", "skincare"], "🧴"],
  // Cabelo
  [["shampoo", "condicionador", "secador", "prancha", "chapinha", "babyliss", "escova alisadora", "mascara capilar"], "💇"],
  // Cozinha
  [["air fryer", "airfryer", "fritadeira", "panela", "liquidificador", "mixer", "batedeira", "cafeteira", "sanduicheira", "forno eletrico", "fogao"], "🍳"],
  [["faca", "cutelo"], "🔪"],
  [["copo", "garrafa", "caneca", "squeeze", "termica"], "🥤"],
  // Casa / decoração
  [["aspirador", "robo aspirador"], "🧹"],
  [["lampada", "luminaria", "abajur"], "💡"],
  [["travesseiro", "fronha"], "🛏️"],
  [["almofada", "cortina", "tapete", "edredom", "lencol", "toalha", "jogo de cama", "manta", "cobertor"], "🛋️"],
  [["organizador", "cesto", "cabide"], "🧺"],
  // Eletrônicos
  [["fone", "headphone", "headset", "earbud", "airpod"], "🎧"],
  [["celular", "smartphone", "iphone", "galaxy", "motorola", "xiaomi"], "📱"],
  [["notebook", "laptop"], "💻"],
  [["smartwatch", "smart watch", "relogio"], "⌚"],
  [["televisao", "smart tv", "monitor"], "📺"],
  [["caixa de som", "soundbar", "jbl", "alto falante"], "🔊"],
  [["carregador", "cabo usb", "powerbank", "power bank"], "🔌"],
  [["teclado", "mouse"], "⌨️"],
  [["camera", "webcam", "gopro"], "📷"],
  [["ventilador", "climatizador", "circulador"], "🌀"],
  // Infantil / pet
  [["brinquedo", "boneca", "lego", "pelucia", "fralda", "bebe", "carrinho de bebe"], "🧸"],
  [["racao", "coleira", "petisco", "arranhador", "aquario"], "🐾"],
];

// ── Fase 2: Radar & Garimpo ───────────────────────────────────────────────────

// Pesos e parâmetros do scoring (lib/scoring.js). Soma dos pesos = 1.
export const SCORING = {
  weights: {
    desconto:  0.30,  // % de desconto (proporcional, não é corte)
    categoria: 0.25,  // conversão histórica da categoria (commissionStats)
    ranking:   0.15,  // produto aparece nos mais-vendidos da plataforma
    ticket:    0.30,  // comissão potencial em R$ (preço × taxa)
  },
  // Desconto que vale score cheio no fator desconto (ex: 60% off → 100 pts)
  descontoFull: 60,
  // Comissão em R$ que vale score cheio no fator ticket (escala saturante)
  ticketFullBRL: 30,
  // Taxa de comissão estimada por marketplace (usada no fator ticket)
  commissionRates: { amazon: 0.10, mercadolivre: 0.06, shopee: 0.10 },
  // Flags: desconto abaixo de minDesconto + score >= minScoreAlto
  minDesconto: 30,
  minScoreAlto: 60,
};

// ── Radar ─────────────────────────────────────────────────────────────────────

export const RADAR = {
  // Horários do disparo automático (chrome.alarms) — hora local
  scheduleHours: [8, 12, 18],
  // Máximo de candidatos enfileirados por grupo a cada rodada
  maxPerRun: { kate: 5, musculosas: 3 },
  // Páginas de ranking que o Radar visita (mais-vendidos + bestsellers)
  sources: [
    'https://www.mercadolivre.com.br/mais-vendidos',
    'https://www.amazon.com.br/bestsellers/',
  ],
  // Tempo extra (ms) para aguardar JS da SPA renderizar após tab carregar
  spaDelayMs: 3000,
};

// Categorias → grupo (classifyGroup). Categoria fora das listas = 'indefinido'.
export const GROUP_CATEGORIES = {
  kate:       ["beleza", "cabelo", "cozinha", "casa", "moda", "calcados", "decoracao", "infantil", "pet"],
  musculosas: ["fitness", "suplemento"],
};
