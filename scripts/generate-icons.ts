import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

// Helper to calculate CRC32 for PNG chunks
function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
}

const crcTable = makeCrcTable();

function crc32(buf: Buffer): number {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function createChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crcBuf = Buffer.alloc(4);
  const crcVal = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crcVal, 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function generatePng(width: number, height: number, isMaskable: boolean = false): Buffer {
  // PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdrChunk = createChunk('IHDR', ihdrData);

  // Raw pixel data with filter byte (0) per row
  const rowLength = 1 + width * 4;
  const rawData = Buffer.alloc(rowLength * height);

  const cx = width / 2;
  const cy = height / 2;
  const radius = isMaskable ? width * 0.38 : width * 0.42;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowLength;
    rawData[rowOffset] = 0; // None filter

    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Base background: #0f172a (15, 23, 42)
      let r = 15;
      let g = 23;
      let b = 42;
      const a = 255;

      // Draw outer circle plate (#1e293b / 30, 41, 59)
      if (dist <= radius) {
        r = 30;
        g = 41;
        b = 59;

        // Inner circle
        if (dist <= radius * 0.85) {
          r = 15;
          g = 23;
          b = 42;
        }

        // Green accent bowl at top-left
        const dx1 = x - (cx - radius * 0.25);
        const dy1 = y - (cy - radius * 0.25);
        if (Math.sqrt(dx1 * dx1 + dy1 * dy1) <= radius * 0.28) {
          r = 16;
          g = 185;
          b = 129; // Emerald green
        }

        // Amber accent bowl at top-right
        const dx2 = x - (cx + radius * 0.25);
        const dy2 = y - (cy - radius * 0.1);
        if (Math.sqrt(dx2 * dx2 + dy2 * dy2) <= radius * 0.24) {
          r = 245;
          g = 158;
          b = 11; // Amber
        }

        // Blue accent bowl at bottom
        const dx3 = x - cx;
        const dy3 = y - (cy + radius * 0.3);
        if (Math.sqrt(dx3 * dx3 + dy3 * dy3) <= radius * 0.24) {
          r = 59;
          g = 130;
          b = 246; // Blue
        }
      }

      // Red notification dot on top-right
      const alertDx = x - (cx + radius * 0.7);
      const alertDy = y - (cy - radius * 0.7);
      if (Math.sqrt(alertDx * alertDx + alertDy * alertDy) <= radius * 0.16) {
        r = 239;
        g = 68;
        b = 68; // Red
      }

      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressedData);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const iconsDir = path.resolve(process.cwd(), 'public/icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Generate the 4 PNG icons
fs.writeFileSync(path.join(iconsDir, 'apple-touch-icon.png'), generatePng(180, 180, false));
fs.writeFileSync(path.join(iconsDir, 'icon-192.png'), generatePng(192, 192, false));
fs.writeFileSync(path.join(iconsDir, 'icon-512.png'), generatePng(512, 512, false));
fs.writeFileSync(path.join(iconsDir, 'icon-maskable-512.png'), generatePng(512, 512, true));

console.log('Successfully generated PNG icons in public/icons/');
