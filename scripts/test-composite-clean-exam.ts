/**
 * Pixel tests for local handwriting blanking (no DOM image decode / no Gemini).
 * Run: npx tsx scripts/test-composite-clean-exam.ts
 */
import { applyHandwritingBlankPixels } from "../src/utils/imageUtils";

function rgba(w: number, h: number, fill: [number, number, number]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = fill[0];
    d[i + 1] = fill[1];
    d[i + 2] = fill[2];
    d[i + 3] = 255;
  }
  return d;
}

function setPx(
  d: Uint8ClampedArray,
  w: number,
  x: number,
  y: number,
  rgb: [number, number, number]
) {
  const i = (y * w + x) * 4;
  d[i] = rgb[0];
  d[i + 1] = rgb[1];
  d[i + 2] = rgb[2];
  d[i + 3] = 255;
}

function getPx(d: Uint8ClampedArray, w: number, x: number, y: number) {
  const i = (y * w + x) * 4;
  return [d[i], d[i + 1], d[i + 2]] as const;
}

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

const W = 120;
const H = 80;
const paper: [number, number, number] = [245, 245, 242];
const print: [number, number, number] = [20, 20, 20];
const red: [number, number, number] = [200, 45, 40];
const blue: [number, number, number] = [40, 70, 190];
const pencil: [number, number, number] = [150, 148, 145];
const shadow: [number, number, number] = [170, 168, 165];

const orig = rgba(W, H, paper);

// Printed text
for (let y = 20; y < 30; y++) {
  for (let x = 10; x < 50; x++) {
    if (x % 6 < 4 && y % 5 < 4) setPx(orig, W, x, y, print);
  }
}

// Circuit line
for (let x = 55; x < 100; x++) setPx(orig, W, x, 40, print);

// Red / blue strokes (no AI box needed)
for (let x = 10; x < 40; x++) setPx(orig, W, x, 8, red);
for (let x = 50; x < 80; x++) setPx(orig, W, x, 8, blue);

// Pencil stroke with paper neighbors (local contrast)
for (let x = 15; x < 45; x++) setPx(orig, W, x, 50, pencil);

// Uniform shadow patch — must NOT be wiped as pencil
for (let y = 60; y < 75; y++) {
  for (let x = 55; x < 110; x++) setPx(orig, W, x, y, shadow);
}

// Map
for (let y = 55; y < 75; y++) {
  for (let x = 10; x < 45; x++) setPx(orig, W, x, y, [60, 140, 90]);
}

// Solid red「圖」sticker — must clear, not be kept as a map
// Keep clear of the uniform shadow patch sampled at (80,65).
for (let y = 32; y < 52; y++) {
  for (let x = 78; x < 118; x++) setPx(orig, W, x, y, red);
}

// Black tick cleared only via region
for (let k = 0; k < 10; k++) setPx(orig, W, 90 + k, 20 + k, print);

const out = applyHandwritingBlankPixels(orig, W, H, [
  { x: 88 / W, y: 18 / H, width: 14 / W, height: 14 / H, kind: "tick" },
]);

{
  const [r, g, b] = getPx(out, W, 12, 22);
  assert(
    0.299 * r + 0.587 * g + 0.114 * b < 80,
    "print glyph must remain"
  );
}
{
  const [r, g, b] = getPx(out, W, 70, 40);
  assert(
    0.299 * r + 0.587 * g + 0.114 * b < 80,
    "circuit line must remain"
  );
}
{
  const [r, g, b] = getPx(out, W, 20, 8);
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  assert(chroma < 35, `red pen must clear without AI box, chroma=${chroma}`);
}
{
  const [r, g, b] = getPx(out, W, 60, 8);
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  assert(chroma < 35, `blue pen must clear without AI box, chroma=${chroma}`);
}
{
  const [r, g, b] = getPx(out, W, 30, 50);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  assert(lum > 210, `pencil stroke must clear, lum=${lum}`);
}
{
  const [r, g, b] = getPx(out, W, 80, 65);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  assert(lum < 190 && lum > 150, `uniform shadow must stay, lum=${lum}`);
}
{
  const [r, g, b] = getPx(out, W, 20, 60);
  assert(g > 100 && g > r, `map must stay, got ${[r, g, b]}`);
}
{
  const [r, g, b] = getPx(out, W, 95, 40);
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  assert(
    chroma < 40 && lum > 200,
    `red「圖」sticker must clear, rgb=${[r, g, b]}`
  );
}
{
  const [r, g, b] = getPx(out, W, 95, 25);
  assert(
    0.299 * r + 0.587 * g + 0.114 * b >= 80,
    "black tick in AI box must clear"
  );
}

console.log(
  "OK: red/blue/pencil/sticker cleared; print/circuit/map/shadow kept"
);
