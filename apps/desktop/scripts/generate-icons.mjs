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

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mixColor(a, b, t) {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
    Math.round(lerp(a[3] ?? 255, b[3] ?? 255, t)),
  ];
}

function gradientColor(stops, t) {
  const n = clamp01(t);
  for (let i = 1; i < stops.length; i += 1) {
    if (n <= stops[i][0]) {
      const [prevAt, prev] = stops[i - 1];
      const [nextAt, next] = stops[i];
      return mixColor(prev, next, (n - prevAt) / (nextAt - prevAt));
    }
  }
  return stops[stops.length - 1][1];
}

function blendOverPixel(rgba, width, x, y, color) {
  const i = (y * width + x) * 4;
  const sa = (color[3] ?? 255) / 255;
  if (sa <= 0) return;
  const da = rgba[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  rgba[i] = Math.round((color[0] * sa + rgba[i] * da * (1 - sa)) / oa);
  rgba[i + 1] = Math.round((color[1] * sa + rgba[i + 1] * da * (1 - sa)) / oa);
  rgba[i + 2] = Math.round((color[2] * sa + rgba[i + 2] * da * (1 - sa)) / oa);
  rgba[i + 3] = Math.round(oa * 255);
}

function blendScreenPixel(rgba, width, x, y, color) {
  const i = (y * width + x) * 4;
  const screened = [
    Math.round(255 - ((255 - color[0]) * (255 - rgba[i])) / 255),
    Math.round(255 - ((255 - color[1]) * (255 - rgba[i + 1])) / 255),
    Math.round(255 - ((255 - color[2]) * (255 - rgba[i + 2])) / 255),
    color[3],
  ];
  blendOverPixel(rgba, width, x, y, screened);
}

function distanceToColor(rgba, i, color) {
  return Math.abs(rgba[i] - color[0])
    + Math.abs(rgba[i + 1] - color[1])
    + Math.abs(rgba[i + 2] - color[2]);
}

function pixelLooksCyan(rgba, i) {
  return rgba[i + 1] > rgba[i] + 18 && rgba[i + 2] > rgba[i] + 18;
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

function drawSoftCircle(rgba, width, height, cx, cy, radius, color, opts = {}) {
  const pad = Math.ceil(opts.pad ?? 2);
  const bg = opts.backgroundColor;
  for (let y = Math.max(0, Math.floor(cy - radius - pad)); y < Math.min(height, Math.ceil(cy + radius + pad)); y += 1) {
    for (let x = Math.max(0, Math.floor(cx - radius - pad)); x < Math.min(width, Math.ceil(cx + radius + pad)); x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const alpha = (color[3] ?? 255) * clamp01(radius + 1 - dist);
      if (alpha <= 0) continue;
      const next = [color[0], color[1], color[2], Math.round(alpha)];
      if (opts.screenOnCyan) {
        const i = (y * width + x) * 4;
        if (rgba[i + 3] > 0 && pixelLooksCyan(rgba, i)) {
          blendScreenPixel(rgba, width, x, y, next);
          continue;
        }
      }
      if (opts.screenOnPainted && bg) {
        const i = (y * width + x) * 4;
        if (rgba[i + 3] > 0 && distanceToColor(rgba, i, bg) > 45) {
          blendScreenPixel(rgba, width, x, y, next);
          continue;
        }
      }
      blendOverPixel(rgba, width, x, y, next);
    }
  }
}

function drawOrb(rgba, width, height, cx, cy, radius, stops, opts = {}) {
  const bg = opts.backgroundColor;
  const lightX = cx - radius * 0.28;
  const lightY = cy - radius * 0.32;
  const shadowX = cx + radius * 0.45;
  const shadowY = cy + radius * 0.62;
  for (let y = Math.max(0, Math.floor(cy - radius - 2)); y < Math.min(height, Math.ceil(cy + radius + 2)); y += 1) {
    for (let x = Math.max(0, Math.floor(cx - radius - 2)); x < Math.min(width, Math.ceil(cx + radius + 2)); x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const dx = px - cx;
      const dy = py - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const edge = clamp01(radius + 1.2 - dist);
      if (edge <= 0) continue;

      const lightDist = Math.hypot(px - lightX, py - lightY);
      let color = gradientColor(stops, lightDist / (radius * 1.36));

      const shadowDist = Math.hypot(px - shadowX, py - shadowY);
      const shadow = 0.32 * clamp01(1 - shadowDist / (radius * 0.8));
      color = mixColor(color, [0, 0, 0, 255], shadow);

      const rim = 0.36 * clamp01((radius - (py - (cy - radius))) / (radius * 0.22));
      color = mixColor(color, [255, 255, 255, 255], rim);

      const spec = 0.66 * Math.pow(clamp01(1 - lightDist / (radius * 0.48)), 1.8);
      color = mixColor(color, [255, 255, 255, 255], spec);
      color[3] = Math.round((opts.alpha ?? 255) * edge);

      if (opts.screenOnCyan) {
        const i = (y * width + x) * 4;
        if (rgba[i + 3] > 0 && pixelLooksCyan(rgba, i)) {
          blendScreenPixel(rgba, width, x, y, color);
          continue;
        }
      }
      if (opts.screenOnPainted && bg) {
        const i = (y * width + x) * 4;
        if (rgba[i + 3] > 0 && distanceToColor(rgba, i, bg) > 45) {
          blendScreenPixel(rgba, width, x, y, color);
          continue;
        }
      }
      blendOverPixel(rgba, width, x, y, color);
    }
  }
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const s = size / 1024;
  const bg = [247, 244, 239, 255];
  fillRoundedRect(rgba, size, size, Math.round(72 * s), Math.round(72 * s), Math.round(880 * s), Math.round(880 * s), Math.round(220 * s), bg);

  const cx1 = 422 * s;
  const cx2 = 602 * s;
  const cy = 512 * s;
  const r = 250 * s;
  drawSoftCircle(rgba, size, size, cx1, cy + 22 * s, r * 1.08, [6, 182, 212, 76], { backgroundColor: bg, pad: 4 });
  drawSoftCircle(rgba, size, size, cx2, cy + 22 * s, r * 1.08, [245, 158, 11, 72], { backgroundColor: bg, pad: 4 });
  drawOrb(rgba, size, size, cx1, cy, r, [
    [0, [165, 243, 252, 255]],
    [0.4, [34, 211, 238, 255]],
    [0.85, [14, 116, 144, 255]],
    [1, [8, 51, 68, 255]],
  ], { backgroundColor: bg });
  drawOrb(rgba, size, size, cx2, cy, r, [
    [0, [254, 243, 199, 255]],
    [0.4, [251, 191, 36, 255]],
    [0.85, [180, 83, 9, 255]],
    [1, [69, 26, 3, 255]],
  ], { backgroundColor: bg, screenOnCyan: true });
  return png(size, size, rgba);
}

function drawTray(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const black = [0, 0, 0, 255];
  const s = size / 32;
  fillCircle(rgba, size, size, Math.round(13 * s), Math.round(16 * s), Math.round(9 * s), black);
  fillCircle(rgba, size, size, Math.round(20 * s), Math.round(16 * s), Math.round(9 * s), black);
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
