/**
 * Pixel tests: compositeCleanExamPixels must reject invented ink and clear pens.
 * Run: npx tsx scripts/test-reject-hallucinated-ink.ts
 */
import { compositeCleanExamPixels } from "../src/utils/imageUtils";
import { buildRemoveHandwritingPrompt } from "../src/services/geminiCore";

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

function luma(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

const prompt = buildRemoveHandwritingPrompt();
assert(!prompt.includes("8Ω"), "prompt must not prime 8Ω");
assert(!prompt.includes("$X_L$"), "prompt must not prime $X_L$");
assert(
  prompt.includes("禁止新增") || prompt.includes("嚴禁幻覺"),
  "prompt must forbid inventing content"
);
assert(
  !prompt.includes("均勻光線下重拍"),
  "prompt must not encourage full-page re-photograph"
);

const W = 120;
const H = 80;
const paper: [number, number, number] = [245, 245, 242];
const print: [number, number, number] = [20, 20, 20];
const red: [number, number, number] = [200, 45, 40];
const blue: [number, number, number] = [40, 70, 190];

const orig = rgba(W, H, paper);
// Printed text band (no circuit anywhere)
for (let y = 18; y < 28; y++) {
  for (let x = 10; x < 55; x++) {
    if (x % 6 < 4 && y % 5 < 4) setPx(orig, W, x, y, print);
  }
}
// Colored pens to clear
for (let x = 10; x < 40; x++) setPx(orig, W, x, 8, red);
for (let x = 50; x < 80; x++) setPx(orig, W, x, 8, blue);

// Model invents a circuit where the original was blank paper
const edit = new Uint8ClampedArray(orig);
for (let x = 60; x < 110; x++) setPx(edit, W, x, 45, print);
for (let y = 40; y < 55; y++) setPx(edit, W, 85, y, print);
// Fake "8Ω" blob
for (let y = 48; y < 56; y++) {
  for (let x = 92; x < 108; x++) setPx(edit, W, x, y, print);
}
// Model successfully lightened colored pens to paper
for (let x = 10; x < 40; x++) setPx(edit, W, x, 8, paper);
for (let x = 50; x < 80; x++) setPx(edit, W, x, 8, paper);

const out = compositeCleanExamPixels(orig, edit, W, H);

{
  const [r, g, b] = getPx(out, W, 12, 22);
  assert(luma(r, g, b) < 80, "printed glyph must remain from original");
}
{
  const [r, g, b] = getPx(out, W, 90, 45);
  assert(
    luma(r, g, b) > 210,
    `hallucinated circuit stroke must not survive, lum=${luma(r, g, b)}`
  );
}
{
  const [r, g, b] = getPx(out, W, 100, 52);
  assert(
    luma(r, g, b) > 210,
    `hallucinated 8Ω blob must not survive, lum=${luma(r, g, b)}`
  );
}
{
  const [r, g, b] = getPx(out, W, 20, 8);
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  assert(chroma < 35, `red pen must clear via AI lighten, chroma=${chroma}`);
}
{
  const [r, g, b] = getPx(out, W, 60, 8);
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  assert(chroma < 35, `blue pen must clear via AI lighten, chroma=${chroma}`);
}

console.log(
  "OK: hallucinated circuit rejected; print kept; red/blue cleared"
);
