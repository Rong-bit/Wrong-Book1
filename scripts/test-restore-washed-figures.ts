/**
 * Pixel tests for restoreWashedFiguresPixels.
 * Run: npx tsx scripts/test-restore-washed-figures.ts
 */
import { restoreWashedFiguresPixels } from "../src/utils/imageUtils";

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

const W = 128;
const H = 96;
const paper: [number, number, number] = [245, 245, 242];
const print: [number, number, number] = [20, 20, 20];
const mapGreen: [number, number, number] = [50, 140, 80];

const orig = rgba(W, H, paper);
const edit = rgba(W, H, paper);

// Text band (should not be force-restored as a figure)
for (let y = 8; y < 16; y++) {
  for (let x = 8; x < 100; x++) {
    if (x % 5 < 3) {
      setPx(orig, W, x, y, print);
      setPx(edit, W, x, y, print);
    }
  }
}

// Circuit-like thin wires in a region (model washed to paper)
for (let x = 20; x < 90; x++) {
  setPx(orig, W, x, 40, print);
  setPx(orig, W, x, 55, print);
  // edit stays paper → washed
}
for (let y = 40; y < 56; y++) {
  setPx(orig, W, 20, y, print);
  setPx(orig, W, 89, y, print);
}

// Color map washed by model
for (let y = 65; y < 90; y++) {
  for (let x = 15; x < 60; x++) {
    setPx(orig, W, x, y, mapGreen);
    setPx(edit, W, x, y, [230, 235, 230]);
  }
}

const out = restoreWashedFiguresPixels(orig, edit, W, H);

{
  const [r, g, b] = getPx(out, W, 40, 40);
  assert(
    0.299 * r + 0.587 * g + 0.114 * b < 80,
    "washed circuit line must be restored from original"
  );
}
{
  const [r, g, b] = getPx(out, W, 30, 70);
  assert(g > 100 && g > r, `washed map must restore, got ${[r, g, b]}`);
}
{
  // Text that AI kept should remain (still dark in edit)
  const [r, g, b] = getPx(out, W, 10, 10);
  assert(
    0.299 * r + 0.587 * g + 0.114 * b < 80,
    "kept print text must stay"
  );
}

console.log("OK: restoreWashedFiguresPixels — circuit + map restored");
