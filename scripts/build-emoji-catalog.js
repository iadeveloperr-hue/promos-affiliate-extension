/**
 * Gera content/emojiCatalog.js a partir do emojibase-data (PT-BR).
 * Uso: node scripts/build-emoji-catalog.js  (ou: npm run build:emoji)
 *
 * Filtro CONSERVADOR (decisão do projeto): só emojis amplamente suportados —
 * versão Unicode <= 13.1 (~2020), sem sequências ZWJ (combos frágeis em
 * aparelho velho) e sem "components" (tons de pele isolados). Evita o
 * "quadradinho" (tofu) em quem tem WhatsApp/OS desatualizado.
 *
 * Saída: window.PromosEmojiCatalog = [{ e, n, k, g }]  (emoji, nome, keywords, grupo)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const data = require('emojibase-data/pt/data.json');

const MAX_VERSION = 13.1; // corte conservador

const GROUP_LABELS = {
  0: 'Carinhas',
  1: 'Pessoas',
  3: 'Natureza',
  4: 'Comida',
  5: 'Viagem',
  6: 'Atividades',
  7: 'Objetos',
  8: 'Símbolos',
  9: 'Bandeiras',
};

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const out = [];
for (const x of data) {
  if (typeof x.version !== 'number' || x.version <= 0 || x.version > MAX_VERSION) continue;
  if (x.hexcode.includes('200D')) continue;        // ZWJ → combo frágil
  if (x.group === 2) continue;                       // components (tons de pele)
  if (!(x.group in GROUP_LABELS)) continue;          // grupo desconhecido/vazio
  const tags = Array.isArray(x.tags) ? x.tags : [];
  // chaves de busca: nome + tags, sem acento, deduplicadas
  const k = [...new Set([norm(x.label), ...tags.map(norm)].filter(Boolean))].join(' ');
  out.push({ e: x.emoji, n: x.label, k, g: GROUP_LABELS[x.group], o: x.order || 0 });
}

// Ordena por grupo (na ordem de GROUP_LABELS) e depois pela ordem oficial.
const groupOrder = Object.values(GROUP_LABELS);
out.sort((a, b) => {
  const ga = groupOrder.indexOf(a.g), gb = groupOrder.indexOf(b.g);
  return ga !== gb ? ga - gb : a.o - b.o;
});
// Remove o campo de ordenação auxiliar do payload final.
const payload = out.map(({ e, n, k, g }) => ({ e, n, k, g }));

const dest = path.join(__dirname, '..', 'content', 'emojiCatalog.js');
const banner =
  '// GERADO por scripts/build-emoji-catalog.js — NÃO editar à mão.\n' +
  `// Fonte: emojibase-data (PT-BR). Filtro: Unicode <= ${MAX_VERSION}, sem ZWJ/components.\n` +
  `// ${payload.length} emojis amplamente suportados.\n`;
fs.writeFileSync(dest, banner + 'window.PromosEmojiCatalog = ' + JSON.stringify(payload) + ';\n', 'utf8');

console.log(`✅ ${payload.length} emojis → content/emojiCatalog.js`);
