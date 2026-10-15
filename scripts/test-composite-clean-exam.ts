/**
 * Synthetic pixel tests for compositeCleanExamPixels (no DOM / no Gemini).
 * Run: npx tsx scripts/test-composite-clean-exam.ts
 */
import { compositeCleanExamPixels } from "../src/utils/imageUtils";

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
const edit = rgba(W, H, paper);

// Printed text band: solid blocks that survive dual erosion
for (let y = 20; y < 30; y++) {
  for (let x = 10; x < 50; x++) {
    if (x % 6 < 4 && y % 5 < 4) setPx(orig, W, x, y, print);
  }
}
// Model redraws print shifted +2px (ghost source in the old paste-back approach)
for (let y = 20; y < 30; y++) {
  for (let x = 12; x < 52; x++) {
    if ((x - 2) % 6 < 4 && y % 5 < 4) setPx(edit, W, x, y, print);
  }
}

// Red pen circle stroke (thin 1px ring)
for (let t = 0; t < 360; t += 3) {
  const rad = (t * Math.PI) / 180;
  const x = Math.round(70 + 8 * Math.cos(rad));
  const y = Math.round(24 + 8 * Math.sin(rad));
  setPx(orig, W, x, y, red);
}

// Black thin handwriting tick; model cleared it
for (let k = 0; k < 12; k++) {
  setPx(orig, W, 80 + k, 50 + k, print);
  setPx(edit, W, 80 + k, 50 + k, paper);
}

// Map block — model washed it pale
for (let y = 50; y < 75; y++) {
  for (let x = 10; x < 50; x++) {
    setPx(orig, W, x, y, [60, 140, 90]);
    setPx(edit, W, x, y, [220, 230, 220]);
  }
}

const out = compositeCleanExamPixels(orig, edit, W, H);

// 1) No ghost from shifted AI print
{
  const [r, g, b] = getPx(out, W, 51, 22);
  const isDark = 0.299 * r + 0.587 * g + 0.114 * b < 80;
  assert(!isDark, "shifted AI print must not appear (ghosting)");
}

// 2) Original print glyph kept
{
  const [r, g, b] = getPx(out, W, 12, 22);
  const isDark = 0.299 * r + 0.587 * g + 0.114 * b < 80;
  assert(isDark, "original print glyph must remain");
}

// 3) Red pen cleared
{
  const x = Math.round(70 + 8);
  const y = 24;
  const [r, g, b] = getPx(out, W, x, y);
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  assert(chroma < 40, `red pen stroke must be cleared, chroma=${chroma}`);
}

// 4) Thin black tick cleared
{
  const [r, g, b] = getPx(out, W, 85, 55);
  const isDark = 0.299 * r + 0.587 * g + 0.114 * b < 80;
  assert(!isDark, "thin black handwriting must be cleared");
}

// 5) Map kept from original
{
  const [r, g, b] = getPx(out, W, 20, 60);
  assert(g > 100 && g > r, `map green must stay from original, got ${[r, g, b]}`);
}

// 6) Contrast: old "AI-base + paste dark print" would ghost at the shift offset
{
  const ghosted = new Uint8ClampedArray(edit);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const oLum = 0.299 * orig[i] + 0.587 * orig[i + 1] + 0.114 * orig[i + 2];
      const eLum = 0.299 * ghosted[i] + 0.587 * ghosted[i + 1] + 0.114 * ghosted[i + 2];
      const oC =
        Math.max(orig[i], orig[i + 1], orig[i + 2]) -
        Math.min(orig[i], orig[i + 1], orig[i + 2]);
      if (oLum < 125 && oC < 34 && eLum > oLum + 22) {
        ghosted[i] = orig[i];
        ghosted[i + 1] = orig[i + 1];
        ghosted[i + 2] = orig[i + 2];
      }
    }
  }
  const [gr, gg, gb] = getPx(ghosted, W, 51, 22);
  const oldGhost = 0.299 * gr + 0.587 * gg + 0.114 * gb < 80;
  assert(oldGhost, "sanity: old paste-back would leave a ghost at shift offset");
}

console.log(
  "OK: compositeCleanExamPixels — no ghost, print kept, marks cleared, map kept"
);
