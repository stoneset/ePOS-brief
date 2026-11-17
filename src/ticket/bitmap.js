'use strict';
// Petite image noir et blanc (1 bit par point) pour les graphiques du ticket.
// Sert a la fois a l'impression (ESC/POS GS v 0) et a l'apercu (PNG).
const zlib = require('zlib');

class Bitmap {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.px = new Uint8Array(width * height); // 1 = noir
  }

  set(x, y, v = 1) {
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) this.px[y * this.width + x] = v;
  }

  disc(cx, cy, r, v = 1) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.set(x, y, v);
      }
    }
  }

  ring(cx, cy, r, thickness) {
    this.disc(cx, cy, r, 1);
    this.disc(cx, cy, r - thickness, 0);
  }

  // Segment epais : disques rapproches le long du segment
  line(x0, y0, x1, y1, r = 1) {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let i = 0; i <= steps; i++) this.disc(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, r);
  }

  dashedH(y, on = 3, off = 5) {
    for (let x = 0; x < this.width; x++) if (x % (on + off) < on) this.set(x, y);
  }

  // Format raster ESC/POS : lignes de points, 8 points par octet, bit de poids fort a gauche
  packed() {
    const bytesPerRow = Math.ceil(this.width / 8);
    const out = Buffer.alloc(bytesPerRow * this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.px[y * this.width + x]) out[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    return out;
  }

  // Objet stockable dans une ligne de ticket (et dans l'historique)
  toImage() {
    return { width: this.width, height: this.height, data: this.packed().toString('base64') };
  }
}

// ---------- PNG 1 bit pour l'apercu ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// image = { width, height, data (base64, 1 = noir) } -> PNG (en PNG gris 1 bit, 1 = blanc)
function imageToPng(image) {
  const src = Buffer.from(image.data, 'base64');
  const bytesPerRow = Math.ceil(image.width / 8);
  const raw = Buffer.alloc((bytesPerRow + 1) * image.height);
  for (let y = 0; y < image.height; y++) {
    raw[y * (bytesPerRow + 1)] = 0; // filtre "None"
    for (let i = 0; i < bytesPerRow; i++) raw[y * (bytesPerRow + 1) + 1 + i] = ~src[y * bytesPerRow + i] & 0xff;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 1; // 1 bit par point
  ihdr[9] = 0; // niveaux de gris
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { Bitmap, imageToPng };
