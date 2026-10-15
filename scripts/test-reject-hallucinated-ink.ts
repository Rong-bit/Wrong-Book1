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
  !prompt.includes("均勻光線下重拍"),
  "prompt must not encourage full-page re-photograph"
);
assert(
  prompt.includes("擦除") || prompt.includes("Erase"),
  "prompt must ask to erase handwriting"
);
assert(
  prompt.includes("藍筆") &&
    prompt.includes("黑筆") &&
    prompt.includes("紅筆") &&
    prompt.includes("鉛筆"),
  "prompt must list pen colors to erase"
);
assert(
  prompt.includes("請勿修改") || prompt.includes("重新生成"),
  "prompt must forbid modifying/regenerating printed content"
);
assert(
  prompt.includes("完全相同") &&
    (prompt.includes("內容") || prompt.includes("排版")),
  "prompt must keep printed content and layout identical"
);
assert(
  prompt.includes("紙張") || prompt.includes("背景"),
  "prompt must restore handwriting areas to paper background"
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
// Solid red「圖」sticker (large enough that old keepColor treated it as a map)
for (let y = 50; y < 78; y++) {
  for (let x = 70; x < 110; x++) setPx(orig, W, x, y, red);
}
// Green map patch must stay
for (let y = 50; y < 75; y++) {
  for (let x = 8; x < 40; x++) setPx(orig, W, x, y, [60, 140, 90]);
}

// Model invents a circuit where the original was blank paper
const edit = new Uint8ClampedArray(orig);
for (let x = 55; x < 68; x++) setPx(edit, W, x, 35, print);
for (let y = 30; y < 45; y++) setPx(edit, W, 60, y, print);
// Fake "8Ω" blob on blank paper
for (let y = 32; y < 40; y++) {
  for (let x = 48; x < 58; x++) setPx(edit, W, x, y, print);
}
// Model successfully lightened colored pens to paper (sticker left untouched)
for (let x = 10; x < 40; x++) setPx(edit, W, x, 8, paper);
for (let x = 50; x < 80; x++) setPx(edit, W, x, 8, paper);

const out = compositeCleanExamPixels(orig, edit, W, H);

{
  const [r, g, b] = getPx(out, W, 12, 22);
  assert(luma(r, g, b) < 80, "printed glyph must remain");
}
{
  const [r, g, b] = getPx(out, W, 60, 35);
  assert(
    luma(r, g, b) > 210,
    `hallucinated circuit stroke must not survive, lum=${luma(r, g, b)}`
  );
}
{
  const [r, g, b] = getPx(out, W, 52, 35);
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
{
  const [r, g, b] = getPx(out, W, 90, 60);
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  assert(
    chroma < 40 && luma(r, g, b) > 200,
    `red「圖」sticker must clear, rgb=${[r, g, b]}`
  );
}
{
  const [r, g, b] = getPx(out, W, 20, 60);
  assert(g > 100 && g > r, `green map must stay, got ${[r, g, b]}`);
}

// Redrawn print: model replaces speckled print with solid black in-place.
// Composite must keep AI redraw, not discard it for the original photo.
{
  const W3 = 80;
  const H3 = 40;
  const page = rgba(W3, H3, paper);
  for (let y = 12; y < 24; y++) {
    for (let x = 8; x < 50; x++) {
      if ((x + y) % 3 !== 0) setPx(page, W3, x, y, [40, 40, 40]);
    }
  }
  const redrawn: [number, number, number] = [8, 8, 8];
  const edited = new Uint8ClampedArray(page);
  for (let y = 12; y < 24; y++) {
    for (let x = 8; x < 50; x++) setPx(edited, W3, x, y, redrawn);
  }
  const outRedraw = compositeCleanExamPixels(page, edited, W3, H3);
  const [r, g, b] = getPx(outRedraw, W3, 20, 16);
  assert(
    r === 8 && g === 8 && b === 8,
    `AI redrawn print must be kept, got ${[r, g, b]}`
  );
}
assert(
  buildRemoveHandwritingPrompt().includes("鉛筆"),
  "prompt should require clearing pencil handwriting"
);
assert(
  buildRemoveHandwritingPrompt().includes("打勾") ||
    buildRemoveHandwritingPrompt().includes("Ticks"),
  "prompt should require clearing ticks"
);
assert(
  buildRemoveHandwritingPrompt().includes("叉叉") ||
    buildRemoveHandwritingPrompt().includes("分數"),
  "prompt should require clearing crosses / scores"
);

// Washout case: model lightens lots of dark ink (incl. print) + handwriting.
// Print glyph cores must stay; black/pencil handwriting the model cleared must go.
{
  const W2 = 100;
  const H2 = 60;
  const page = rgba(W2, H2, paper);
  const pencil: [number, number, number] = [150, 148, 145];
  // Printed band (solid enough to form printCore)
  for (let y = 10; y < 22; y++) {
    for (let x = 8; x < 55; x++) setPx(page, W2, x, y, print);
  }
  // Handwriting away from print band
  for (let x = 10; x < 35; x++) setPx(page, W2, x, 40, pencil);
  for (let x = 40; x < 70; x++) setPx(page, W2, x, 48, print); // black tick

  const washed = new Uint8ClampedArray(page);
  // Model washes almost everything to paper (triggers aiWashout)
  for (let y = 0; y < H2; y++) {
    for (let x = 0; x < W2; x++) setPx(washed, W2, x, y, paper);
  }
  const outWash = compositeCleanExamPixels(page, washed, W2, H2);
  {
    const [r, g, b] = getPx(outWash, W2, 20, 14);
    assert(
      luma(r, g, b) < 80,
      `washout must keep print core, lum=${luma(r, g, b)}`
    );
  }
  {
    const [r, g, b] = getPx(outWash, W2, 20, 40);
    assert(
      luma(r, g, b) > 200,
      `washout must still clear pencil handwriting, lum=${luma(r, g, b)}`
    );
  }
  {
    const [r, g, b] = getPx(outWash, W2, 50, 48);
    assert(
      luma(r, g, b) > 200,
      `washout must still clear black tick handwriting, lum=${luma(r, g, b)}`
    );
  }
}

console.log(
  "OK: hallucinated circuit rejected; AI redrawn print kept; map kept; red sticker + pens cleared; washout keeps handwriting clears"
);
