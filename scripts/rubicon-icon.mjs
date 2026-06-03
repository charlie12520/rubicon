import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const DEFAULT_ICON_SIZES = [16, 32, 48, 64];
const LIGHTNING_POINTS = [
  [25.9, 44.9],
  [23.9, 44.2],
  [23.9, 33.9],
  [21.7, 31.7],
  [10.3, 31.7],
  [9.4, 29.9],
  [16.8, 19.4],
  [15, 15.8],
  [1.2, 15.8],
  [0.3, 14.1],
  [10, 0.5],
  [10.9, 0],
  [39.8, 0],
  [40.7, 1.8],
  [33.3, 12.3],
  [35.1, 15.8],
  [46.5, 15.8],
  [47.4, 17.7],
  [25.9, 44.9],
];

export function ensureRubiconIcon(iconPath, sizes = DEFAULT_ICON_SIZES) {
  const icon = createRubiconIco(sizes);
  fs.mkdirSync(path.dirname(iconPath), { recursive: true });
  if (fs.existsSync(iconPath)) {
    const current = fs.readFileSync(iconPath);
    if (current.equals(icon)) {
      return iconPath;
    }
  }
  fs.writeFileSync(iconPath, icon);
  return iconPath;
}

export function ensureRubiconPng(iconPath, size) {
  const icon = createRubiconPng(size);
  fs.mkdirSync(path.dirname(iconPath), { recursive: true });
  if (fs.existsSync(iconPath)) {
    const current = fs.readFileSync(iconPath);
    if (current.equals(icon)) {
      return iconPath;
    }
  }
  fs.writeFileSync(iconPath, icon);
  return iconPath;
}

export function createRubiconIco(sizes = DEFAULT_ICON_SIZES) {
  const images = sizes.map((size) => createDibImage(size));
  const headerSize = 6 + images.length * 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = headerSize;
  images.forEach((image, index) => {
    const entryOffset = 6 + index * 16;
    header.writeUInt8(image.size >= 256 ? 0 : image.size, entryOffset);
    header.writeUInt8(image.size >= 256 ? 0 : image.size, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2);
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(image.data.length, entryOffset + 8);
    header.writeUInt32LE(offset, entryOffset + 12);
    offset += image.data.length;
  });

  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

export function createRubiconPng(size) {
  const rgba = renderRubiconIcon(size);
  const scanlines = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    scanlines[rowStart] = 0;
    for (let x = 0; x < size; x += 1) {
      const source = (y * size + x) * 4;
      const target = rowStart + 1 + x * 4;
      scanlines[target] = rgba[source];
      scanlines[target + 1] = rgba[source + 1];
      scanlines[target + 2] = rgba[source + 2];
      scanlines[target + 3] = rgba[source + 3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    createPngChunk("IHDR", ihdr),
    createPngChunk("IDAT", zlib.deflateSync(scanlines)),
    createPngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function createDibImage(size) {
  const rgba = renderRubiconIcon(size);
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(size * size * 4, 20);
  header.writeInt32LE(0, 24);
  header.writeInt32LE(0, 28);
  header.writeUInt32LE(0, 32);
  header.writeUInt32LE(0, 36);

  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const sourceY = size - 1 - y;
    for (let x = 0; x < size; x += 1) {
      const source = (sourceY * size + x) * 4;
      const target = (y * size + x) * 4;
      xor[target] = rgba[source + 2];
      xor[target + 1] = rgba[source + 1];
      xor[target + 2] = rgba[source];
      xor[target + 3] = rgba[source + 3];
    }
  }

  const maskStride = Math.ceil(size / 32) * 4;
  const andMask = Buffer.alloc(maskStride * size);
  return { data: Buffer.concat([header, xor, andMask]), size };
}

function renderRubiconIcon(size) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const radius = size * 0.22;
  const inset = size * 0.04;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      if (insideRoundedRect(x + 0.5, y + 0.5, inset, inset, size - inset * 2, size - inset * 2, radius)) {
        const shade = Math.round(9 + (1 - y / size) * 10);
        pixels[index] = shade;
        pixels[index + 1] = Math.round(8 + (x / size) * 8);
        pixels[index + 2] = Math.round(18 + (1 - x / size) * 14);
        pixels[index + 3] = 255;
      }
    }
  }

  const scale = Math.min((size * 0.74) / 48, (size * 0.78) / 46);
  const offsetX = (size - 48 * scale) / 2;
  const offsetY = (size - 46 * scale) / 2;
  const polygon = LIGHTNING_POINTS.map(([x, y]) => [offsetX + x * scale, offsetY + y * scale]);
  const outlinePolygon = LIGHTNING_POINTS.map(([x, y]) => [
    size / 2 + (offsetX + x * scale - size / 2) * 1.08,
    size / 2 + (offsetY + y * scale - size / 2) * 1.08,
  ]);

  paintPolygon(pixels, size, outlinePolygon, (x, y) => [237, 230, 255, Math.round(160 + (1 - y / size) * 80)]);
  paintPolygon(pixels, size, polygon, (x, y) => {
    const mix = Math.max(0, Math.min(1, x / size * 0.65 + (1 - y / size) * 0.35));
    return [
      Math.round(126 + mix * 10),
      Math.round(20 + mix * 170),
      Math.round(255 - mix * 10),
      255,
    ];
  });

  return pixels;
}

function paintPolygon(pixels, size, polygon, colorForPixel) {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!pointInPolygon(x + 0.5, y + 0.5, polygon)) {
        continue;
      }
      const [red, green, blue, alpha] = colorForPixel(x, y);
      const index = (y * size + x) * 4;
      const sourceAlpha = alpha / 255;
      const targetAlpha = pixels[index + 3] / 255;
      const outAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
      if (outAlpha === 0) {
        continue;
      }
      pixels[index] = Math.round((red * sourceAlpha + pixels[index] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
      pixels[index + 1] = Math.round((green * sourceAlpha + pixels[index + 1] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
      pixels[index + 2] = Math.round((blue * sourceAlpha + pixels[index + 2] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
      pixels[index + 3] = Math.round(outAlpha * 255);
    }
  }
}

function insideRoundedRect(x, y, rectX, rectY, width, height, radius) {
  const clampedX = Math.max(rectX + radius, Math.min(x, rectX + width - radius));
  const clampedY = Math.max(rectY + radius, Math.min(y, rectY + height - radius));
  return (x - clampedX) ** 2 + (y - clampedY) ** 2 <= radius ** 2;
}

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) {
      inside = !inside;
    }
  }
  return inside;
}

function createPngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(8 + data.length + 4);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
