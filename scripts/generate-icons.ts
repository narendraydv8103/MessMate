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

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const lenSq = bax * bax + bay * bay;
  if (lenSq === 0) return Math.hypot(pax, pay);
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / lenSq));
  const dx = pax - bax * h;
  const dy = pay - bay * h;
  return Math.hypot(dx, dy);
}

function distToRoundedBox(px: number, py: number, bx: number, by: number, r: number): number {
  const qx = Math.abs(px) - bx + r;
  const qy = Math.abs(py) - by + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

function generatePng(width: number, height: number, isMaskable: boolean = false): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdrChunk = createChunk('IHDR', ihdrData);

  const rowLength = 1 + width * 4;
  const rawData = Buffer.alloc(rowLength * height);

  const cx = width / 2;
  const cy = height / 2;

  // Blue color: #1D4ED8 (29, 78, 216)
  const blueR = 29;
  const blueG = 78;
  const blueB = 216;

  // Rounded square box parameters
  const boxHalf = isMaskable ? width * 0.5 : width * 0.44;
  const cornerRadius = isMaskable ? 0 : width * 0.20;

  // White "M" mark definition
  const markScale = (isMaskable ? 0.72 : 0.88) * (width / 192);
  const strokeRadius = 9 * markScale;

  // Keypoints of the "M" centered around (cx, cy)
  const mHalfWidth = 44 * markScale;
  const mTopY = cy - 38 * markScale;
  const mBottomY = cy + 40 * markScale;
  const mCenterY = cy + 2 * markScale;

  const p1x = cx - mHalfWidth;
  const p1y = mBottomY;

  const p2x = cx - mHalfWidth;
  const p2y = mTopY;

  const p3x = cx;
  const p3y = mCenterY;

  const p4x = cx + mHalfWidth;
  const p4y = mTopY;

  const p5x = cx + mHalfWidth;
  const p5y = mBottomY;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowLength;
    rawData[rowOffset] = 0; // Filter byte

    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      const relX = x - cx;
      const relY = y - cy;

      const dBox = isMaskable ? -1 : distToRoundedBox(relX, relY, boxHalf, boxHalf, cornerRadius);

      if (dBox > 0.5) {
        // Outside the rounded square -> transparent
        rawData[pxOffset] = 0;
        rawData[pxOffset + 1] = 0;
        rawData[pxOffset + 2] = 0;
        rawData[pxOffset + 3] = 0;
        continue;
      }

      // Check distance to "M" mark
      const d1 = distToSegment(x, y, p1x, p1y, p2x, p2y);
      const d2 = distToSegment(x, y, p2x, p2y, p3x, p3y);
      const d3 = distToSegment(x, y, p3x, p3y, p4x, p4y);
      const d4 = distToSegment(x, y, p4x, p4y, p5x, p5y);
      const dMark = Math.min(d1, d2, d3, d4);

      let r = blueR;
      let g = blueG;
      let b = blueB;
      let a = 255;

      if (!isMaskable && dBox > -0.5) {
        // Edge anti-aliasing for box
        const edgeAlpha = Math.max(0, Math.min(1, 0.5 - dBox));
        a = Math.round(edgeAlpha * 255);
      }

      if (dMark <= strokeRadius) {
        // Inside white mark
        r = 255;
        g = 255;
        b = 255;
      } else if (dMark < strokeRadius + 1.0) {
        // Anti-aliasing between white mark and blue background
        const t = dMark - strokeRadius;
        r = Math.round(255 * (1 - t) + blueR * t);
        g = Math.round(255 * (1 - t) + blueG * t);
        b = Math.round(255 * (1 - t) + blueB * t);
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

// Also generate clean SVG versions matching the blue rounded-square + white mark design
function generateSvg(size: number, isMaskable: boolean = false): string {
  const rx = isMaskable ? 0 : Math.round(size * 0.22);
  const strokeW = Math.round(18 * (size / 192));
  const cx = size / 2;
  const cy = size / 2;
  const markScale = (isMaskable ? 0.72 : 0.88) * (size / 192);
  const mHalfWidth = 44 * markScale;
  const mTopY = cy - 38 * markScale;
  const mBottomY = cy + 40 * markScale;
  const mCenterY = cy + 2 * markScale;

  const p1x = Math.round(cx - mHalfWidth);
  const p1y = Math.round(mBottomY);
  const p2y = Math.round(mTopY);
  const p3x = Math.round(cx);
  const p3y = Math.round(mCenterY);
  const p4x = Math.round(cx + mHalfWidth);

  const d = `M${p1x} ${p1y} V${p2y} L${p3x} ${p3y} L${p4x} ${p2y} V${p1y}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${rx}" fill="#1D4ED8"/>
  <path d="${d}" fill="none" stroke="#FFFFFF" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
}

fs.writeFileSync(path.join(iconsDir, 'icon-192.svg'), generateSvg(192, false));
fs.writeFileSync(path.join(iconsDir, 'icon-512.svg'), generateSvg(512, false));
fs.writeFileSync(path.join(iconsDir, 'apple-touch-icon.svg'), generateSvg(180, false));
fs.writeFileSync(path.join(iconsDir, 'icon-maskable.svg'), generateSvg(512, true));

console.log('Successfully regenerated all icons with blue rounded-square and white mark!');
