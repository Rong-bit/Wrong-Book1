/**
 * Run local hollow-out post-process on a real exam photo.
 * Usage: npx tsx scripts/test-real-exam-hollow.ts [imagePath]
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import jpeg from "jpeg-js";
import {
  bleachColoredPensOnlyPixels,
  compositeCleanExamPixels,
} from "../src/utils/imageUtils";

const src =
  process.argv[2] ||
  "/home/ubuntu/.cursor/projects/workspace/assets/8383ead0-6ae1-44d9-8dce-eeeb2cf31f69.jpg";
const outDir = "/opt/cursor/artifacts";
mkdirSync(outDir, { recursive: true });

function decodeJpeg(path: string) {
  const raw = readFileSync(path);
  const decoded = jpeg.decode(raw, { useTArray: true, formatAsRGBA: true });
  return {
    data: new Uint8ClampedArray(decoded.data),
    w: decoded.width,
    h: decoded.height,
  };
}

function encodeJpeg(data: Uint8ClampedArray, w: number, h: number, q = 90) {
  return jpeg.encode({ data, width: w, height: h }, q).data;
}

function isRed(r: number, g: number, b: number) {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  return (
    lum < 232 &&
    lum > 35 &&
    r >= g + 12 &&
    r >= b + 12 &&
    chroma >= 18 &&
    r / (g + 1) >= 1.12 &&
    r / (b + 1) >= 1.12
  );
}

function cropCenter(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  cx: number,
  cy: number,
  side = 300
) {
  const hw = Math.floor(side / 2);
  const x0 = Math.max(0, Math.min(w - side, cx - hw));
  const y0 = Math.max(0, Math.min(h - side, cy - hw));
  const out = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const si = ((y0 + y) * w + (x0 + x)) * 4;
      const di = (y * side + x) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = 255;
    }
  }
  return { data: out, w: side, h: side, x0, y0 };
}

function inkStats(data: Uint8ClampedArray, w: number, h: number) {
  let red = 0;
  let ink = 0;
  let midGrayInk = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    n++;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    if (isRed(r, g, b)) red++;
    if (lum < 180 && chroma < 45) {
      ink++;
      if (lum >= 108 && lum <= 198) midGrayInk++;
    }
  }
  return {
    red,
    ink,
    midGrayInk,
    inkPct: +((ink / n) * 100).toFixed(2),
    midGrayInkPct: +((midGrayInk / n) * 100).toFixed(2),
  };
}

const { data: orig, w, h } = decodeJpeg(resolve(src));
const stickerCx = 243;
const stickerCy = 823;

// Path used after AI: composite then surgical red/blue bleach
const composited = compositeCleanExamPixels(orig, orig, w, h);
const full = bleachColoredPensOnlyPixels(composited, w, h);

const beforeCrop = cropCenter(orig, w, h, stickerCx, stickerCy);
const afterCrop = cropCenter(full, w, h, stickerCx, stickerCy);
const beforeInk = inkStats(beforeCrop.data, beforeCrop.w, beforeCrop.h);
const afterInk = inkStats(afterCrop.data, afterCrop.w, afterCrop.h);

// Text band left of sticker (should keep mid-gray print)
const textBand = cropCenter(full, w, h, 160, 700, 220);
const textBandOrig = cropCenter(orig, w, h, 160, 700, 220);
const textBefore = inkStats(textBandOrig.data, textBandOrig.w, textBandOrig.h);
const textAfter = inkStats(textBand.data, textBand.w, textBand.h);

writeFileSync(`${outDir}/exam-hollow-before.jpg`, encodeJpeg(orig, w, h));
writeFileSync(`${outDir}/exam-hollow-after-local.jpg`, encodeJpeg(full, w, h));
writeFileSync(
  `${outDir}/exam-hollow-sticker-before.jpg`,
  encodeJpeg(beforeCrop.data, beforeCrop.w, beforeCrop.h)
);
writeFileSync(
  `${outDir}/exam-hollow-sticker-after.jpg`,
  encodeJpeg(afterCrop.data, afterCrop.w, afterCrop.h)
);

const redDrop =
  beforeInk.red === 0
    ? 100
    : Math.round((1 - afterInk.red / beforeInk.red) * 1000) / 10;
const midGrayKeep =
  textBefore.midGrayInk === 0
    ? 100
    : Math.round((textAfter.midGrayInk / textBefore.midGrayInk) * 1000) / 10;

const report = {
  image: src,
  size: { w, h },
  note: "Local post-process only (composite + surgical red/blue bleach). No Gemini key.",
  stickerCrop: { before: beforeInk, after: afterInk, redDropPct: redDrop },
  textBand: {
    before: textBefore,
    after: textAfter,
    midGrayKeepPct: midGrayKeep,
  },
  pass: {
    redCleared: redDrop >= 90,
    printKept: midGrayKeep >= 70 && textAfter.inkPct >= textBefore.inkPct * 0.7,
  },
};

writeFileSync(
  `${outDir}/exam-hollow-test-report.json`,
  JSON.stringify(report, null, 2)
);
console.log(JSON.stringify(report, null, 2));

if (!report.pass.redCleared || !report.pass.printKept) {
  console.error("FAIL: redCleared=", report.pass.redCleared, "printKept=", report.pass.printKept);
  process.exit(1);
}
console.log("PASS: red sticker cleared; photographed print retained");
