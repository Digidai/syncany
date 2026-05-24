#!/usr/bin/env node
import { deflateSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = new URL("..", import.meta.url).pathname;
const resourcesDir = join(root, "resources");

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBuf = Buffer.from(type, "ascii");
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuf.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 8 + data.length);
  return out;
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND"),
  ]);
}

function setPixel(rgba, width, x, y, color) {
  const i = (y * width + x) * 4;
  rgba[i] = color[0];
  rgba[i + 1] = color[1];
  rgba[i + 2] = color[2];
  rgba[i + 3] = color[3];
}

function roundedRectMask(x, y, w, h, r) {
  const dx = x < r ? r - x : x >= w - r ? x - (w - r - 1) : 0;
  const dy = y < r ? r - y : y >= h - r ? y - (h - r - 1) : 0;
  return dx * dx + dy * dy <= r * r;
}

function fillRoundedRect(rgba, width, height, x0, y0, w, h, r, color) {
  for (let y = Math.max(0, y0); y < Math.min(height, y0 + h); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(width, x0 + w); x += 1) {
      if (roundedRectMask(x - x0, y - y0, w, h, r)) setPixel(rgba, width, x, y, color);
    }
  }
}

function fillCircle(rgba, width, height, cx, cy, radius, color) {
  const r2 = radius * radius;
  for (let y = Math.max(0, cy - radius); y < Math.min(height, cy + radius); y += 1) {
    for (let x = Math.max(0, cx - radius); x < Math.min(width, cx + radius); x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) setPixel(rgba, width, x, y, color);
    }
  }
}

function fillLine(rgba, width, height, x1, y1, x2, y2, thickness, color) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const r = thickness / 2;
  const r2 = r * r;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
      const px = x1 + t * dx;
      const py = y1 + t * dy;
      const ddx = x - px;
      const ddy = y - py;
      if (ddx * ddx + ddy * ddy <= r2) setPixel(rgba, width, x, y, color);
    }
  }
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const s = size / 1024;
  const bg = [9, 16, 27, 255];
  const panel = [13, 28, 45, 255];
  const cyan = [8, 184, 204, 255];
  const mint = [50, 211, 166, 255];
  fillRoundedRect(rgba, size, size, Math.round(80 * s), Math.round(80 * s), Math.round(864 * s), Math.round(864 * s), Math.round(210 * s), bg);
  fillCircle(rgba, size, size, Math.round(710 * s), Math.round(260 * s), Math.round(180 * s), [20, 90, 115, 180]);
  fillRoundedRect(rgba, size, size, Math.round(158 * s), Math.round(158 * s), Math.round(708 * s), Math.round(708 * s), Math.round(164 * s), panel);
  fillRoundedRect(rgba, size, size, Math.round(300 * s), Math.round(250 * s), Math.round(110 * s), Math.round(520 * s), Math.round(48 * s), cyan);
  fillRoundedRect(rgba, size, size, Math.round(300 * s), Math.round(250 * s), Math.round(330 * s), Math.round(104 * s), Math.round(50 * s), cyan);
  fillRoundedRect(rgba, size, size, Math.round(522 * s), Math.round(300 * s), Math.round(110 * s), Math.round(210 * s), Math.round(50 * s), cyan);
  fillRoundedRect(rgba, size, size, Math.round(300 * s), Math.round(462 * s), Math.round(320 * s), Math.round(100 * s), Math.round(48 * s), mint);
  fillLine(rgba, size, size, Math.round(470 * s), Math.round(548 * s), Math.round(680 * s), Math.round(780 * s), Math.round(112 * s), mint);
  return png(size, size, rgba);
}

function drawTray(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const black = [0, 0, 0, 255];
  const s = size / 32;
  fillRoundedRect(rgba, size, size, Math.round(7 * s), Math.round(5 * s), Math.round(5 * s), Math.round(22 * s), Math.round(2 * s), black);
  fillRoundedRect(rgba, size, size, Math.round(7 * s), Math.round(5 * s), Math.round(14 * s), Math.round(5 * s), Math.round(2 * s), black);
  fillRoundedRect(rgba, size, size, Math.round(17 * s), Math.round(8 * s), Math.round(5 * s), Math.round(8 * s), Math.round(2 * s), black);
  fillRoundedRect(rgba, size, size, Math.round(7 * s), Math.round(14 * s), Math.round(14 * s), Math.round(5 * s), Math.round(2 * s), black);
  fillLine(rgba, size, size, Math.round(15 * s), Math.round(18 * s), Math.round(24 * s), Math.round(27 * s), Math.round(5 * s), black);
  return png(size, size, rgba);
}

function ico(pngData) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = 0;   // 256
  header[7] = 0;   // 256
  header[8] = 0;
  header[9] = 0;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(pngData.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, pngData]);
}

mkdirSync(resourcesDir, { recursive: true });
writeFileSync(join(resourcesDir, "icon.png"), drawIcon(1024));
writeFileSync(join(resourcesDir, "icon.ico"), ico(drawIcon(256)));
writeFileSync(join(resourcesDir, "trayTemplate.png"), drawTray(32));

if (process.platform === "darwin") {
  const iconset = join(tmpdir(), `raltic-icon-${process.pid}.iconset`);
  rmSync(iconset, { recursive: true, force: true });
  mkdirSync(iconset, { recursive: true });
  const sizes = [
    ["icon_16x16.png", 16],
    ["icon_16x16@2x.png", 32],
    ["icon_32x32.png", 32],
    ["icon_32x32@2x.png", 64],
    ["icon_128x128.png", 128],
    ["icon_128x128@2x.png", 256],
    ["icon_256x256.png", 256],
    ["icon_256x256@2x.png", 512],
    ["icon_512x512.png", 512],
    ["icon_512x512@2x.png", 1024],
  ];
  for (const [name, size] of sizes) writeFileSync(join(iconset, name), drawIcon(size));
  execFileSync("iconutil", ["-c", "icns", "-o", join(resourcesDir, "icon.icns"), iconset], { stdio: "inherit" });
  rmSync(iconset, { recursive: true, force: true });
}

console.log("Generated desktop icons in apps/desktop/resources");
