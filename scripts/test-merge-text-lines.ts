/**
 * 選文字 must keep stacked lines as separate strips (not one tall rectangle).
 * Run: npx tsx scripts/test-merge-text-lines.ts
 */
import { mergePaintIslandRects, type LabeledCropRect } from "../src/utils/imageUtils";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

const line1: LabeledCropRect = {
  x: 0.1,
  y: 0.2,
  width: 0.6,
  height: 0.035,
  kind: "text",
};
const line2: LabeledCropRect = {
  x: 0.12,
  y: 0.245, // ~1% gap below line1 — typical exam line spacing
  width: 0.55,
  height: 0.035,
  kind: "text",
};
const line3: LabeledCropRect = {
  x: 0.11,
  y: 0.29,
  width: 0.58,
  height: 0.034,
  kind: "text",
};

const textMerged = mergePaintIslandRects([line1, line2, line3], 0.035);
assert(
  textMerged.length === 3,
  `stacked text lines must stay separate, got ${textMerged.length}`
);
assert(
  textMerged.every((r) => r.height < 0.05),
  "each text strip must stay one-line tall"
);

// Re-painting the same line (substantial overlap) may still merge
const line1b: LabeledCropRect = {
  x: 0.15,
  y: 0.205,
  width: 0.5,
  height: 0.03,
  kind: "text",
};
const sameLine = mergePaintIslandRects([line1, line1b], 0.035);
assert(
  sameLine.length === 1,
  `overlapping same-line text strokes should merge, got ${sameLine.length}`
);

// Diagram patches still merge vertically
const mapA: LabeledCropRect = {
  x: 0.5,
  y: 0.5,
  width: 0.3,
  height: 0.12,
  kind: "diagram",
};
const mapB: LabeledCropRect = {
  x: 0.52,
  y: 0.63,
  width: 0.28,
  height: 0.1,
  kind: "diagram",
};
const mapMerged = mergePaintIslandRects([mapA, mapB], 0.035);
assert(
  mapMerged.length === 1,
  `nearby diagram patches should still merge, got ${mapMerged.length}`
);

// Text + diagram never glue
const mixed = mergePaintIslandRects([line1, mapA], 0.035);
assert(mixed.length === 2, "text and diagram must not merge");

console.log(
  "OK: text lines stay one-strip-per-row; overlapping text merges; diagrams still merge"
);
