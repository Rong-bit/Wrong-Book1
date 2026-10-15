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
const shadow: [number, number, number] = [160, 158, 155];

function runHappyPath() {
  const orig = rgba(W, H, paper);
  const edit = rgba(W, H, paper);

  // Printed text band
  for (let y = 20; y < 30; y++) {
    for (let x = 10; x < 50; x++) {
      if (x % 6 < 4 && y % 5 < 4) setPx(orig, W, x, y, print);
    }
  }
  // Model redraws print shifted +2px
  for (let y = 20; y < 30; y++) {
    for (let x = 12; x < 52; x++) {
      if ((x - 2) % 6 < 4 && y % 5 < 4) setPx(edit, W, x, y, print);
    }
  }

  // Mid-gray shadow patch — must NOT be bleached (old pencil heuristic)
  for (let y = 5; y < 18; y++) {
    for (let x = 5; x < 40; x++) {
      setPx(orig, W, x, y, shadow);
      setPx(edit, W, x, y, [210, 208, 205]); // slightly lighter ghost
    }
  }

  // Circuit thin line the model kept
  for (let x = 55; x < 100; x++) {
    setPx(orig, W, x, 40, print);
    setPx(edit, W, x, 40, print);
  }

  // Red pen circle
  for (let t = 0; t < 360; t += 3) {
    const rad = (t * Math.PI) / 180;
    const x = Math.round(70 + 8 * Math.cos(rad));
    const y = Math.round(24 + 8 * Math.sin(rad));
    setPx(orig, W, x, y, red);
  }

  // Black tick; model cleared it
  for (let k = 0; k < 12; k++) {
    setPx(orig, W, 80 + k, 50 + k, print);
    setPx(edit, W, 80 + k, 50 + k, paper);
  }

  // Map
  for (let y = 55; y < 75; y++) {
    for (let x = 10; x < 50; x++) {
      setPx(orig, W, x, y, [60, 140, 90]);
      setPx(edit, W, x, y, [220, 230, 220]);
    }
  }

  const out = compositeCleanExamPixels(orig, edit, W, H);

  {
    const [r, g, b] = getPx(out, W, 51, 22);
    assert(
      0.299 * r + 0.587 * g + 0.114 * b >= 80,
      "shifted AI print must not appear (ghosting)"
    );
  }
  {
    const [r, g, b] = getPx(out, W, 12, 22);
    assert(
      0.299 * r + 0.587 * g + 0.114 * b < 80,
      "original print glyph must remain"
    );
  }
  {
    const [r, g, b] = getPx(out, W, 20, 10);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    assert(lum < 180 && lum > 130, `shadow mid-gray must stay, lum=${lum}`);
  }
  {
    const [r, g, b] = getPx(out, W, 70, 40);
    assert(
      0.299 * r + 0.587 * g + 0.114 * b < 80,
      "circuit line the model kept must remain"
    );
  }
  {
    const x = Math.round(70 + 8);
    const [r, g, b] = getPx(out, W, x, 24);
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    assert(chroma < 40, `red pen must be cleared, chroma=${chroma}`);
  }
  {
    const [r, g, b] = getPx(out, W, 85, 55);
    assert(
      0.299 * r + 0.587 * g + 0.114 * b >= 80,
      "AI-cleared black tick must be paper-filled"
    );
  }
  {
    const [r, g, b] = getPx(out, W, 20, 60);
    assert(g > 100 && g > r, `map must stay, got ${[r, g, b]}`);
  }
}

function runAiWashoutFallback() {
  const orig = rgba(W, H, paper);
  const edit = rgba(W, H, paper);

  // Many dark print + circuit pixels
  for (let y = 10; y < 70; y++) {
    for (let x = 10; x < 110; x++) {
      if ((x + y) % 3 === 0) setPx(orig, W, x, y, print);
    }
  }
  // Model washes almost everything to paper (bad AI)
  // edit stays paper

  // One red pen mark should still clear
  setPx(orig, W, 60, 40, red);

  const out = compositeCleanExamPixels(orig, edit, W, H);

  // Most dark print must survive washout fallback
  let kept = 0;
  let total = 0;
  for (let y = 10; y < 70; y++) {
    for (let x = 10; x < 110; x++) {
      if ((x + y) % 3 !== 0) continue;
      total++;
      const [r, g, b] = getPx(out, W, x, y);
      if (0.299 * r + 0.587 * g + 0.114 * b < 80) kept++;
    }
  }
  assert(kept / total > 0.9, `washout fallback must keep print, kept=${kept}/${total}`);

  const [rr, rg, rb] = getPx(out, W, 60, 40);
  const chroma = Math.max(rr, rg, rb) - Math.min(rr, rg, rb);
  assert(chroma < 40, "red pen still cleared under washout fallback");
}

runHappyPath();
runAiWashoutFallback();
console.log(
  "OK: compositeCleanExamPixels — clarity-safe mask, no ghost, washout fallback"
);
