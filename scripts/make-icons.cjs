const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const output = path.join(__dirname, '..', 'assets');
fs.mkdirSync(output, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const label = Buffer.from(type);
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  label.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([label, data])), 8 + data.length);
  return result;
}

function insideRoundedSquare(x, y) {
  const dx = Math.max(Math.abs(x - .5) - .30, 0);
  const dy = Math.max(Math.abs(y - .5) - .30, 0);
  return Math.hypot(dx, dy) < .14;
}

function insideNote(x, y) {
  const stem = x >= .57 && x <= .65 && y >= .23 && y <= .69;
  const head = ((x - .48) / .15) ** 2 + ((y - .68) / .105) ** 2 <= 1;
  const flag = x >= .64 && x <= .78 && y >= .23 + (x - .64) * .45 && y <= .33 + (x - .64) * .52;
  return stem || head || flag;
}

function pixel(size, column, row) {
  let alpha = 0, white = 0;
  const samples = size < 64 ? 4 : 2;
  for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
    const x = (column + (sx + .5) / samples) / size;
    const y = (row + (sy + .5) / samples) / size;
    if (insideRoundedSquare(x, y)) {
      alpha++;
      if (insideNote(x, y)) white++;
    }
  }
  const coverage = alpha / (samples * samples);
  const ink = alpha ? white / alpha : 0;
  return [Math.round(233 + 22 * ink), Math.round(156 + 99 * ink), Math.round(192 + 63 * ink), Math.round(255 * coverage)];
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    const rgba = pixel(size, x, y);
    for (let i = 0; i < 4; i++) raw[offset + i] = rgba[i];
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const sizes = [16, 32, 48, 256];
const images = sizes.map(png);
fs.writeFileSync(path.join(output, 'tray.png'), images[1]);
const directory = Buffer.alloc(6 + 16 * sizes.length);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
images.forEach((image, index) => {
  const entry = 6 + 16 * index;
  directory[entry] = sizes[index] === 256 ? 0 : sizes[index];
  directory[entry + 1] = sizes[index] === 256 ? 0 : sizes[index];
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(image.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += image.length;
});
fs.writeFileSync(path.join(output, 'app.ico'), Buffer.concat([directory, ...images]));
