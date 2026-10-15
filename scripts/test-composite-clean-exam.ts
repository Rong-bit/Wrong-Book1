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
const red: [number, number, number] = [210, 40, 40];

const orig = rgba(W, H, paper);

// Printed text band (solid blocks)
for (let y = 20; y < 30; y++) {
  for (let x = 10; x < 50; x++) {
    if (x % 6 < 4 && y % 5 < 4) setPx(orig, W, x, y, print);
  }
}

// Circuit line
for (let x = 55; x < 100; x++) setPx(orig, W, x, 40, print);

// Red pen outside any box — still cleared globally
for (let t = 0; t < 360; t += 3) {
  const rad = (t * Math.PI) / 180;
  setPx(
    orig,
    W,
    Math.round(70 + 8 * Math.cos(rad)),
    Math.round(24 + 8 * Math.sin(rad)),
    red
  );
}

// Black handwriting tick in margin — cleared via region box
for (let k = 0; k < 12; k++) setPx(orig, W, 80 + k, 55 + k, print);

// Map
for (let y = 55; y < 75; y++) {
  for (let x = 10; x < 50; x++) setPx(orig, W, x, y, [60, 140, 90]);
}

const out = applyHandwritingBlankPixels(orig, W, H, [
  { x: 78 / W, y: 53 / H, width: 16 / W, height: 16 / H, kind: "tick" },
]);

{
  const [r, g, b] = getPx(out, W, 12, 22);
  assert(
    0.299 * r + 0.587 * g + 0.114 * b < 80,
    "print glyph must stay sharp (no full-page redraw)"
  );
}
{
  const [r, g, b] = getPx(out, W, 70, 40);
  assert(
    0.299 * r + 0.587 * g + 0.114 * b < 80,
    "circuit line outside mark boxes must remain"
  );
}
{
  const x = Math.round(70 + 8);
  const [r, g, b] = getPx(out, W, x, 24);
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  assert(chroma < 40, `red pen must be cleared, chroma=${chroma}`);
}
{
  const [r, g, b] = getPx(out, W, 85, 60);
  assert(
    0.299 * r + 0.587 * g + 0.114 * b >= 80,
    "handwriting in detected box must be paper-filled"
  );
}
{
  const [r, g, b] = getPx(out, W, 20, 60);
  assert(g > 100 && g > r, `map must stay, got ${[r, g, b]}`);
}

// Reject whole-page region — must not wipe print
const wiped = applyHandwritingBlankPixels(orig, W, H, [
  { x: 0, y: 0, width: 1, height: 1 },
]);
{
  const [r, g, b] = getPx(wiped, W, 12, 22);
  assert(
    0.299 * r + 0.587 * g + 0.114 * b < 80,
    "whole-page region must be ignored"
  );
}

console.log(
  "OK: applyHandwritingBlankPixels — local blank, print/circuit/map kept"
);
