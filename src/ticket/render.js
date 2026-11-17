'use strict';
// Rendus "ecran" du ticket : HTML pour l'apercu, texte brut pour le debug et les tests.

const { imageToPng } = require('./bitmap');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toHtml(lines, cols) {
  const rows = lines.map((l) => {
    if (l.image) {
      const src = `data:image/png;base64,${imageToPng(l.image).toString('base64')}`;
      // 12 points par colonne de texte : l'image garde la meme echelle que le texte
      return `<div class="tl timg"><img alt="courbe" src="${src}" style="width:calc(${l.image.width / 12} * 1ch)"></div>`;
    }
    const cls = ['tl'];
    if (l.align === 'center') cls.push('tc');
    if (l.size !== 'normal') cls.push(l.size);
    const spans = l.spans.map((s) => {
      const c = [s.bold ? 'tb' : '', s.invert ? 'ti' : ''].filter(Boolean).join(' ');
      return c ? `<span class="${c}">${esc(s.text)}</span>` : esc(s.text);
    }).join('');
    return `<div class="${cls.join(' ')}">${spans || ' '}</div>`;
  });
  return `<div class="ticket" style="--cols:${Number(cols)}">${rows.join('')}</div>`;
}

function toText(lines, cols) {
  return lines.map((l) => {
    if (l.image) return `[image ${l.image.width}x${l.image.height}]`;
    const text = l.spans.map((s) => s.text).join('');
    const width = l.size === 'normal' ? cols : Math.floor(cols / 2);
    const padded = l.align === 'center' ? ' '.repeat(Math.max(0, Math.floor((width - text.length) / 2))) + text : text;
    return l.size === 'normal' ? padded : padded.split('').join(' '); // caracteres espaces = double largeur
  }).join('\n');
}

// Longueur de papier estimee en cm (TM-T88V : 30 points par ligne a 180 dpi, soit 4,23 mm)
function lengthCm(lines) {
  const mm = lines.reduce((sum, l) => sum + (l.image ? (l.image.height / 180) * 25.4 : l.size === 'big' ? 8.47 : 4.23), 0) + 15; // + marge de coupe
  return Math.round(mm / 10);
}

module.exports = { toHtml, toText, lengthCm };
