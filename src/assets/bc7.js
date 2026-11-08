// src/assets/bc7.js
//
// Décodeur BC7 (BPTC) vers RGBA 8 bits, d'après la spécification Khronos
// (KHR_texture_compression_bptc / Data Format Specification, section BC7).
//
// Depuis la v1973, le jeu ne sert plus ses atlas en Basis : chaque format de
// carte graphique a son manifest (manifest.bc7.json, …) et ses KTX2 déjà
// prêts pour le GPU. BC7 est la variante qui a une image pleine taille pour
// chaque atlas, et que le transcodeur Basis ne sait pas lire.

// Partitions à deux sous-ensembles : sous-ensemble de chaque texel (ordre ligne).
const P2 = [
  "0011001100110011", "0001000100010001", "0111011101110111", "0001001100110111",
  "0000000100010011", "0011011101111111", "0001001101111111", "0000000100110111",
  "0000000000010011", "0011011111111111", "0000000101111111", "0000000000010111",
  "0001011111111111", "0000000011111111", "0000111111111111", "0000000000001111",
  "0000100011101111", "0111000100000000", "0000000010001110", "0111001100010000",
  "0011000100000000", "0000100011001110", "0000000010001100", "0111001100110001",
  "0011000100010000", "0000100010001100", "0110011001100110", "0011011001101100",
  "0001011111101000", "0000111111110000", "0111000110001110", "0011100110011100",
  "0101010101010101", "0000111100001111", "0101101001011010", "0011001111001100",
  "0011110000111100", "0101010110101010", "0110100101101001", "0101101010100101",
  "0111001111001110", "0001001111001000", "0011001001001100", "0011101111011100",
  "0110100110010110", "0011110011000011", "0110011010011001", "0000011001100000",
  "0100111001000000", "0010011100100000", "0000001001110010", "0000010011100100",
  "0110110010010011", "0011011011001001", "0110001110011100", "0011100111000110",
  "0110110011001001", "0110001100111001", "0111111010000001", "0001100011100111",
  "0000111100110011", "0011001111110000", "0010001011101110", "0100010001110111",
].map((s) => Uint8Array.from(s, Number));

// Partitions à trois sous-ensembles.
const P3 = [
  "0011001102212222", "0001001122112221", "0000200122112211", "0222002200110111",
  "0000000011221122", "0011001100220022", "0022002211111111", "0011001122112211",
  "0000000011112222", "0000111111112222", "0000111122222222", "0012001200120012",
  "0112011201120112", "0122012201220122", "0011011211221222", "0011200122002220",
  "0001001101121122", "0111001120012200", "0000112211221122", "0022002200221111",
  "0111011102220222", "0001000122212221", "0000001101220122", "0000110022102210",
  "0122012200110000", "0012001211222222", "0110122112210110", "0000011012211221",
  "0022110211020022", "0110011020022222", "0011012201220011", "0000200022112221",
  "0000000211221222", "0222002200120011", "0011001200220222", "0120012001200120",
  "0000111122220000", "0120120120120120", "0120201212010120", "0011220011220011",
  "0011112222000011", "0101010122222222", "0000000021212121", "0022112200221122",
  "0022001100220011", "0220122102201221", "0101222222220101", "0000212121212121",
  "0101010101012222", "0222011102220111", "0002111200021112", "0000211221122112",
  "0222011101110222", "0002111211120002", "0110011001102222", "0000000021122112",
  "0110011022222222", "0022001100110022", "0022112211220022", "0000000000002112",
  "0002000100020001", "0222122202221222", "0101222222222222", "0111201122012220",
].map((s) => Uint8Array.from(s, Number));

// Texel « ancre » (index stocké avec un bit de moins) de chaque sous-ensemble
// autre que le premier, dont l'ancre est toujours le texel 0.
const ANCHOR_2_1 = [
  15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15,
  15, 2, 8, 2, 2, 8, 8, 15, 2, 8, 2, 2, 8, 8, 2, 2,
  15, 15, 6, 8, 2, 8, 15, 15, 2, 8, 2, 2, 2, 15, 15, 6,
  6, 2, 6, 8, 15, 15, 2, 2, 15, 15, 15, 15, 15, 2, 2, 15,
];
const ANCHOR_3_1 = [
  3, 3, 15, 15, 8, 3, 15, 15, 8, 8, 6, 6, 6, 5, 3, 3,
  3, 3, 8, 15, 3, 3, 6, 10, 5, 8, 8, 6, 8, 5, 15, 15,
  8, 15, 3, 5, 6, 10, 8, 15, 15, 3, 15, 5, 15, 15, 15, 15,
  3, 15, 5, 5, 5, 8, 5, 10, 5, 10, 8, 13, 15, 12, 3, 3,
];
const ANCHOR_3_2 = [
  15, 8, 8, 3, 15, 15, 3, 8, 15, 15, 15, 15, 15, 15, 15, 8,
  15, 8, 15, 3, 15, 8, 15, 8, 3, 15, 6, 10, 15, 15, 10, 8,
  15, 3, 15, 10, 10, 8, 9, 10, 6, 15, 8, 15, 3, 6, 6, 8,
  15, 3, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 3, 15, 15, 8,
];

const WEIGHTS = {
  2: [0, 21, 43, 64],
  3: [0, 9, 18, 27, 37, 46, 55, 64],
  4: [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64],
};

// ns: sous-ensembles, pb: bits de partition, rb: bits de rotation,
// isb: bit de sélection d'index, cb/ab: bits par composante couleur/alpha,
// epb: p-bit par extrémité, spb: p-bit partagé par sous-ensemble,
// ib/ib2: bits par index primaire/secondaire.
const MODES = [
  { ns: 3, pb: 4, rb: 0, isb: 0, cb: 4, ab: 0, epb: 1, spb: 0, ib: 3, ib2: 0 },
  { ns: 2, pb: 6, rb: 0, isb: 0, cb: 6, ab: 0, epb: 0, spb: 1, ib: 3, ib2: 0 },
  { ns: 3, pb: 6, rb: 0, isb: 0, cb: 5, ab: 0, epb: 0, spb: 0, ib: 2, ib2: 0 },
  { ns: 2, pb: 6, rb: 0, isb: 0, cb: 7, ab: 0, epb: 1, spb: 0, ib: 2, ib2: 0 },
  { ns: 1, pb: 0, rb: 2, isb: 1, cb: 5, ab: 6, epb: 0, spb: 0, ib: 2, ib2: 3 },
  { ns: 1, pb: 0, rb: 2, isb: 0, cb: 7, ab: 8, epb: 0, spb: 0, ib: 2, ib2: 2 },
  { ns: 1, pb: 0, rb: 0, isb: 0, cb: 7, ab: 7, epb: 1, spb: 0, ib: 4, ib2: 0 },
  { ns: 2, pb: 6, rb: 0, isb: 0, cb: 5, ab: 5, epb: 1, spb: 0, ib: 2, ib2: 0 },
];

const ZERO_PARTITION = new Uint8Array(16);

// Masque 16 bits des texels ancres, par nombre de sous-ensembles et partition.
const ANCHOR_MASKS = {
  1: [1],
  2: ANCHOR_2_1.map((a) => 1 | (1 << a)),
  3: ANCHOR_3_1.map((a, p) => 1 | (1 << a) | (1 << ANCHOR_3_2[p])),
};

// Tampons réutilisés d'un bloc à l'autre (le décodage est synchrone).
const EP = new Int32Array(6 * 4); // 6 extrémités au plus, RGBA
const PBITS = new Uint8Array(6);
const IDX = new Uint8Array(16);
const IDX2 = new Uint8Array(16);
const WORDS = new Uint32Array(4); // le bloc, 4 mots petit-boutistes, bit 0 en premier

function expand(v, bits) {
  v <<= 8 - bits;
  return v | (v >> bits);
}

function interpolate(e0, e1, weight) {
  return ((64 - weight) * e0 + weight * e1 + 32) >> 6;
}

/**
 * Décode un bloc BC7 de 16 octets (`src` à `offset`) en 16 texels RGBA
 * écrits dans `out` (64 octets, ordre ligne).
 */
function decodeBlock(src, offset, out) {
  // 128 bits lus comme 4 mots de 32 bits petit-boutistes, bit 0 en premier.
  const w = WORDS;
  for (let i = 0; i < 4; i++) {
    const o = offset + i * 4;
    w[i] = src[o] | (src[o + 1] << 8) | (src[o + 2] << 16) | (src[o + 3] << 24);
  }
  let pos = 0;
  const bits = (n) => {
    if (n === 0) return 0;
    const i = pos >>> 5;
    const s = pos & 31;
    let v = w[i] >>> s;
    if (s + n > 32) v |= w[i + 1] << (32 - s);
    pos += n;
    return v & ((1 << n) - 1);
  };

  let mode = 0;
  while (mode < 8 && bits(1) === 0) mode++;
  if (mode === 8) {
    // Mode réservé : la spécification impose des texels noirs transparents.
    out.fill(0);
    return;
  }

  const m = MODES[mode];
  const partition = bits(m.pb);
  const rotation = bits(m.rb);
  const indexSelection = bits(m.isb);

  const ne = m.ns * 2; // extrémités
  const ep = EP;
  for (let c = 0; c < 3; c++) for (let e = 0; e < ne; e++) ep[e * 4 + c] = bits(m.cb);
  for (let e = 0; e < ne; e++) ep[e * 4 + 3] = m.ab ? bits(m.ab) : 255;

  let cb = m.cb;
  let ab = m.ab;
  if (m.epb || m.spb) {
    if (m.epb) for (let e = 0; e < ne; e++) PBITS[e] = bits(1);
    else for (let s = 0; s < m.ns; s++) PBITS[2 * s] = PBITS[2 * s + 1] = bits(1);
    for (let e = 0; e < ne; e++) {
      for (let c = 0; c < 3; c++) ep[e * 4 + c] = (ep[e * 4 + c] << 1) | PBITS[e];
      if (m.ab) ep[e * 4 + 3] = (ep[e * 4 + 3] << 1) | PBITS[e];
    }
    cb++;
    if (ab) ab++;
  }
  for (let e = 0; e < ne; e++) {
    for (let c = 0; c < 3; c++) ep[e * 4 + c] = expand(ep[e * 4 + c], cb);
    if (ab) ep[e * 4 + 3] = expand(ep[e * 4 + 3], ab);
  }

  const subsets = m.ns === 2 ? P2[partition] : m.ns === 3 ? P3[partition] : ZERO_PARTITION;
  const anchorMask = ANCHOR_MASKS[m.ns][m.ns === 1 ? 0 : partition];

  const idx = IDX;
  for (let t = 0; t < 16; t++) idx[t] = bits((anchorMask >> t) & 1 ? m.ib - 1 : m.ib);

  let idx2 = null;
  if (m.ib2) {
    idx2 = IDX2;
    for (let t = 0; t < 16; t++) idx2[t] = bits(t === 0 ? m.ib2 - 1 : m.ib2);
  }

  // Modes 4 et 5 : la couleur et l'alpha ont chacun leurs index ; en mode 4,
  // le bit de sélection échange les deux jeux.
  let colorIdx = idx, colorBits = m.ib, alphaIdx = idx, alphaBits = m.ib;
  if (idx2) {
    if (indexSelection) {
      colorIdx = idx2; colorBits = m.ib2;
    } else {
      alphaIdx = idx2; alphaBits = m.ib2;
    }
  }
  const cw = WEIGHTS[colorBits];
  const aw = WEIGHTS[alphaBits];

  for (let t = 0; t < 16; t++) {
    const e0 = subsets[t] * 8; // extrémité 2s, en RGBA
    const e1 = e0 + 4;
    const wc = cw[colorIdx[t]];
    const wa = aw[alphaIdx[t]];
    let r = interpolate(ep[e0], ep[e1], wc);
    let g = interpolate(ep[e0 + 1], ep[e1 + 1], wc);
    let b = interpolate(ep[e0 + 2], ep[e1 + 2], wc);
    let a = interpolate(ep[e0 + 3], ep[e1 + 3], wa);
    if (rotation === 1) [r, a] = [a, r];
    else if (rotation === 2) [g, a] = [a, g];
    else if (rotation === 3) [b, a] = [a, b];
    const o = t * 4;
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
  }
}

/**
 * Décode une image BC7 (blocs 4x4 en ordre ligne) en RGBA 8 bits.
 *
 * @param {Uint8Array} data - Les blocs, 16 octets chacun
 * @param {number} width
 * @param {number} height
 * @returns {Buffer} width * height * 4 octets
 */
export function decodeBC7(data, width, height) {
  const bw = Math.ceil(width / 4);
  const bh = Math.ceil(height / 4);
  if (data.length < bw * bh * 16) {
    throw new Error(`BC7 data too short: ${data.length} bytes for ${width}x${height}`);
  }

  const rgba = Buffer.alloc(width * height * 4);
  const block = new Uint8Array(64);

  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      decodeBlock(data, (by * bw + bx) * 16, block);
      for (let y = 0; y < 4; y++) {
        const py = by * 4 + y;
        if (py >= height) break;
        for (let x = 0; x < 4; x++) {
          const px = bx * 4 + x;
          if (px >= width) break;
          const o = (py * width + px) * 4;
          const i = (y * 4 + x) * 4;
          rgba[o] = block[i]; rgba[o + 1] = block[i + 1]; rgba[o + 2] = block[i + 2]; rgba[o + 3] = block[i + 3];
        }
      }
    }
  }

  return rgba;
}
