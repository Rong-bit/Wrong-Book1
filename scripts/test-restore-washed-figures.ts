/**
 * Pixel tests for restoreWashedFiguresPixels (circuit diagrams).
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

const W = 160;
const H = 120;
const paper: [number, number, number] = [245, 245, 242];
const print: [number, number, number] = [25, 25, 25];
const blue: [number, number, number] = [35, 70, 200];

const orig = rgba(W, H, paper);
const edit = rgba(W, H, paper);

// Text lines AI kept
for (let y = 6; y < 14; y++) {
  for (let x = 8; x < 140; x++) {
    if (x % 4 < 2) {
      setPx(orig, W, x, y, print);
      setPx(edit, W, x, y, print);
    }
  }
}

// Circuit rectangle wires (sparse) — AI washed to paper
for (let x = 30; x < 110; x++) {
  setPx(orig, W, x, 45, print);
  setPx(orig, W, x, 75, print);
}
for (let y = 45; y <= 75; y++) {
  setPx(orig, W, 30, y, print);
  setPx(orig, W, 109, y, print);
}
// Cross wires
for (let x = 30; x < 110; x++) setPx(orig, W, x, 60, print);
for (let y = 45; y <= 75; y++) setPx(orig, W, 70, y, print);

// Blue pen scribble near circuit — must NOT be restored
for (let k = 0; k < 14; k++) {
  setPx(orig, W, 40 + k, 50 + k, blue);
}

// Map washed
for (let y = 90; y < 115; y++) {
  for (let x = 20; x < 70; x++) {
    setPx(orig, W, x, y, [55, 145, 85]);
    setPx(edit, W, x, y, [225, 232, 225]);
  }
}

const out = restoreWashedFiguresPixels(orig, edit, W, H);

{
  const [r, g, b] = getPx(out, W, 70, 45);
  assert(
    0.299 * r + 0.587 * g + 0.114 * b < 90,
    "circuit top wire must be restored"
  );
}
{
  const [r, g, b] = getPx(out, W, 70, 60);
  assert(
    0.299 * r + 0.587 * g + 0.114 * b < 90,
    "circuit cross wire must be restored"
  );
}
{
  const [r, g, b] = getPx(out, W, 47, 57);
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  assert(chroma < 40, `blue pen must not be restored, chroma=${chroma}`);
}
{
  const [r, g, b] = getPx(out, W, 40, 100);
  assert(g > 100 && g > r, `map must restore, got ${[r, g, b]}`);
}
{
  const [r, g, b] = getPx(out, W, 20, 8);
  assert(
    0.299 * r + 0.587 * g + 0.114 * b < 90,
    "kept text must remain"
  );
}

console.log("OK: circuit restored, blue pen skipped, map restored");
