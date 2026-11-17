'use strict';
// Encodeur ESC/POS minimal (langage de commande des imprimantes ticket Epson).
// Reference : https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/
const iconv = require('iconv-lite');

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
const SIZE = { normal: 0x00, wide: 0x10, big: 0x11 }; // GS ! n : bits 4-6 largeur, bits 0-2 hauteur
const ALIGN = { left: 0, center: 1, right: 2 };

function encode(lines, { cut = true } = {}) {
  const out = [];
  const push = (...bytes) => out.push(Buffer.from(bytes));
  push(ESC, 0x40); // ESC @ : initialisation
  push(ESC, 0x74, 16); // ESC t 16 : page de codes WPC1252 (accents francais)
  let align = 'left';
  let size = 'normal';
  let bold = false;
  let invert = false;
  for (const l of lines) {
    if (l.image) {
      // GS v 0 : image raster. Largeur en octets (8 points par octet), hauteur en points
      if (align !== 'left') { align = 'left'; push(ESC, 0x61, 0); }
      const img = l.image;
      const data = Buffer.from(img.data, 'base64');
      const bytesPerRow = Math.ceil(img.width / 8);
      for (let y0 = 0; y0 < img.height; y0 += 255) { // par bandes, pour les petites memoires tampon
        const rows = Math.min(255, img.height - y0);
        push(GS, 0x76, 0x30, 0, bytesPerRow & 0xff, bytesPerRow >> 8, rows & 0xff, rows >> 8);
        out.push(data.subarray(y0 * bytesPerRow, (y0 + rows) * bytesPerRow));
      }
      continue;
    }
    if (l.align !== align) { align = l.align; push(ESC, 0x61, ALIGN[align] ?? 0); }
    if (l.size !== size) { size = l.size; push(GS, 0x21, SIZE[size] ?? 0); }
    for (const s of l.spans) {
      if (!s.text) continue;
      if (!!s.bold !== bold) { bold = !!s.bold; push(ESC, 0x45, bold ? 1 : 0); }
      if (!!s.invert !== invert) { invert = !!s.invert; push(GS, 0x42, invert ? 1 : 0); }
      out.push(iconv.encode(s.text, 'win1252'));
    }
    if (invert) { invert = false; push(GS, 0x42, 0); } // pas de fond noir jusqu'au bord droit
    push(LF);
  }
  push(ESC, 0x45, 0, GS, 0x21, 0, ESC, 0x61, 0);
  if (cut) push(GS, 0x56, 66, 0); // GS V 66 0 : avance jusqu'au massicot puis coupe partielle
  else push(ESC, 0x64, 6); // ESC d 6 : avance de 6 lignes pour dechirer a la main
  return Buffer.concat(out);
}

module.exports = { encode };
