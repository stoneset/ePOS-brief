'use strict';
// Courbe de maree de la journee, dessinee en image noir et blanc pour l'imprimante.
const { Bitmap } = require('./bitmap');

const DOTS_PER_COL = 12; // police A de la TM-T88V : 12 points de large par caractere

// Interpolation de Catmull-Rom entre les valeurs horaires (courbe lisse passant par les points)
function smooth(values, hour) {
  const i = Math.floor(hour);
  const t = hour - i;
  const p = (k) => values[Math.max(0, Math.min(values.length - 1, k))];
  const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

// curve : 25 hauteurs horaires (0 h a 24 h) ; extremes : [{ type: 'PM'|'BM', hour, height }]
function drawTide(curve, extremes, cols) {
  const W = cols * DOTS_PER_COL;
  const H = 96;
  const top = 10;
  const bottom = 80; // en dessous : graduation horaire
  const bmp = new Bitmap(W, H);
  const all = curve.concat(extremes.map((e) => e.height));
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const x = (hour) => (hour / 24) * (W - 1);
  const y = (h) => bottom - ((h - lo) / span) * (bottom - top);

  // niveau moyen de la mer (0 m) en pointilles
  if (lo < 0 && hi > 0) bmp.dashedH(Math.round(y(0)));

  // la courbe, en trait de 3 points
  let prev = null;
  for (let s = 0; s <= 24 * 20; s++) {
    const hour = s / 20;
    const pt = [x(hour), y(smooth(curve, hour))];
    if (prev) bmp.line(prev[0], prev[1], pt[0], pt[1], 1.3);
    prev = pt;
  }

  // pleines mers : points pleins ; basses mers : ronds vides
  for (const e of extremes) {
    if (e.type === 'PM') bmp.disc(x(e.hour), y(e.height), 5);
    else bmp.ring(x(e.hour), y(e.height), 5.5, 2);
  }

  // graduation : grands traits toutes les 6 h, petits toutes les 3 h
  for (let hour = 0; hour <= 24; hour += 3) {
    const len = hour % 6 === 0 ? 8 : 4;
    const px = Math.min(W - 2, Math.max(1, Math.round(x(hour))));
    for (let dy = 0; dy < len; dy++) { bmp.set(px, H - 1 - dy); bmp.set(px - 1, H - 1 - dy); }
  }
  return bmp.toImage();
}

// Ligne de texte sous la courbe : 0h, 6h, 12h, 18h, 24h alignes sur les traits
function hourAxis(cols) {
  const chars = new Array(cols).fill(' ');
  for (const hour of [0, 6, 12, 18, 24]) {
    const label = `${hour}h`;
    let pos = Math.round((hour / 24) * cols);
    if (hour === 24) pos = cols - label.length;
    else if (hour > 0) pos -= Math.floor(label.length / 2);
    for (let i = 0; i < label.length; i++) if (pos + i >= 0 && pos + i < cols) chars[pos + i] = label[i];
  }
  return chars.join('').replace(/\s+$/, '');
}

module.exports = { drawTide, hourAxis, smooth };
