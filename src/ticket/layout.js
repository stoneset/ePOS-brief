'use strict';
// Briques de mise en page. Un ticket est une liste de lignes :
//   { spans: [{ text, bold, invert }], align: 'left'|'center', size: 'normal'|'wide'|'big' }
// 'wide' = double largeur, 'big' = double largeur + double hauteur (donc moitie moins de colonnes).
// Cette representation alimente a la fois l'apercu HTML et l'encodeur ESC/POS.
const iconv = require('iconv-lite');

const encodable = new Map();
function canEncode(ch) {
  if (!encodable.has(ch)) {
    encodable.set(ch, iconv.decode(iconv.encode(ch, 'win1252'), 'win1252') === ch && ch !== '?');
  }
  return encodable.get(ch);
}

// Ne garde que ce que l'imprimante sait imprimer (page de codes WPC1252)
function cleanKeep(input) {
  const s = String(input ?? '')
    .normalize('NFC')
    .replace(/[\u2192\u279C\u27A1\u2794]/g, '->')
    .replace(/\u2190/g, '<-')
    .replace(/[\u00A0\u202F\u2009\u2007]/g, ' ')
    .replace(/[\r\n\t\u2028\u2029]+/g, ' ');
  let out = '';
  for (const ch of s) {
    if (ch.length > 1) continue; // emojis et autres caracteres hors plan de base
    const code = ch.charCodeAt(0);
    if (code < 32 || code === 127) continue;
    if (code < 127 || canEncode(ch)) out += ch;
  }
  return out;
}

const clean = (input) => cleanKeep(input).replace(/ {2,}/g, ' ').trim();

function wrap(text, width) {
  const words = clean(text).split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  for (let w of words) {
    while (w.length > width) {
      if (cur) { lines.push(cur); cur = ''; }
      lines.push(w.slice(0, width));
      w = w.slice(width);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

// Coupe a maxLines lignes, avec "..." si le texte est tronque
function wrapMax(text, width, maxLines) {
  const lines = wrap(text, width);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1];
  kept[maxLines - 1] = (last.length > width - 3 ? last.slice(0, width - 3) : last) + '...';
  return kept;
}

const L = (text, o = {}) => ({
  spans: [{ text: String(text), bold: !!o.bold, invert: !!o.invert }],
  align: o.align || 'left',
  size: o.size || 'normal',
});
const blank = () => L('');
const rule = (cols, ch = '-') => L(ch.repeat(cols));

// "gauche ......... droite" sur une ligne
function kv(left, right, cols, o = {}) {
  left = clean(left); right = clean(right);
  const room = cols - right.length - 1;
  if (left.length > room) left = left.slice(0, Math.max(0, room - 1)) + '.';
  return L(left + ' '.repeat(Math.max(1, cols - left.length - right.length)) + right, o);
}

// Element de liste avec retrait : "[ ] texte" puis lignes suivantes alignees sous le texte
function item(prefix, text, cols, o = {}) {
  const width = cols - prefix.length;
  return wrapMax(text, width, o.maxLines || 2).map((t, i) => L((i === 0 ? prefix : ' '.repeat(prefix.length)) + t, o));
}

const section = (title) => [blank(), { spans: [{ text: ` ${clean(title)} `, bold: true, invert: true }], align: 'left', size: 'normal' }];

// Encadre ASCII. rows = [{ text, bold }]
function frame(rows, cols, { h = '-', v = '|', c = '+' } = {}) {
  const inner = cols - 4;
  const edge = L(c + h.repeat(cols - 2) + c);
  const body = rows.map((r) => ({
    spans: [
      { text: v + ' ', bold: false, invert: false },
      { text: clean(r.text).slice(0, inner).padEnd(inner), bold: !!r.bold, invert: false },
      { text: ' ' + v, bold: false, invert: false },
    ],
    align: 'left',
    size: 'normal',
  }));
  return [edge, ...body, edge];
}

module.exports = { clean, cleanKeep, wrap, wrapMax, L, blank, rule, kv, item, section, frame };
