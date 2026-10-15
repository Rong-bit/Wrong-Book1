/**
 * Image helper utilities for compression, normalization, and validation
 */

/**
 * Normalizes an image source string: ensures valid data URL prefix and standardizes SVG to base64
 */
export function normalizeImageSrc(src: string | undefined | null): string {
  if (!src) return "";
  let trimmed = src.trim();

  // If already standard base64 image (PNG, JPEG, WebP)
  if (
    trimmed.startsWith("data:image/jpeg;base64,") ||
    trimmed.startsWith("data:image/png;base64,") ||
    trimmed.startsWith("data:image/webp;base64,") ||
    trimmed.startsWith("blob:") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://")
  ) {
    return trimmed;
  }

  // Handle any SVG data URL (convert utf8 / percent-encoded SVG into standard base64)
  if (trimmed.startsWith("data:image/svg+xml")) {
    if (trimmed.includes(";base64,")) {
      return trimmed;
    }
    const commaIdx = trimmed.indexOf(",");
    if (commaIdx !== -1) {
      const payload = trimmed.slice(commaIdx + 1);
      let svgText = "";
      try {
        svgText = decodeURIComponent(payload);
      } catch {
        svgText = payload;
      }
      try {
        const base64 =
          typeof window !== "undefined" && window.btoa
            ? window.btoa(
                encodeURIComponent(svgText).replace(/%([0-9A-F]{2})/g, (_, p1) =>
                  String.fromCharCode(parseInt(p1, 16))
                )
              )
            : Buffer.from(svgText, "utf-8").toString("base64");
        return `data:image/svg+xml;base64,${base64}`;
      } catch (err) {
        console.warn("SVG to base64 conversion fallback:", err);
      }
    }
    return trimmed;
  }

  // If it's a raw base64 string without data prefix
  if (/^[A-Za-z0-9+/=]+$/.test(trimmed.slice(0, 100))) {
    if (trimmed.startsWith("iVBORw0KGgo")) {
      return `data:image/png;base64,${trimmed}`;
    }
    if (trimmed.startsWith("/9j/")) {
      return `data:image/jpeg;base64,${trimmed}`;
    }
    if (trimmed.startsWith("PHN2Zy") || trimmed.startsWith("PD94bWw")) {
      return `data:image/svg+xml;base64,${trimmed}`;
    }
    return `data:image/jpeg;base64,${trimmed}`;
  }

  return trimmed;
}

/**
 * Checks if a file or blob is a supported image type (including HEIC/HEIF)
 */
export function isSupportedImageFile(file: File | Blob): boolean {
  if (file instanceof File) {
    const name = file.name.toLowerCase();
    if (
      name.endsWith(".jpg") ||
      name.endsWith(".jpeg") ||
      name.endsWith(".png") ||
      name.endsWith(".webp") ||
      name.endsWith(".bmp") ||
      name.endsWith(".gif") ||
      name.endsWith(".svg") ||
      name.endsWith(".heic") ||
      name.endsWith(".heif")
    ) {
      return true;
    }
  }
  if (file.type) {
    const type = file.type.toLowerCase();
    if (
      type.startsWith("image/") ||
      type.includes("heic") ||
      type.includes("heif")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether a file, blob, or string path/MIME indicates a HEIC or HEIF image
 */
export function isHeic(file: File | Blob | string): boolean {
  if (typeof file === "string") {
    const lower = file.toLowerCase();
    return (
      lower.includes("image/heic") ||
      lower.includes("image/heif") ||
      lower.endsWith(".heic") ||
      lower.endsWith(".heif")
    );
  }
  if (file instanceof File) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".heic") || name.endsWith(".heif")) {
      return true;
    }
  }
  if (file.type) {
    const type = file.type.toLowerCase();
    if (type.includes("heic") || type.includes("heif")) {
      return true;
    }
  }
  return false;
}

/**
 * Deep check for HEIC/HEIF signature in binary bytes (for files without standard mime type)
 */
export async function checkIsHeicBlob(blob: Blob): Promise<boolean> {
  if (isHeic(blob)) return true;
  try {
    const slice = blob.slice(0, 32);
    const buffer = await slice.arrayBuffer();
    const arr = new Uint8Array(buffer);
    const text = String.fromCharCode(...arr);
    if (
      text.includes("ftyp") &&
      (text.includes("heic") ||
        text.includes("mif1") ||
        text.includes("msf1") ||
        text.includes("hevc") ||
        text.includes("heix") ||
        text.includes("heim") ||
        text.includes("heis") ||
        text.includes("avic"))
    ) {
      return true;
    }
  } catch {
    // Ignore binary read errors
  }
  return false;
}

/**
 * Converts HEIC/HEIF blob to a standard JPEG Blob using client-side heic2any
 */
export async function convertHeicToJpegBlob(fileOrBlob: Blob): Promise<Blob> {
  const mod = await import("heic2any");
  const converter = (mod.default ?? mod) as unknown as (options: {
    blob: Blob;
    toType?: string;
    quality?: number;
  }) => Promise<Blob | Blob[]>;
  const result = await converter({
    blob: fileOrBlob,
    toType: "image/jpeg",
    quality: 0.92,
  });
  if (Array.isArray(result)) {
    return result[0];
  }
  return result;
}

/**
 * Longest side kept for print. ~300 dpi across an A4 short edge (210mm),
 * so a cropped map still has pixels left after it is placed large on the sheet.
 */
export const PRINT_SOURCE_MAX_EDGE = 2480;

/**
 * Compresses an image file or base64 string to a crisp, storage-friendly JPEG data URL.
 * Automatically supports HEIC/HEIF images (e.g. from iPhone / iPad cameras).
 * Default longest side is {@link PRINT_SOURCE_MAX_EDGE}.
 */
export async function compressImage(
  fileOrBase64: File | Blob | string,
  maxWidth = PRINT_SOURCE_MAX_EDGE,
  maxHeight = PRINT_SOURCE_MAX_EDGE,
  quality = 0.92
): Promise<string> {
  let target: File | Blob | string = fileOrBase64;

  // 1. Detect & convert HEIC/HEIF if uploaded as File/Blob
  if (typeof target !== "string") {
    const isHeicDetected = await checkIsHeicBlob(target);
    if (isHeicDetected) {
      try {
        const convertedBlob = await convertHeicToJpegBlob(target);
        target = convertedBlob;
      } catch (err) {
        console.warn("HEIC image conversion error, attempting fallback:", err);
      }
    }
  } else if (
    target.startsWith("data:image/heic") ||
    target.startsWith("data:image/heif")
  ) {
    // If it's a HEIC data URL
    try {
      const res = await fetch(target);
      const blob = await res.blob();
      const convertedBlob = await convertHeicToJpegBlob(blob);
      target = convertedBlob;
    } catch (err) {
      console.warn("HEIC data URL conversion error:", err);
    }
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    let objectUrlToRevoke: string | null = null;

    const cleanup = () => {
      if (objectUrlToRevoke) {
        URL.revokeObjectURL(objectUrlToRevoke);
        objectUrlToRevoke = null;
      }
    };

    img.onload = () => {
      try {
        let { width, height } = img;

        // Calculate aspect ratio preserving dimensions
        if (width > maxWidth || height > maxHeight) {
          if (width / height > maxWidth / maxHeight) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, width);
        canvas.height = Math.max(1, height);

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          cleanup();
          resolve(typeof target === "string" ? target : "");
          return;
        }

        // Fill white background for transparent PNGs
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);

        // Output as high quality JPEG
        const compressedBase64 = canvas.toDataURL("image/jpeg", quality);
        cleanup();
        resolve(compressedBase64);
      } catch (err) {
        cleanup();
        console.warn("Canvas image compression failed, using original:", err);
        if (typeof target === "string") {
          resolve(target);
        } else {
          const reader = new FileReader();
          reader.onload = (e) => resolve((e.target?.result as string) || "");
          reader.onerror = reject;
          reader.readAsDataURL(target);
        }
      }
    };

    img.onerror = () => {
      cleanup();
      // If image failed to load directly (e.g. from File or malformed base64)
      if (typeof target === "string") {
        resolve(target);
      } else {
        const reader = new FileReader();
        reader.onload = (e) => resolve((e.target?.result as string) || "");
        reader.onerror = reject;
        reader.readAsDataURL(target);
      }
    };

    if (typeof target === "string") {
      img.src = normalizeImageSrc(target);
    } else {
      objectUrlToRevoke = URL.createObjectURL(target);
      img.src = objectUrlToRevoke;
    }
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = normalizeImageSrc(src);
  });
}

/**
 * After AI 去手寫, put printed question glyphs back from the original photo.
 * Colored pen strokes and marks that are not a printed text band stay cleared.
 * A color region large enough to be a map is kept whole, including edge blocks
 * that only cover a corner of the map.
 */
export async function preservePrintedQuestionText(
  originalSrc: string,
  editedSrc: string
): Promise<string> {
  const [original, edited] = await Promise.all([
    loadImageElement(originalSrc),
    loadImageElement(editedSrc),
  ]);
  const w = original.naturalWidth || original.width;
  const h = original.naturalHeight || original.height;
  if (w < 8 || h < 8) return editedSrc;

  const origCanvas = document.createElement("canvas");
  origCanvas.width = w;
  origCanvas.height = h;
  const origCtx = origCanvas.getContext("2d", { willReadFrequently: true });
  const editCanvas = document.createElement("canvas");
  editCanvas.width = w;
  editCanvas.height = h;
  const editCtx = editCanvas.getContext("2d", { willReadFrequently: true });
  if (!origCtx || !editCtx) return editedSrc;

  origCtx.drawImage(original, 0, 0, w, h);
  editCtx.imageSmoothingEnabled = true;
  editCtx.imageSmoothingQuality = "high";
  editCtx.drawImage(edited, 0, 0, w, h);

  const origData = origCtx.getImageData(0, 0, w, h);
  const editData = editCtx.getImageData(0, 0, w, h);
  const od = origData.data;
  const out = editData.data;

  const n = w * h;
  const lum = new Uint16Array(n);
  const chroma = new Uint8Array(n);
  const printed = new Uint8Array(n);
  const rowInk = new Uint32Array(h);
  const rowLumSum = new Float64Array(h);

  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const r = od[i];
    const g = od[i + 1];
    const b = od[i + 2];
    const v = 0.299 * r + 0.587 * g + 0.114 * b;
    const c = Math.max(r, g, b) - Math.min(r, g, b);
    lum[p] = v;
    chroma[p] = c;
    if (v < 125 && c < 34) {
      printed[p] = 1;
      const y = (p / w) | 0;
      rowInk[y]++;
      rowLumSum[y] += v;
    }
  }

  const rowMin = Math.max(8, Math.round(w * 0.01));
  const protectRow = new Uint8Array(h);
  let y = 0;
  while (y < h) {
    if (rowInk[y] < rowMin) {
      y++;
      continue;
    }
    let y2 = y;
    while (y2 < h && rowInk[y2] >= rowMin) y2++;
    if (y2 - y >= 4) {
      let ink = 0;
      let sum = 0;
      for (let yy = y; yy < y2; yy++) {
        ink += rowInk[yy];
        sum += rowLumSum[yy];
      }
      if (sum / Math.max(1, ink) <= 105) {
        for (let yy = y; yy < y2; yy++) protectRow[yy] = 1;
      }
    }
    y = y2;
  }

  const block = 48;
  const blocksX = Math.ceil(w / block);
  const blocksY = Math.ceil(h / block);
  const paperR = new Float64Array(blocksX * blocksY);
  const paperG = new Float64Array(blocksX * blocksY);
  const paperB = new Float64Array(blocksX * blocksY);
  const paperN = new Uint32Array(blocksX * blocksY);
  const colorN = new Uint32Array(blocksX * blocksY);
  const blockArea = new Uint32Array(blocksX * blocksY);

  for (let py = 0; py < h; py++) {
    const by = Math.min(blocksY - 1, (py / block) | 0);
    for (let px = 0; px < w; px++) {
      const bx = Math.min(blocksX - 1, (px / block) | 0);
      const bi = by * blocksX + bx;
      blockArea[bi]++;
      const p = py * w + px;
      const i = p * 4;
      if (chroma[p] > 48) colorN[bi]++;
      if (lum[p] > 205 && chroma[p] < 28) {
        paperR[bi] += od[i];
        paperG[bi] += od[i + 1];
        paperB[bi] += od[i + 2];
        paperN[bi]++;
      }
    }
  }

  const editLumAt = (i: number) =>
    0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2];

  // Grow map masks from blocks that are mostly color, so a corner that only
  // fills part of a block stays with the map instead of being cleared as a pen stroke.
  const isColor = new Uint8Array(n);
  const keepColor = new Uint8Array(n);
  const queue: number[] = [];
  for (let p = 0; p < n; p++) {
    if (chroma[p] <= 46 || lum[p] >= 230) continue;
    isColor[p] = 1;
    const px = p % w;
    const py = (p / w) | 0;
    const bi =
      Math.min(blocksY - 1, (py / block) | 0) * blocksX +
      Math.min(blocksX - 1, (px / block) | 0);
    if (colorN[bi] / Math.max(1, blockArea[bi]) < 0.35) continue;
    keepColor[p] = 1;
    queue.push(p);
  }
  for (let q = 0; q < queue.length; q++) {
    const p = queue[q];
    const px = p % w;
    const py = (p / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = py + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = px + dx;
        if (nx < 0 || nx >= w) continue;
        const np = ny * w + nx;
        if (!isColor[np] || keepColor[np]) continue;
        keepColor[np] = 1;
        queue.push(np);
      }
    }
  }

  for (let py = 0; py < h; py++) {
    const by = Math.min(blocksY - 1, (py / block) | 0);
    const rowProtected = protectRow[py] === 1;
    for (let px = 0; px < w; px++) {
      const p = py * w + px;
      const i = p * 4;
      const bx = Math.min(blocksX - 1, (px / block) | 0);
      const bi = by * blocksX + bx;
      const isPrinted = printed[p] === 1 && rowProtected;

      if (isPrinted && editLumAt(i) > lum[p] + 22) {
        out[i] = od[i];
        out[i + 1] = od[i + 1];
        out[i + 2] = od[i + 2];
        continue;
      }

      if (keepColor[p]) {
        const er = out[i];
        const eg = out[i + 1];
        const eb = out[i + 2];
        const eC = Math.max(er, eg, eb) - Math.min(er, eg, eb);
        if (eC + 18 < chroma[p] || editLumAt(i) > lum[p] + 22) {
          out[i] = od[i];
          out[i + 1] = od[i + 1];
          out[i + 2] = od[i + 2];
        }
        continue;
      }

      if (!isPrinted && isColor[p]) {
        const samples = paperN[bi];
        if (samples > 8) {
          out[i] = Math.round(paperR[bi] / samples);
          out[i + 1] = Math.round(paperG[bi] / samples);
          out[i + 2] = Math.round(paperB[bi] / samples);
        } else {
          out[i] = 255;
          out[i + 1] = 255;
          out[i + 2] = 255;
        }
      }
    }
  }

  editCtx.putImageData(editData, 0, 0);
  return editCanvas.toDataURL("image/jpeg", 0.92);
}

export interface Point {
  x: number;
  y: number;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Content class for a paint-select island */
export type RegionKind = "text" | "diagram";

export interface LabeledCropRect extends CropRect {
  kind: RegionKind;
}

export const FALLBACK_PERSPECTIVE_CORNERS: [Point, Point, Point, Point] = [
  { x: 0.06, y: 0.06 },
  { x: 0.94, y: 0.06 },
  { x: 0.94, y: 0.94 },
  { x: 0.06, y: 0.94 },
];

export const FULL_FRAME_CORNERS: [Point, Point, Point, Point] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

export function cropBoxFromCorners(corners: [Point, Point, Point, Point]): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x = Math.max(0, Math.min(...xs));
  const y = Math.max(0, Math.min(...ys));
  const x2 = Math.min(1, Math.max(...xs));
  const y2 = Math.min(1, Math.max(...ys));
  return {
    x,
    y,
    w: Math.min(1 - x, Math.max(0.05, x2 - x)),
    h: Math.min(1 - y, Math.max(0.05, y2 - y)),
  };
}

function clampByteIndex(v: number, max: number) {
  return v < 0 ? 0 : v > max ? max : v;
}

function otsuThreshold(values: Float32Array): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < values.length; i++) {
    hist[Math.max(0, Math.min(255, values[i] | 0))] += 1;
  }
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 160;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const diff = mB - mF;
    const v = wB * wF * diff * diff;
    if (v > maxVar) {
      maxVar = v;
      threshold = t;
    }
  }
  return threshold;
}

function blurLuminance(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const diam = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const row = y * w;
    for (let x = -radius; x <= radius; x++) {
      acc += src[row + clampByteIndex(x, w - 1)];
    }
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / diam;
      acc +=
        src[row + clampByteIndex(x + radius + 1, w - 1)] -
        src[row + clampByteIndex(x - radius, w - 1)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -radius; y <= radius; y++) {
      acc += tmp[clampByteIndex(y, h - 1) * w + x];
    }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / diam;
      acc +=
        tmp[clampByteIndex(y + radius + 1, h - 1) * w + x] -
        tmp[clampByteIndex(y - radius, h - 1) * w + x];
    }
  }
  return out;
}

function quadArea(corners: [Point, Point, Point, Point]): number {
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const p = corners[i];
    const q = corners[(i + 1) % 4];
    area += p.x * q.y - q.x * p.y;
  }
  return Math.abs(area) / 2;
}

function isPlausiblePaperQuad(corners: [Point, Point, Point, Point]): boolean {
  const [tl, tr, br, bl] = corners;
  if (tr.x - tl.x < 0.12 || br.x - bl.x < 0.12) return false;
  if (bl.y - tl.y < 0.12 || br.y - tr.y < 0.12) return false;
  return quadArea(corners) >= 0.1;
}

function dilateMask(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(src);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!src[y * w + x]) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          out[ny * w + nx] = 1;
        }
      }
    }
  }
  return out;
}

/**
 * Find the four near-white paper corners of an exam photo.
 * Order: [Top-Left, Top-Right, Bottom-Right, Bottom-Left], normalized 0–1.
 */
export function detectNearWhitePaperCorners(
  img: HTMLImageElement,
  maxSide = 360
): [Point, Point, Point, Point] {
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  if (natW < 16 || natH < 16) return FALLBACK_PERSPECTIVE_CORNERS;

  const scale = Math.min(1, maxSide / Math.max(natW, natH));
  const w = Math.max(48, Math.round(natW * scale));
  const h = Math.max(48, Math.round(natH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return FALLBACK_PERSPECTIVE_CORNERS;

  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const lum = new Float32Array(w * h);
  const chroma = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    lum[p] = 0.299 * r + 0.587 * g + 0.114 * b;
    const maxC = r > g ? (r > b ? r : b) : g > b ? g : b;
    const minC = r < g ? (r < b ? r : b) : g < b ? g : b;
    chroma[p] = maxC - minC;
  }

  const blurred = blurLuminance(lum, w, h, 2);
  const otsu = otsuThreshold(blurred);
  // Shadowed corners (especially bottom-left) sit below a hard 145 floor.
  const paperLum = Math.min(195, Math.max(otsu * 0.82, 118));
  const maxChroma = 96;

  const rawMask = new Uint8Array(w * h);
  let paperCount = 0;
  for (let i = 0; i < rawMask.length; i++) {
    const nearWhite = blurred[i] >= paperLum && chroma[i] <= maxChroma;
    const shadowedPaper = blurred[i] >= paperLum * 0.88 && chroma[i] <= 110;
    if (nearWhite || shadowedPaper) {
      rawMask[i] = 1;
      paperCount += 1;
    }
  }

  const cover = paperCount / rawMask.length;
  // Almost no paper detected — keep the 6% inset fallback.
  if (cover < 0.08) return FALLBACK_PERSPECTIVE_CORNERS;
  // Paper fills nearly the whole frame (common on phone close-ups):
  // corners ≈ image edge, not the looser 6% inset used when background is visible.
  if (cover > 0.97) {
    return [
      { x: 0.012, y: 0.012 },
      { x: 0.988, y: 0.012 },
      { x: 0.988, y: 0.988 },
      { x: 0.012, y: 0.988 },
    ];
  }

  const mask = dilateMask(rawMask, w, h);

  const nw = Math.max(1, w - 1);
  const nh = Math.max(1, h - 1);
  let minSum = Infinity;
  let maxSum = -Infinity;
  let minDiff = Infinity;
  let maxDiff = -Infinity;
  const tl = { x: 0, y: 0 };
  const tr = { x: w - 1, y: 0 };
  const br = { x: w - 1, y: h - 1 };
  const bl = { x: 0, y: h - 1 };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      // Normalize so portrait photos don't let "more bottom" beat "more left".
      const nx = x / nw;
      const ny = y / nh;
      const sum = nx + ny;
      const diff = nx - ny;
      if (sum < minSum) {
        minSum = sum;
        tl.x = x;
        tl.y = y;
      }
      if (diff > maxDiff) {
        maxDiff = diff;
        tr.x = x;
        tr.y = y;
      }
      if (sum > maxSum) {
        maxSum = sum;
        br.x = x;
        br.y = y;
      }
      if (diff < minDiff) {
        minDiff = diff;
        bl.x = x;
        bl.y = y;
      }
    }
  }

  if (!Number.isFinite(minSum) || !Number.isFinite(maxSum)) {
    return FALLBACK_PERSPECTIVE_CORNERS;
  }

  const snapToward = (
    p: { x: number; y: number },
    tx: number,
    ty: number
  ): { x: number; y: number } => {
    const dx = tx - p.x;
    const dy = ty - p.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
    let last = { x: p.x, y: p.y };
    for (let i = 1; i <= steps; i++) {
      const x = Math.round(p.x + (dx * i) / steps);
      const y = Math.round(p.y + (dy * i) / steps);
      if (x < 0 || y < 0 || x >= w || y >= h) break;
      if (!mask[y * w + x]) break;
      last = { x, y };
    }
    return last;
  };

  const snappedTl = snapToward(tl, 0, 0);
  const snappedTr = snapToward(tr, w - 1, 0);
  const snappedBr = snapToward(br, w - 1, h - 1);
  const snappedBl = snapToward(bl, 0, h - 1);

  const cx = (snappedTl.x + snappedTr.x + snappedBr.x + snappedBl.x) / 4;
  const cy = (snappedTl.y + snappedTr.y + snappedBr.y + snappedBl.y) / 4;
  const inset = Math.max(1, Math.hypot(w, h) * 0.006);

  const pull = (p: { x: number; y: number }): Point => {
    const dx = cx - p.x;
    const dy = cy - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const t = Math.min(inset, len * 0.04);
    return {
      x: Math.min(0.995, Math.max(0.005, (p.x + (dx / len) * t) / w)),
      y: Math.min(0.995, Math.max(0.005, (p.y + (dy / len) * t) / h)),
    };
  };

  const corners: [Point, Point, Point, Point] = [
    pull(snappedTl),
    pull(snappedTr),
    pull(snappedBr),
    pull(snappedBl),
  ];

  return isPlausiblePaperQuad(corners) ? corners : FALLBACK_PERSPECTIVE_CORNERS;
}

/**
 * Applies 4-point perspective warp (Homography) to straighten skewed test papers
 * corners order: [Top-Left, Top-Right, Bottom-Right, Bottom-Left]
 */
export async function applyPerspectiveCorrection(
  imageSrc: string,
  corners: [Point, Point, Point, Point],
  outputMaxWidth = PRINT_SOURCE_MAX_EDGE,
  outputMaxHeight = PRINT_SOURCE_MAX_EDGE,
  quality = 0.94
): Promise<string> {
  const normSrc = normalizeImageSrc(imageSrc);
  if (!normSrc) return "";

  return new Promise((resolve) => {
    const img = new Image();
    if (normSrc.startsWith("http://") || normSrc.startsWith("https://")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => {
      try {
        const natW = img.naturalWidth || img.width || 800;
        const natH = img.naturalHeight || img.height || 600;

        // Auto-scale if corners were supplied as normalized [0, 1]
        const isNormalized = corners.every((p) => p.x <= 1.05 && p.y <= 1.05);
        const [p0, p1, p2, p3] = isNormalized
          ? [
              { x: corners[0].x * natW, y: corners[0].y * natH },
              { x: corners[1].x * natW, y: corners[1].y * natH },
              { x: corners[2].x * natW, y: corners[2].y * natH },
              { x: corners[3].x * natW, y: corners[3].y * natH },
            ]
          : corners;

        // Calculate destination dimensions from corner distances
        const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
        const wTop = dist(p0, p1);
        const wBot = dist(p3, p2);
        const hLeft = dist(p0, p3);
        const hRight = dist(p1, p2);

        let destW = Math.max(40, Math.round(Math.max(wTop, wBot)));
        let destH = Math.max(40, Math.round(Math.max(hLeft, hRight)));

        if (destW > outputMaxWidth || destH > outputMaxHeight) {
          if (destW / destH > outputMaxWidth / outputMaxHeight) {
            destH = Math.round((destH * outputMaxWidth) / destW);
            destW = outputMaxWidth;
          } else {
            destW = Math.round((destW * outputMaxHeight) / destH);
            destH = outputMaxHeight;
          }
        }

        // Draw original image to source canvas to extract pixels
        const srcCanvas = document.createElement("canvas");
        srcCanvas.width = natW;
        srcCanvas.height = natH;
        const srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true });
        if (!srcCtx) {
          resolve(normSrc);
          return;
        }
        // Fill white background first for transparency
        srcCtx.fillStyle = "#ffffff";
        srcCtx.fillRect(0, 0, natW, natH);
        srcCtx.drawImage(img, 0, 0, natW, natH);

        const srcImgData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
        const srcPixels = srcImgData.data;
        const srcW = srcCanvas.width;
        const srcH = srcCanvas.height;

        // Destination canvas
        const dstCanvas = document.createElement("canvas");
        dstCanvas.width = destW;
        dstCanvas.height = destH;
        const dstCtx = dstCanvas.getContext("2d");
        if (!dstCtx) {
          resolve(normSrc);
          return;
        }
        const dstImgData = dstCtx.createImageData(destW, destH);
        const dstPixels = dstImgData.data;

        // Solve Projective Homography from Unit Square [0, 1]x[0, 1] -> [p0, p1, p2, p3]
        const x0 = p0.x, y0 = p0.y;
        const x1 = p1.x, y1 = p1.y;
        const x2 = p2.x, y2 = p2.y;
        const x3 = p3.x, y3 = p3.y;

        const dx1 = x1 - x2;
        const dx2 = x3 - x2;
        const sx = x0 - x1 + x2 - x3;
        const dy1 = y1 - y2;
        const dy2 = y3 - y2;
        const sy = y0 - y1 + y2 - y3;

        const det = dx1 * dy2 - dx2 * dy1;

        let a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number;

        if (Math.abs(det) < 1e-7) {
          g = 0;
          h = 0;
          a = x1 - x0;
          b = x3 - x0;
          c = x0;
          d = y1 - y0;
          e = y3 - y0;
          f = y0;
        } else {
          g = (sx * dy2 - sy * dx2) / det;
          h = (dx1 * sy - dy1 * sx) / det;
          a = x1 - x0 + g * x1;
          b = x3 - x0 + h * x3;
          c = x0;
          d = y1 - y0 + g * y1;
          e = y3 - y0 + h * y3;
          f = y0;
        }

        // Loop over destination pixels and map back to source with bilinear interpolation
        let dstIdx = 0;
        for (let v = 0; v < destH; v++) {
          const t = v / destH;
          for (let u = 0; u < destW; u++) {
            const s = u / destW;
            const denom = g * s + h * t + 1;
            const srcX = (a * s + b * t + c) / denom;
            const srcY = (d * s + e * t + f) / denom;

            if (srcX < 0 || srcX >= srcW - 1 || srcY < 0 || srcY >= srcH - 1) {
              const clampX = Math.max(0, Math.min(srcW - 1, Math.round(srcX)));
              const clampY = Math.max(0, Math.min(srcH - 1, Math.round(srcY)));
              const sIdx = (clampY * srcW + clampX) * 4;
              dstPixels[dstIdx] = srcPixels[sIdx];
              dstPixels[dstIdx + 1] = srcPixels[sIdx + 1];
              dstPixels[dstIdx + 2] = srcPixels[sIdx + 2];
              dstPixels[dstIdx + 3] = 255;
            } else {
              const ix0 = Math.floor(srcX);
              const iy0 = Math.floor(srcY);
              const ix1 = ix0 + 1;
              const iy1 = iy0 + 1;
              const fx = srcX - ix0;
              const fy = srcY - iy0;
              const w00 = (1 - fx) * (1 - fy);
              const w10 = fx * (1 - fy);
              const w01 = (1 - fx) * fy;
              const w11 = fx * fy;

              const idx00 = (iy0 * srcW + ix0) * 4;
              const idx10 = (iy0 * srcW + ix1) * 4;
              const idx01 = (iy1 * srcW + ix0) * 4;
              const idx11 = (iy1 * srcW + ix1) * 4;

              dstPixels[dstIdx] = Math.round(
                srcPixels[idx00] * w00 +
                  srcPixels[idx10] * w10 +
                  srcPixels[idx01] * w01 +
                  srcPixels[idx11] * w11
              );
              dstPixels[dstIdx + 1] = Math.round(
                srcPixels[idx00 + 1] * w00 +
                  srcPixels[idx10 + 1] * w10 +
                  srcPixels[idx01 + 1] * w01 +
                  srcPixels[idx11 + 1] * w11
              );
              dstPixels[dstIdx + 2] = Math.round(
                srcPixels[idx00 + 2] * w00 +
                  srcPixels[idx10 + 2] * w10 +
                  srcPixels[idx01 + 2] * w01 +
                  srcPixels[idx11 + 2] * w11
              );
              dstPixels[dstIdx + 3] = 255;
            }
            dstIdx += 4;
          }
        }

        dstCtx.putImageData(dstImgData, 0, 0);
        resolve(dstCanvas.toDataURL("image/jpeg", quality));
      } catch (err) {
        console.error("Perspective correction failed:", err);
        resolve(imageSrc);
      }
    };
    img.onerror = () => resolve(imageSrc);
    img.src = normalizeImageSrc(imageSrc);
  });
}

function cropLoadedImage(
  img: HTMLImageElement,
  cropRect: CropRect,
  quality: number,
  fallbackSrc: string
): string {
  const natW = img.naturalWidth || img.width || 800;
  const natH = img.naturalHeight || img.height || 600;

  const looksNormalized =
    cropRect.x >= 0 &&
    cropRect.y >= 0 &&
    cropRect.width > 0 &&
    cropRect.height > 0 &&
    cropRect.x <= 1.0001 &&
    cropRect.y <= 1.0001 &&
    cropRect.width <= 1.0001 &&
    cropRect.height <= 1.0001;

  const rawX = looksNormalized ? cropRect.x * natW : cropRect.x;
  const rawY = looksNormalized ? cropRect.y * natH : cropRect.y;
  const rawW = looksNormalized ? cropRect.width * natW : cropRect.width;
  const rawH = looksNormalized ? cropRect.height * natH : cropRect.height;

  const cropX = Math.max(0, Math.min(natW - 5, Math.round(rawX)));
  const cropY = Math.max(0, Math.min(natH - 5, Math.round(rawY)));
  const cropW = Math.max(10, Math.min(natW - cropX, Math.round(rawW)));
  const cropH = Math.max(10, Math.min(natH - cropY, Math.round(rawH)));

  const canvas = document.createElement("canvas");
  canvas.width = cropW;
  canvas.height = cropH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return fallbackSrc;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cropW, cropH);
  ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  return canvas.toDataURL("image/jpeg", quality);
}

/**
 * Free cropping of a specified rectangle from an image.
 * Prefer the on-screen img element so the crop matches what the user framed.
 */
export async function applyCrop(
  imageSrc: string,
  cropRect: CropRect,
  quality = 0.92,
  sourceEl?: HTMLImageElement | null
): Promise<string> {
  const normSrc = normalizeImageSrc(imageSrc);
  if (!normSrc) return "";

  if (sourceEl?.complete && (sourceEl.naturalWidth || sourceEl.width) > 0) {
    try {
      return cropLoadedImage(sourceEl, cropRect, quality, normSrc);
    } catch (err) {
      console.error("Crop from displayed image failed:", err);
    }
  }

  return new Promise((resolve) => {
    const img = new Image();
    if (normSrc.startsWith("http://") || normSrc.startsWith("https://")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => {
      try {
        resolve(cropLoadedImage(img, cropRect, quality, normSrc));
      } catch (err) {
        console.error("Crop failed:", err);
        resolve(normSrc);
      }
    };
    img.onerror = () => resolve(normSrc);
    img.src = normSrc;
  });
}

/**
 * Tap-to-select: find a text line / tight paragraph (or content blob) under a
 * normalized point, returned as a crop rect with light padding.
 */
export function detectTextBlockAtPoint(
  img: HTMLImageElement,
  nx: number,
  ny: number,
  maxSide = 720
): CropRect | null {
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  if (natW < 8 || natH < 8) return null;

  const scale = Math.min(1, maxSide / Math.max(natW, natH));
  const w = Math.max(32, Math.round(natW * scale));
  const h = Math.max(32, Math.round(natH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const lum = new Float32Array(w * h);
  let lumSum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const v = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    lum[p] = v;
    lumSum += v;
  }
  const avgLum = lumSum / (w * h);
  const inkCut = Math.min(168, Math.max(90, avgLum * 0.72));

  const ink = new Uint8Array(w * h);
  for (let p = 0; p < ink.length; p++) {
    ink[p] = lum[p] < inkCut ? 1 : 0;
  }

  const sx = Math.max(0, Math.min(w - 1, Math.round(nx * (w - 1))));
  const sy = Math.max(0, Math.min(h - 1, Math.round(ny * (h - 1))));

  // Nearest ink pixel near the tap (finger is imprecise)
  const searchR = Math.max(8, Math.round(Math.min(w, h) * 0.045));
  let seedX = -1;
  let seedY = -1;
  let bestD = Infinity;
  for (let dy = -searchR; dy <= searchR; dy++) {
    for (let dx = -searchR; dx <= searchR; dx++) {
      const x = sx + dx;
      const y = sy + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if (!ink[y * w + x]) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        seedX = x;
        seedY = y;
      }
    }
  }
  if (seedX < 0) {
    // No ink: small box around tap so diagrams/light marks can still be framed
    const box = Math.max(0.06, Math.min(w, h) * 0.08 / Math.min(w, h));
    return {
      x: Math.max(0, nx - box * 0.7),
      y: Math.max(0, ny - box * 0.45),
      width: Math.min(1 - Math.max(0, nx - box * 0.7), box * 1.4),
      height: Math.min(1 - Math.max(0, ny - box * 0.45), box * 0.9),
    };
  }

  const rowHasInkInBand = (y: number, x0: number, x1: number): boolean => {
    if (y < 0 || y >= h) return false;
    const lo = Math.max(0, x0);
    const hi = Math.min(w - 1, x1);
    let hits = 0;
    for (let x = lo; x <= hi; x++) {
      if (ink[y * w + x]) {
        hits++;
        if (hits >= 2) return true;
      }
    }
    return hits > 0;
  };

  // Expand horizontally on the seed row with small gap tolerance (spaces between chars)
  const gapTol = Math.max(3, Math.round(w * 0.018));
  let xMin = seedX;
  let xMax = seedX;
  let gap = 0;
  for (let x = seedX - 1; x >= 0; x--) {
    if (ink[seedY * w + x]) {
      xMin = x;
      gap = 0;
    } else if (++gap > gapTol) break;
  }
  gap = 0;
  for (let x = seedX + 1; x < w; x++) {
    if (ink[seedY * w + x]) {
      xMax = x;
      gap = 0;
    } else if (++gap > gapTol) break;
  }

  // Estimate line height around seed
  let yTop = seedY;
  let yBot = seedY;
  while (yTop > 0 && rowHasInkInBand(yTop - 1, xMin, xMax)) yTop--;
  while (yBot < h - 1 && rowHasInkInBand(yBot + 1, xMin, xMax)) yBot++;
  let lineH = Math.max(4, yBot - yTop + 1);

  // Grow into neighboring lines (paragraph), stop on blank gap or size cap
  const maxBlockH = Math.round(h * 0.28);
  const blankLimit = Math.max(2, Math.round(lineH * 0.85));
  let blank = 0;
  for (let y = yTop - 1; y >= 0 && yBot - y + 1 < maxBlockH; y--) {
    if (rowHasInkInBand(y, xMin - gapTol, xMax + gapTol)) {
      // widen x to this line
      for (let x = xMin; x >= 0; x--) {
        if (ink[y * w + x]) xMin = x;
        else if (xMin - x > gapTol) break;
      }
      for (let x = xMax; x < w; x++) {
        if (ink[y * w + x]) xMax = x;
        else if (x - xMax > gapTol) break;
      }
      yTop = y;
      blank = 0;
      lineH = Math.max(lineH, yBot - yTop + 1);
    } else if (++blank > blankLimit) break;
  }
  blank = 0;
  for (let y = yBot + 1; y < h && y - yTop + 1 < maxBlockH; y++) {
    if (rowHasInkInBand(y, xMin - gapTol, xMax + gapTol)) {
      for (let x = xMin; x >= 0; x--) {
        if (ink[y * w + x]) xMin = x;
        else if (xMin - x > gapTol) break;
      }
      for (let x = xMax; x < w; x++) {
        if (ink[y * w + x]) xMax = x;
        else if (x - xMax > gapTol) break;
      }
      yBot = y;
      blank = 0;
    } else if (++blank > blankLimit) break;
  }

  // If the block is nearly square / bulky, treat as diagram blob: flood around seed
  const bw = xMax - xMin + 1;
  const bh = yBot - yTop + 1;
  if (bh > lineH * 2.8 && bw < bh * 1.35) {
    const visited = new Uint8Array(w * h);
    const qx: number[] = [seedX];
    const qy: number[] = [seedY];
    visited[seedY * w + seedX] = 1;
    let qi = 0;
    let fx0 = seedX;
    let fy0 = seedY;
    let fx1 = seedX;
    let fy1 = seedY;
    const maxR2 = Math.pow(Math.min(w, h) * 0.22, 2);
    while (qi < qx.length) {
      const cx = qx[qi];
      const cy = qy[qi];
      qi++;
      fx0 = Math.min(fx0, cx);
      fy0 = Math.min(fy0, cy);
      fx1 = Math.max(fx1, cx);
      fy1 = Math.max(fy1, cy);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx2 = cx + dx;
          const ny2 = cy + dy;
          if (nx2 < 0 || ny2 < 0 || nx2 >= w || ny2 >= h) continue;
          const idx = ny2 * w + nx2;
          if (visited[idx] || !ink[idx]) continue;
          const ddx = nx2 - seedX;
          const ddy = ny2 - seedY;
          if (ddx * ddx + ddy * ddy > maxR2) continue;
          visited[idx] = 1;
          qx.push(nx2);
          qy.push(ny2);
        }
      }
    }
    if (qx.length > 12) {
      xMin = fx0;
      xMax = fx1;
      yTop = fy0;
      yBot = fy1;
    }
  }

  const padX = Math.max(2, Math.round(w * 0.012));
  const padY = Math.max(2, Math.round(h * 0.01));
  const rx0 = Math.max(0, xMin - padX);
  const ry0 = Math.max(0, yTop - padY);
  const rx1 = Math.min(w - 1, xMax + padX);
  const ry1 = Math.min(h - 1, yBot + padY);

  return {
    x: rx0 / w,
    y: ry0 / h,
    width: Math.max(0.04, (rx1 - rx0 + 1) / w),
    height: Math.max(0.03, (ry1 - ry0 + 1) / h),
  };
}

/** Bounding box of one paint stroke (normalized), with brush padding. */
export function strokeToCropRect(
  stroke: Point[],
  brushNorm: number,
  padExtra = 0.015
): CropRect | null {
  if (!stroke.length) return null;
  const pad = brushNorm + padExtra;
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const p of stroke) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const x = Math.max(0, minX - pad);
  const y = Math.max(0, minY - pad);
  const x2 = Math.min(1, maxX + pad);
  const y2 = Math.min(1, maxY + pad);
  return {
    x,
    y,
    width: Math.max(0.04, x2 - x),
    height: Math.max(0.04, y2 - y),
  };
}

/**
 * Fit a tight crop rect to printed content along a finger stroke.
 * Only ink / diagram pixels near the stroke are included — avoids oversized highlighter boxes.
 */
export function tightCropRectAlongStroke(
  img: HTMLImageElement,
  stroke: Point[],
  corridorNorm = 0.02,
  maxSide = 720
): CropRect | null {
  if (!stroke.length) return null;
  const fallback = strokeToCropRect(stroke, corridorNorm * 0.45, 0.008);
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  if (natW < 8 || natH < 8) return fallback;

  const scale = Math.min(1, maxSide / Math.max(natW, natH));
  const w = Math.max(32, Math.round(natW * scale));
  const h = Math.max(32, Math.round(natH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return fallback;
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const pts = stroke.map((p) => ({
    x: Math.max(0, Math.min(w - 1, p.x * (w - 1))),
    y: Math.max(0, Math.min(h - 1, p.y * (h - 1))),
  }));

  let lumSum = 0;
  const lum = new Float32Array(w * h);
  const chroma = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const v = 0.299 * r + 0.587 * g + 0.114 * b;
    lum[p] = v;
    lumSum += v;
    const maxC = r > g ? (r > b ? r : b) : g > b ? g : b;
    const minC = r < g ? (r < b ? r : b) : g < b ? g : b;
    chroma[p] = maxC - minC;
  }
  const avgLum = lumSum / (w * h);
  const inkCut = Math.min(172, Math.max(95, avgLum * 0.74));

  const corridorR = Math.max(3, Math.round(Math.min(w, h) * corridorNorm));
  const corridorR2 = corridorR * corridorR;

  const distToStroke2 = (x: number, y: number): number => {
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const dx = x - pts[i].x;
      const dy = y - pts[i].y;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
      if (i + 1 < pts.length) {
        const ax = pts[i].x;
        const ay = pts[i].y;
        const bx = pts[i + 1].x;
        const by = pts[i + 1].y;
        const vx = bx - ax;
        const vy = by - ay;
        const len2 = vx * vx + vy * vy || 1;
        let t = ((x - ax) * vx + (y - ay) * vy) / len2;
        t = Math.max(0, Math.min(1, t));
        const px = ax + t * vx - x;
        const py = ay + t * vy - y;
        const seg = px * px + py * py;
        if (seg < best) best = seg;
      }
    }
    return best;
  };

  // Bounding box of stroke corridor first (limits scan)
  let sx0 = w;
  let sy0 = h;
  let sx1 = 0;
  let sy1 = 0;
  for (const p of pts) {
    sx0 = Math.min(sx0, Math.floor(p.x - corridorR));
    sy0 = Math.min(sy0, Math.floor(p.y - corridorR));
    sx1 = Math.max(sx1, Math.ceil(p.x + corridorR));
    sy1 = Math.max(sy1, Math.ceil(p.y + corridorR));
  }
  sx0 = Math.max(0, sx0);
  sy0 = Math.max(0, sy0);
  sx1 = Math.min(w - 1, sx1);
  sy1 = Math.min(h - 1, sy1);

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let hit = 0;

  for (let y = sy0; y <= sy1; y++) {
    for (let x = sx0; x <= sx1; x++) {
      if (distToStroke2(x, y) > corridorR2) continue;
      const idx = y * w + x;
      const isInk = lum[idx] < inkCut;
      const isDiagram = chroma[idx] >= 28 && lum[idx] < avgLum + 12;
      if (!isInk && !isDiagram) continue;
      hit++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (hit < 8 || maxX < minX) {
    return fallback;
  }

  // Slightly expand horizontally on content rows so full characters are included
  const expandX = Math.max(2, Math.round(w * 0.006));
  for (let y = minY; y <= maxY; y++) {
    let rowMin = maxX;
    let rowMax = minX;
    for (let x = minX; x <= maxX; x++) {
      const idx = y * w + x;
      if (lum[idx] < inkCut || (chroma[idx] >= 28 && lum[idx] < avgLum + 12)) {
        if (x < rowMin) rowMin = x;
        if (x > rowMax) rowMax = x;
      }
    }
    if (rowMax < rowMin) continue;
    for (let x = rowMin - 1; x >= Math.max(0, rowMin - expandX); x--) {
      if (lum[y * w + x] < inkCut) rowMin = x;
      else break;
    }
    for (let x = rowMax + 1; x <= Math.min(w - 1, rowMax + expandX); x++) {
      if (lum[y * w + x] < inkCut) rowMax = x;
      else break;
    }
    minX = Math.min(minX, rowMin);
    maxX = Math.max(maxX, rowMax);
  }

  const padX = Math.max(1, Math.round(w * 0.006));
  const padY = Math.max(1, Math.round(h * 0.005));
  const rx0 = Math.max(0, minX - padX);
  const ry0 = Math.max(0, minY - padY);
  const rx1 = Math.min(w - 1, maxX + padX);
  const ry1 = Math.min(h - 1, maxY + padY);

  return {
    x: rx0 / w,
    y: ry0 / h,
    width: Math.max(0.02, (rx1 - rx0 + 1) / w),
    height: Math.max(0.015, (ry1 - ry0 + 1) / h),
  };
}

function rectsNearOrOverlap(a: CropRect, b: CropRect, gap: number): boolean {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  return !(ax2 + gap < b.x || bx2 + gap < a.x || ay2 + gap < b.y || by2 + gap < a.y);
}

/**
 * Classify a crop island as printed text vs diagram/map using chroma & ink stats.
 */
export function classifyCropRegion(
  img: HTMLImageElement,
  rect: CropRect,
  maxSide = 280
): RegionKind {
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  if (natW < 8 || natH < 8 || rect.width <= 0 || rect.height <= 0) return "text";

  const rw = Math.max(8, Math.round(rect.width * natW));
  const rh = Math.max(8, Math.round(rect.height * natH));
  const scale = Math.min(1, maxSide / Math.max(rw, rh));
  const w = Math.max(8, Math.round(rw * scale));
  const h = Math.max(8, Math.round(rh * scale));
  const sx = Math.max(0, Math.round(rect.x * natW));
  const sy = Math.max(0, Math.round(rect.y * natH));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "text";
  ctx.drawImage(img, sx, sy, rw, rh, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  let lumSum = 0;
  let chromaSum = 0;
  const n = w * h;
  const lum = new Float32Array(n);
  const chroma = new Uint8Array(n);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const v = 0.299 * r + 0.587 * g + 0.114 * b;
    lum[p] = v;
    lumSum += v;
    const c = Math.max(r, g, b) - Math.min(r, g, b);
    chroma[p] = c;
    chromaSum += c;
  }
  const avgLum = lumSum / n;
  const avgChroma = chromaSum / n;
  const inkCut = Math.min(172, Math.max(95, avgLum * 0.74));

  let ink = 0;
  let diagram = 0;
  for (let p = 0; p < n; p++) {
    const isInk = lum[p] < inkCut && chroma[p] < 40;
    const isDiagram = chroma[p] >= 26 && lum[p] < avgLum + 18;
    if (isInk) ink++;
    if (isDiagram) diagram++;
  }

  const content = Math.max(1, ink + diagram);
  const diagramRatio = diagram / content;
  const inkRatio = ink / n;

  // Colorful / map-like patches
  if (diagramRatio >= 0.2 || avgChroma >= 20) return "diagram";
  // Sparse ink with some color (washed maps, light fills)
  if (inkRatio < 0.045 && avgChroma >= 12) return "diagram";
  // Squarish region with moderate chroma → often a small map card
  const aspect = rect.width / Math.max(1e-6, rect.height);
  if (avgChroma >= 14 && aspect > 0.55 && aspect < 1.85 && diagramRatio >= 0.12) {
    return "diagram";
  }
  return "text";
}

/**
 * Merge multi-line text (or diagram) islands of the same kind only.
 * Never glue a text island to a map/diagram island.
 */
function shouldMergePaintIslands(
  a: LabeledCropRect,
  b: LabeledCropRect,
  mergeGap: number
): boolean {
  if (a.kind !== b.kind) return false;

  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;

  const overlapX = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const overlapY = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const gapY = Math.max(0, Math.max(a.y, b.y) - Math.min(ay2, by2));
  const gapX = Math.max(0, Math.max(a.x, b.x) - Math.min(ax2, bx2));
  const minW = Math.min(a.width, b.width);
  const minArea = Math.min(a.width * a.height, b.width * b.height);

  // Substantial area overlap → same painted island
  if (overlapX > 0 && overlapY > 0) {
    return overlapX * overlapY >= minArea * 0.22;
  }

  // Vertically stacked with column alignment (multi-line stem text)
  if (gapY <= mergeGap && overlapX >= minW * 0.4) return true;

  // Same-kind diagrams that sit in one row with a tiny gap may still merge
  if (a.kind === "diagram" && gapX <= mergeGap && overlapY >= Math.min(a.height, b.height) * 0.4) {
    return true;
  }

  return false;
}

function unionRects(a: CropRect, b: CropRect): CropRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.width, b.x + b.width);
  const y2 = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: x2 - x, height: y2 - y };
}

/** Merge nearby / overlapping crop rects (text lines); distant islands stay separate. */
export function mergeNearbyCropRects(rects: CropRect[], mergeGap = 0.035): CropRect[] {
  if (!rects.length) return [];
  let current = rects.map((r) => ({ ...r }));
  let changed = true;
  while (changed) {
    changed = false;
    const next: CropRect[] = [];
    const used = new Set<number>();
    for (let i = 0; i < current.length; i++) {
      if (used.has(i)) continue;
      let acc = { ...current[i] };
      for (let j = i + 1; j < current.length; j++) {
        if (used.has(j)) continue;
        if (rectsNearOrOverlap(acc, current[j], mergeGap)) {
          acc = unionRects(acc, current[j]);
          used.add(j);
          changed = true;
        }
      }
      used.add(i);
      next.push(acc);
    }
    current = next;
  }
  return current;
}

/** Merge stacked same-kind islands only — never glue text to diagram. */
export function mergePaintIslandRects(
  rects: LabeledCropRect[],
  mergeGap = 0.035
): LabeledCropRect[] {
  if (!rects.length) return [];
  let current = rects.map((r) => ({ ...r }));
  let changed = true;
  while (changed) {
    changed = false;
    const next: LabeledCropRect[] = [];
    const used = new Set<number>();
    for (let i = 0; i < current.length; i++) {
      if (used.has(i)) continue;
      let acc = { ...current[i] };
      for (let j = i + 1; j < current.length; j++) {
        if (used.has(j)) continue;
        if (shouldMergePaintIslands(acc, current[j], mergeGap)) {
          const u = unionRects(acc, current[j]);
          acc = { ...u, kind: acc.kind };
          used.add(j);
          changed = true;
        }
      }
      used.add(i);
      next.push(acc);
    }
    current = next;
  }
  return current;
}

/**
 * Cluster paint strokes into one or more rectangles for a single question.
 * Nearby / overlapping strokes (e.g. multi-line text) merge; distant islands
 * (e.g. stem vs map at bottom-right) stay as separate rects.
 */
export function clusterPaintStrokesToRects(
  strokes: Point[][],
  brushNorm: number,
  mergeGap = 0.05
): CropRect[] {
  const seed = strokes
    .map((s) => strokeToCropRect(s, brushNorm))
    .filter((r): r is CropRect => Boolean(r));
  return mergeNearbyCropRects(seed, mergeGap);
}

/**
 * Shrink `subject` so it no longer overlaps `obstacle`, keeping the largest remnant.
 * Used so 文字區 / 圖區 never share the same pixels after dual paint-select.
 */
export function carveRectAwayFrom(subject: CropRect, obstacle: CropRect): CropRect {
  const ox1 = Math.max(subject.x, obstacle.x);
  const oy1 = Math.max(subject.y, obstacle.y);
  const ox2 = Math.min(subject.x + subject.width, obstacle.x + obstacle.width);
  const oy2 = Math.min(subject.y + subject.height, obstacle.y + obstacle.height);
  const ow = ox2 - ox1;
  const oh = oy2 - oy1;
  if (ow <= 1e-6 || oh <= 1e-6) return { ...subject };

  const candidates: CropRect[] = [];
  // Keep strip below overlap
  if (subject.y + subject.height > oy2 + 1e-6) {
    candidates.push({
      x: subject.x,
      y: oy2,
      width: subject.width,
      height: subject.y + subject.height - oy2,
    });
  }
  // Keep strip above overlap
  if (oy1 > subject.y + 1e-6) {
    candidates.push({
      x: subject.x,
      y: subject.y,
      width: subject.width,
      height: oy1 - subject.y,
    });
  }
  // Keep strip to the right of overlap
  if (subject.x + subject.width > ox2 + 1e-6) {
    candidates.push({
      x: ox2,
      y: subject.y,
      width: subject.x + subject.width - ox2,
      height: subject.height,
    });
  }
  // Keep strip to the left of overlap
  if (ox1 > subject.x + 1e-6) {
    candidates.push({
      x: subject.x,
      y: subject.y,
      width: ox1 - subject.x,
      height: subject.height,
    });
  }

  if (!candidates.length) {
    return { x: subject.x, y: subject.y, width: 0, height: 0 };
  }
  candidates.sort((a, b) => b.width * b.height - a.width * a.height);
  return candidates[0];
}

const MIN_SEPARATED_SIDE = 0.012;

/** Ensure text / diagram islands never overlap. Prefer carving diagram; if that
 *  would destroy the diagram (e.g. fully inside text), carve text instead. */
export function separateDifferentKindRects(rects: LabeledCropRect[]): LabeledCropRect[] {
  if (rects.length < 2) return rects.map((r) => ({ ...r }));
  const result = rects.map((r) => ({ ...r }));

  for (let i = 0; i < result.length; i++) {
    for (let j = i + 1; j < result.length; j++) {
      if (result[i].kind === result[j].kind) continue;
      const textIdx = result[i].kind === "text" ? i : result[j].kind === "text" ? j : -1;
      const diagramIdx =
        result[i].kind === "diagram" ? i : result[j].kind === "diagram" ? j : -1;
      if (textIdx < 0 || diagramIdx < 0) continue;

      const text = result[textIdx];
      const diagram = result[diagramIdx];
      const carvedDiagram = carveRectAwayFrom(diagram, text);
      const diagramSurvives =
        carvedDiagram.width >= MIN_SEPARATED_SIDE &&
        carvedDiagram.height >= MIN_SEPARATED_SIDE;

      if (diagramSurvives) {
        result[diagramIdx] = { ...carvedDiagram, kind: "diagram" };
        continue;
      }

      // Diagram fully covered by text — shrink text so the painted map remains
      const carvedText = carveRectAwayFrom(text, diagram);
      const textSurvives =
        carvedText.width >= MIN_SEPARATED_SIDE &&
        carvedText.height >= MIN_SEPARATED_SIDE;
      if (textSurvives) {
        result[textIdx] = { ...carvedText, kind: "text" };
      } else {
        // Nested both ways / tiny remnants — keep the larger island only
        const textArea = text.width * text.height;
        const diagramArea = diagram.width * diagram.height;
        if (diagramArea >= textArea) {
          result[textIdx] = { ...text, width: 0, height: 0 };
        } else {
          result[diagramIdx] = { ...diagram, width: 0, height: 0 };
        }
      }
    }
  }

  return result.filter(
    (r) => r.width >= MIN_SEPARATED_SIDE && r.height >= MIN_SEPARATED_SIDE
  );
}

export interface InkLineBounds {
  /** Inclusive pixel bounds in the ink mask. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Snap a finger stroke to the text it actually crosses.
 * Horizontal extent follows the stroke: halfway across a line boxes that half,
 * and two characters stay two characters. Vertical extent is the glyph height
 * of those characters, so the rows above and below stay outside the box.
 * Pixel coords, inclusive.
 */
export function textLineRectFromInk(
  ink: Uint8Array,
  w: number,
  h: number,
  stroke: Point[],
  searchR: number
): InkLineBounds | null {
  if (w < 2 || h < 2 || !stroke.length) return null;
  const radius = Math.max(2, Math.round(searchR));
  const radius2 = radius * radius;
  // Bridge character side-bearings, but not a wide column gutter.
  const gapTol = Math.max(4, Math.round(w * 0.028));
  // Finish a glyph the finger crosses through the middle. The weak-row stop,
  // not this cap, is what keeps the next line out.
  const maxExtra = Math.max(12, Math.round(Math.min(w, h) * 0.05));

  const decimated: Point[] = [];
  for (const p of stroke) {
    const x = Math.max(0, Math.min(w - 1, p.x));
    const y = Math.max(0, Math.min(h - 1, p.y));
    const prev = decimated[decimated.length - 1];
    if (!prev) {
      decimated.push({ x, y });
      continue;
    }
    const dx = x - prev.x;
    const dy = y - prev.y;
    if (dx * dx + dy * dy >= 4) decimated.push({ x, y });
  }
  const last = stroke[stroke.length - 1];
  const tail = decimated[decimated.length - 1];
  if (tail && (Math.abs(tail.x - last.x) > 0.5 || Math.abs(tail.y - last.y) > 0.5)) {
    decimated.push({
      x: Math.max(0, Math.min(w - 1, last.x)),
      y: Math.max(0, Math.min(h - 1, last.y)),
    });
  }

  const rowMin = new Int16Array(h);
  const rowMax = new Int16Array(h);
  rowMin.fill(-1);
  rowMax.fill(-1);

  // Ignore a stray point far from the stroke's main band so one glitch
  // cannot stretch the box from the swiped line to the rest of the page.
  const bandYs = decimated.map((p) => p.y).sort((a, b) => a - b);
  const yLo = bandYs[Math.floor((bandYs.length - 1) * 0.1)] ?? 0;
  const yHi = bandYs[Math.ceil((bandYs.length - 1) * 0.9)] ?? h - 1;
  const yGate = Math.max(radius * 1.25, (yHi - yLo) * 0.5);
  const bandLo = yLo - yGate;
  const bandHi = yHi + yGate;

  for (const p of decimated) {
    if (p.y < bandLo || p.y > bandHi) continue;
    const x0 = Math.max(0, Math.floor(p.x - radius));
    const y0 = Math.max(0, Math.floor(p.y - radius));
    const x1 = Math.min(w - 1, Math.ceil(p.x + radius));
    const y1 = Math.min(h - 1, Math.ceil(p.y + radius));
    let bestD = radius2 + 1;
    let bestX = -1;
    let bestY = -1;
    for (let y = y0; y <= y1; y++) {
      const row = y * w;
      const dy = y - p.y;
      for (let x = x0; x <= x1; x++) {
        if (!ink[row + x]) continue;
        const dx = x - p.x;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          bestX = x;
          bestY = y;
        }
      }
    }
    if (bestX < 0) continue;
    if (rowMin[bestY] < 0 || bestX < rowMin[bestY]) rowMin[bestY] = bestX;
    if (bestX > rowMax[bestY]) rowMax[bestY] = bestX;
  }

  const countRowInk = (y: number, x0: number, x1: number): number => {
    if (y < 0 || y >= h) return 0;
    const lo = Math.max(0, x0);
    const hi = Math.min(w - 1, x1);
    let hits = 0;
    for (let x = lo; x <= hi; x++) {
      if (ink[y * w + x]) hits++;
    }
    return hits;
  };

  const columnHasInk = (x: number, top: number, bot: number): boolean => {
    if (x < 0 || x >= w) return false;
    const yLo = Math.max(0, top);
    const yHi = Math.min(h - 1, bot);
    for (let yy = yLo; yy <= yHi; yy++) {
      if (ink[yy * w + x]) return true;
    }
    return false;
  };

  /**
   * Finish the glyphs under the stroke ends. Stop at the first real gap so the
   * next character, and the rest of the line, stay outside the box.
   */
  const finishSwipedGlyphs = (
    left: number,
    right: number,
    top: number,
    bot: number
  ): [number, number] => {
    const glyphGap = 1;
    let xMin = left;
    let xMax = right;
    let gap = 0;
    for (let x = left - 1; x >= 0; x--) {
      if (columnHasInk(x, top, bot)) {
        xMin = x;
        gap = 0;
      } else if (++gap > glyphGap) break;
    }
    gap = 0;
    for (let x = right + 1; x < w; x++) {
      if (columnHasInk(x, top, bot)) {
        xMax = x;
        gap = 0;
      } else if (++gap > glyphGap) break;
    }
    const glyph = Math.max(6, bot - top + 1);
    const cap = Math.round(glyph * 0.55);
    xMin = Math.max(xMin, left - cap);
    xMax = Math.min(xMax, right + cap);
    return [xMin, xMax];
  };

  /**
   * Grow through the glyph, then stop. A faint gap is the next line — do not
   * skip it. The threshold comes from this line's own rows, not the neighbor.
   */
  const growVertically = (
    top: number,
    bot: number,
    xMin: number,
    xMax: number,
    originTop: number,
    originBot: number
  ): [number, number] => {
    let peak = 0;
    for (let y = top; y <= bot; y++) peak = Math.max(peak, countRowInk(y, xMin, xMax));
    for (let d = 1; d <= 2; d++) {
      if (top - d >= 0) peak = Math.max(peak, countRowInk(top - d, xMin, xMax));
      if (bot + d < h) peak = Math.max(peak, countRowInk(bot + d, xMin, xMax));
    }
    const need = Math.max(4, Math.round(peak * 0.22));
    const rowOk = (y: number) => countRowInk(y, xMin, xMax) >= need;

    let nextTop = top;
    let nextBot = bot;
    for (let yy = top - 1; yy >= Math.max(0, originTop - maxExtra); yy--) {
      if (!rowOk(yy)) break;
      nextTop = yy;
    }
    for (let yy = bot + 1; yy <= Math.min(h - 1, originBot + maxExtra); yy++) {
      if (!rowOk(yy)) break;
      nextBot = yy;
    }
    return [nextTop, nextBot];
  };

  const bands: InkLineBounds[] = [];

  let y = 0;
  while (y < h) {
    if (rowMin[y] < 0) {
      y++;
      continue;
    }
    let y0 = y;
    let y1 = y;
    let look = y;
    let hole = 0;
    let seedL = rowMin[y];
    let seedR = rowMax[y];
    while (look + 1 < h) {
      if (rowMin[look + 1] >= 0) {
        look++;
        y1 = look;
        hole = 0;
        if (rowMin[look] < seedL) seedL = rowMin[look];
        if (rowMax[look] > seedR) seedR = rowMax[look];
      } else if (hole < 2) {
        // Bridge a stroke miss inside the glyph. A real line gap has no ink.
        const bridgeL = Math.max(0, seedL - gapTol);
        const bridgeR = Math.min(w - 1, seedR + gapTol);
        const bridgePeak = Math.max(
          countRowInk(y0, bridgeL, bridgeR),
          countRowInk(y1, bridgeL, bridgeR)
        );
        const bridgeNeed = Math.max(4, Math.round(bridgePeak * 0.22));
        if (countRowInk(look + 1, bridgeL, bridgeR) < bridgeNeed) break;
        hole++;
        look++;
      } else break;
    }

    if (seedR < seedL) {
      y = y1 + 1;
      continue;
    }

    const localL = Math.max(0, seedL - 2);
    const localR = Math.min(w - 1, seedR + 2);
    let [top, bot] = growVertically(y0, y1, localL, localR, y0, y1);

    const spanPts = decimated.filter((p) => p.y >= y0 - radius && p.y <= y1 + radius);
    const span = spanPts.length ? spanPts : decimated;
    let xMin = Math.max(0, Math.floor(Math.min(...span.map((p) => p.x))));
    let xMax = Math.min(w - 1, Math.ceil(Math.max(...span.map((p) => p.x))));
    while (xMin < xMax && !columnHasInk(xMin, top, bot)) xMin++;
    while (xMax > xMin && !columnHasInk(xMax, top, bot)) xMax--;
    if (!columnHasInk(xMin, top, bot) && !columnHasInk(xMax, top, bot)) {
      xMin = seedL;
      xMax = seedR;
    }
    [xMin, xMax] = finishSwipedGlyphs(xMin, xMax, top, bot);
    [top, bot] = growVertically(top, bot, xMin, xMax, y0, y1);

    bands.push({ x0: xMin, y0: top, x1: xMax, y1: bot });
    y = Math.max(y1 + 1, bot + 1);
  }

  if (!bands.length) return null;

  // Search radius can tag the line above or below. Keep a band only when the
  // finger itself enters it, then union just those lines.
  const slop = Math.max(2, Math.round(radius * 0.3));
  const strokeYs = decimated.map((p) => p.y);
  const overlapsStroke = (band: InkLineBounds) =>
    strokeYs.some((sy) => sy >= band.y0 - slop && sy <= band.y1 + slop);
  let chosen = bands.filter(overlapsStroke);
  if (!chosen.length) {
    const mid = strokeYs[Math.floor(strokeYs.length / 2)] ?? strokeYs[0];
    let best = bands[0];
    let bestD = Infinity;
    for (const band of bands) {
      const cy = (band.y0 + band.y1) / 2;
      const d = Math.abs(cy - mid);
      if (d < bestD) {
        bestD = d;
        best = band;
      }
    }
    chosen = [best];
  }

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (const band of chosen) {
    minX = Math.min(minX, band.x0);
    maxX = Math.max(maxX, band.x1);
    minY = Math.min(minY, band.y0);
    maxY = Math.max(maxY, band.y1);
  }
  if (maxX < minX || maxY < minY) return null;
  return { x0: minX, y0: minY, x1: maxX, y1: maxY };
}

/**
 * 選文字：滑到哪就框到哪。橫向只包住手指經過的字，直向只含那些字的字高。
 * 沒掃到墨跡時退回筆畫外框。
 */
export function textLineCropAlongStroke(
  img: HTMLImageElement,
  stroke: Point[],
  corridorNorm = 0.02,
  maxSide = 720
): CropRect | null {
  if (!stroke.length) return null;
  const fallback = strokeToCropRect(stroke, corridorNorm * 0.45, 0.008);
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  if (natW < 8 || natH < 8) return fallback;

  const scale = Math.min(1, maxSide / Math.max(natW, natH));
  const w = Math.max(32, Math.round(natW * scale));
  const h = Math.max(32, Math.round(natH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return fallback;
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const lum = new Float32Array(w * h);
  let lumSum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const v = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    lum[p] = v;
    lumSum += v;
  }
  const avgLum = lumSum / (w * h);
  const inkCut = Math.min(168, Math.max(90, avgLum * 0.72));
  const ink = new Uint8Array(w * h);
  for (let p = 0; p < ink.length; p++) ink[p] = lum[p] < inkCut ? 1 : 0;

  const pts = stroke.map((p) => ({
    x: Math.max(0, Math.min(w - 1, p.x * (w - 1))),
    y: Math.max(0, Math.min(h - 1, p.y * (h - 1))),
  }));
  const searchR = Math.max(5, Math.round(Math.min(w, h) * corridorNorm));
  const bounds = textLineRectFromInk(ink, w, h, pts, searchR);
  if (!bounds) return fallback;

  const padX = Math.max(1, Math.round(Math.min(w, h) * 0.003));
  // Keep vertical padding inside the line gap so the box does not cover the next row.
  const padY = Math.max(1, Math.round(Math.min(w, h) * 0.003));
  const rx0 = Math.max(0, bounds.x0 - padX);
  const ry0 = Math.max(0, bounds.y0 - padY);
  const rx1 = Math.min(w - 1, bounds.x1 + padX);
  const ry1 = Math.min(h - 1, bounds.y1 + padY);
  return {
    x: rx0 / w,
    y: ry0 / h,
    width: Math.max(0.012, (rx1 - rx0 + 1) / w),
    height: Math.max(0.01, (ry1 - ry0 + 1) / h),
  };
}

/**
 * Build tight content-aware rects from paint strokes (text one island, diagram another).
 * 選文字 boxes only the glyphs the finger crosses; 選圖形 stays a tight ink corridor.
 * Prefer explicit per-stroke kinds (UI 選文字／選圖形); otherwise auto-classify.
 * Different kinds never merge, and final rects are separated so they do not overlap.
 */
export function clusterTightStrokeRects(
  img: HTMLImageElement,
  strokes: Point[][],
  corridorNorm = 0.02,
  mergeGap = 0.035,
  strokeKinds?: Array<RegionKind | undefined>
): LabeledCropRect[] {
  const seed = strokes
    .map((s, i) => {
      const forced = strokeKinds?.[i];
      const r =
        forced === "text"
          ? textLineCropAlongStroke(img, s, Math.max(corridorNorm, 0.02))
          : tightCropRectAlongStroke(img, s, corridorNorm);
      if (!r) return null;
      const kind: RegionKind =
        forced === "text" || forced === "diagram"
          ? forced
          : classifyCropRegion(img, r);
      return { ...r, kind };
    })
    .filter((r): r is LabeledCropRect => Boolean(r));
  const merged = mergePaintIslandRects(seed, mergeGap);
  const separated = separateDifferentKindRects(merged);
  // Text blocks first (reading order), then diagrams
  return separated.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "text" ? -1 : 1;
    return Math.abs(a.y - b.y) > 0.04 ? a.y - b.y : a.x - b.x;
  });
}

export function unionCropRects(rects: CropRect[]): CropRect | null {
  if (!rects.length) return null;
  return rects.reduce((acc, r) => unionRects(acc, r));
}

type PixelPatch = {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  cx: number;
  cy: number;
  kind: RegionKind;
};

export type MultiRegionCropOptions = {
  /** Show 文字區／圖區 chips above each panel (default true). */
  showLabels?: boolean;
};

/**
 * Crop one question that may span multiple rectangular islands (stem + map).
 * Packs each island as its own tight panel (stacked) instead of one giant bbox.
 */
export async function applyMultiRegionCrop(
  imageSrc: string,
  regions: Array<CropRect | LabeledCropRect>,
  quality = 0.92,
  options: MultiRegionCropOptions = {}
): Promise<string> {
  const showLabels = options.showLabels !== false;
  const normSrc = normalizeImageSrc(imageSrc);
  if (!normSrc || !regions.length) return "";
  if (regions.length === 1) {
    return applyCrop(normSrc, regions[0], quality);
  }

  return new Promise((resolve) => {
    const img = new Image();
    if (normSrc.startsWith("http://") || normSrc.startsWith("https://")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (w < 2 || h < 2) {
          resolve(normSrc);
          return;
        }

        const patches: PixelPatch[] = regions.map((r) => {
          const sx = Math.max(0, Math.round(r.x * w));
          const sy = Math.max(0, Math.round(r.y * h));
          const sw = Math.max(1, Math.min(w - sx, Math.round(r.width * w)));
          const sh = Math.max(1, Math.min(h - sy, Math.round(r.height * h)));
          const kind: RegionKind =
            "kind" in r && (r.kind === "text" || r.kind === "diagram")
              ? r.kind
              : classifyCropRegion(img, r);
          return {
            sx,
            sy,
            sw,
            sh,
            cx: r.x + r.width / 2,
            cy: r.y + r.height / 2,
            kind,
          };
        });

        // Text blocks first, then diagrams (stable reading order within kind)
        patches.sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === "text" ? -1 : 1;
          return Math.abs(a.cy - b.cy) > 0.06 ? a.cy - b.cy : a.cx - b.cx;
        });

        const labelH = showLabels
          ? Math.max(18, Math.round(Math.min(w, h) * 0.014))
          : 0;
        const gutter = Math.max(16, Math.round(Math.min(w, h) * 0.02));
        const pad = Math.max(12, Math.round(Math.min(w, h) * 0.012));
        const paper = "#e8e6de";
        const border = "#64748b";
        const labels = patches.map((p, i) =>
          p.kind === "diagram" ? "圖區" : p.kind === "text" ? "文字區" : `範圍 ${i + 1}`
        );

        const maxW = Math.max(...patches.map((p) => p.sw));
        const canvasW = pad * 2 + maxW;
        const canvasH =
          pad * 2 +
          patches.reduce((s, p) => s + labelH + p.sh, 0) +
          gutter * (patches.length - 1);

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, canvasW);
        canvas.height = Math.max(1, canvasH);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(normSrc);
          return;
        }

        ctx.fillStyle = paper;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        let cursorY = pad;
        for (let i = 0; i < patches.length; i++) {
          const p = patches[i];
          const panelW = maxW;
          const dx = pad;
          const dy = cursorY + labelH;

          if (showLabels) {
            ctx.fillStyle = p.kind === "diagram" ? "#0369a1" : "#0f766e";
            const chipW = Math.min(panelW, Math.max(56, labels[i].length * 14 + 16));
            ctx.beginPath();
            ctx.roundRect(dx, cursorY, chipW, labelH - 2, 4);
            ctx.fill();
            ctx.fillStyle = "#ffffff";
            ctx.font = `bold ${Math.max(11, Math.round(labelH * 0.62))}px sans-serif`;
            ctx.textBaseline = "middle";
            ctx.fillText(labels[i], dx + 8, cursorY + (labelH - 2) / 2);
          }

          // Panel
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(dx, dy, panelW, p.sh);
          ctx.strokeStyle = border;
          ctx.lineWidth = 2;
          ctx.strokeRect(dx + 0.5, dy + 0.5, panelW - 1, p.sh - 1);

          const imgX = dx + Math.round((panelW - p.sw) / 2);
          ctx.drawImage(img, p.sx, p.sy, p.sw, p.sh, imgX, dy, p.sw, p.sh);

          cursorY += labelH + p.sh + gutter;
        }

        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch (err) {
        console.error("Multi-region crop failed:", err);
        resolve(normSrc);
      }
    };
    img.onerror = () => resolve(normSrc);
    img.src = normSrc;
  });
}

/**
 * Crop only diagram / map islands (no text panels) for PDF「僅排版文字」附圖.
 */
export async function cropFigureRegionsOnly(
  imageSrc: string,
  regions: LabeledCropRect[],
  quality = 0.95
): Promise<string | undefined> {
  const diagrams = regions.filter((r) => r.kind === "diagram");
  if (!diagrams.length) return undefined;
  if (diagrams.length === 1) {
    const one = await applyCrop(imageSrc, diagrams[0], quality);
    return one || undefined;
  }
  const packed = await applyMultiRegionCrop(imageSrc, diagrams, quality, {
    showLabels: false,
  });
  return packed || undefined;
}

export interface BrushStroke {
  /** Normalized points in [0, 1] image space */
  points: Point[];
  /** Brush radius as a fraction of min(imageWidth, imageHeight) */
  radiusNorm: number;
}

/**
 * Paint opaque white brush strokes onto an image (for covering handwritten answers).
 */
export async function paintWhiteBrushOnImage(
  imageSrc: string,
  stroke: BrushStroke,
  quality = 0.92
): Promise<string> {
  const normSrc = normalizeImageSrc(imageSrc);
  if (!normSrc || !stroke.points.length) return normSrc;

  return new Promise((resolve) => {
    const img = new Image();
    if (normSrc.startsWith("http://") || normSrc.startsWith("https://")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (w < 2 || h < 2) {
          resolve(normSrc);
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(normSrc);
          return;
        }
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        const radius = Math.max(4, Math.min(w, h) * stroke.radiusNorm);
        ctx.strokeStyle = "#ffffff";
        ctx.fillStyle = "#ffffff";
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = radius * 2;

        const pts = stroke.points;
        if (pts.length === 1) {
          ctx.beginPath();
          ctx.arc(pts[0].x * w, pts[0].y * h, radius, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(pts[0].x * w, pts[0].y * h);
          for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x * w, pts[i].y * h);
          }
          ctx.stroke();
        }

        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch (err) {
        console.error("White brush paint failed:", err);
        resolve(normSrc);
      }
    };
    img.onerror = () => resolve(normSrc);
    img.src = normSrc;
  });
}

/**
 * Rotates an image by 90, -90, or 180 degrees
 */
export async function rotateImage(
  imageSrc: string,
  angleDegrees: number,
  quality = 0.92
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    if (imageSrc.startsWith("http://") || imageSrc.startsWith("https://")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => {
      try {
        const rad = (angleDegrees * Math.PI) / 180;
        const isSwap = Math.abs(angleDegrees % 180) === 90;
        const srcW = img.naturalWidth || img.width;
        const srcH = img.naturalHeight || img.height;
        const w = isSwap ? srcH : srcW;
        const h = isSwap ? srcW : srcH;

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(imageSrc);
          return;
        }

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.translate(w / 2, h / 2);
        ctx.rotate(rad);
        ctx.drawImage(img, -srcW / 2, -srcH / 2);

        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch (err) {
        console.error("Rotation failed:", err);
        resolve(imageSrc);
      }
    };
    img.onerror = () => resolve(imageSrc);
    img.src = normalizeImageSrc(imageSrc);
  });
}

export type ShadowRemovalMode = "pure_bw" | "clean_gray" | "clean_color";

export interface ShadowRemovalOptions {
  mode?: ShadowRemovalMode;
  contrast?: number; // 1.0 - 1.8 default 1.25
  whiteLevel?: number; // 0.80 - 0.95 default 0.88
  blackLevel?: number; // 0.35 - 0.60 default 0.46
  quality?: number; // jpeg quality default 0.92
}

/**
 * 試卷照片去除陰影演算法：將黃光、檯燈與手機陰影去除，轉為純白底黑字（掃描儀高對比文件效果）
 * 演算法步驟：
 * 1. 降採樣估算背景光照場 (Downsample Illumination Map)
 * 2. 形態學局部最大值濾波 (Local Max Dilation) 消除細黑字筆畫，萃取紙張底色
 * 3. 盒狀平滑模糊 (Smooth Box Blur) 獲得連續背景光照曲面
 * 4. 雙線性插值估算每個畫素的局部背景亮度並作反射率除法正規化 (Ratio = Y / Background)
 * 5. 自適應閥值與平滑抗鋸齒曲線映射，使紙張底色 100% 潔白 (#FFFFFF)，筆墨字跡深黑 (#000000)
 */
export async function removeShadowsAndBinarize(
  imageSrc: string,
  options: ShadowRemovalOptions = {}
): Promise<string> {
  const {
    mode = "pure_bw",
    contrast = 1.25,
    whiteLevel = 0.88,
    blackLevel = 0.46,
    quality = 0.92,
  } = options;

  return new Promise((resolve) => {
    const img = new Image();
    if (imageSrc.startsWith("http://") || imageSrc.startsWith("https://")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) {
          resolve(imageSrc);
          return;
        }

        // Full resolution canvas
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          resolve(imageSrc);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;

        // Downscale to estimate illumination (approx 120-160px max dimension)
        const scaleFactor = Math.min(1, 140 / Math.max(w, h));
        const sw = Math.max(16, Math.round(w * scaleFactor));
        const sh = Math.max(16, Math.round(h * scaleFactor));

        const sCanvas = document.createElement("canvas");
        sCanvas.width = sw;
        sCanvas.height = sh;
        const sCtx = sCanvas.getContext("2d", { willReadFrequently: true });
        if (!sCtx) {
          resolve(imageSrc);
          return;
        }
        sCtx.drawImage(img, 0, 0, sw, sh);
        const sData = sCtx.getImageData(0, 0, sw, sh);
        const sPixels = sData.data;

        // Extract grayscale buffer for illumination
        const illum = new Float32Array(sw * sh);
        for (let i = 0; i < sw * sh; i++) {
          const idx = i * 4;
          // Grayscale luminance
          illum[i] = 0.299 * sPixels[idx] + 0.587 * sPixels[idx + 1] + 0.114 * sPixels[idx + 2];
        }

        // Morphological dilation (local max filter radius = 2) on downscaled map
        // This fills in dark text and thin lines with surrounding paper color
        const dilated = new Float32Array(sw * sh);
        const r = 2;
        for (let y = 0; y < sh; y++) {
          const yMin = Math.max(0, y - r);
          const yMax = Math.min(sh - 1, y + r);
          for (let x = 0; x < sw; x++) {
            const xMin = Math.max(0, x - r);
            const xMax = Math.min(sw - 1, x + r);
            let maxVal = 0;
            for (let ny = yMin; ny <= yMax; ny++) {
              const rowOffset = ny * sw;
              for (let nx = xMin; nx <= xMax; nx++) {
                const val = illum[rowOffset + nx];
                if (val > maxVal) maxVal = val;
              }
            }
            dilated[y * sw + x] = maxVal;
          }
        }

        // Smooth box blur (radius = 3) on the dilated illumination map
        const blurred = new Float32Array(sw * sw ? sw * sh : 0);
        const blurR = 3;
        for (let y = 0; y < sh; y++) {
          const yMin = Math.max(0, y - blurR);
          const yMax = Math.min(sh - 1, y + blurR);
          for (let x = 0; x < sw; x++) {
            const xMin = Math.max(0, x - blurR);
            const xMax = Math.min(sw - 1, x + blurR);
            let sum = 0;
            let count = 0;
            for (let ny = yMin; ny <= yMax; ny++) {
              const rowOffset = ny * sw;
              for (let nx = xMin; nx <= xMax; nx++) {
                sum += dilated[rowOffset + nx];
                count++;
              }
            }
            blurred[y * sw + x] = sum / (count || 1);
          }
        }

        // Bilinear sample helper from blurred illumination map
        const getIllum = (nx: number, ny: number): number => {
          const px = nx * (sw - 1);
          const py = ny * (sh - 1);
          const x0 = Math.floor(px);
          const y0 = Math.floor(py);
          const x1 = Math.min(sw - 1, x0 + 1);
          const y1 = Math.min(sh - 1, y0 + 1);
          const fx = px - x0;
          const fy = py - y0;

          const v00 = blurred[y0 * sw + x0];
          const v10 = blurred[y0 * sw + x1];
          const v01 = blurred[y1 * sw + x0];
          const v11 = blurred[y1 * sw + x1];

          const top = v00 + fx * (v10 - v00);
          const bottom = v01 + fx * (v11 - v01);
          const result = top + fy * (bottom - top);
          return Math.max(30, result);
        };

        const range = Math.max(0.01, whiteLevel - blackLevel);

        // Transform each pixel
        for (let y = 0; y < h; y++) {
          const ny = y / (h - 1 || 1);
          const rowOffset = y * w * 4;

          for (let x = 0; x < w; x++) {
            const nx = x / (w - 1 || 1);
            const idx = rowOffset + x * 4;

            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];

            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            const bg = getIllum(nx, ny);

            // Normalized ratio (paper is approx 1.0, dark ink is < 0.6)
            const ratio = lum / bg;

            if (mode === "pure_bw") {
              // Whitening threshold: anything above whiteLevel is pure 255 white
              // Black threshold: anything below blackLevel is 0 deep black
              let t = (ratio - blackLevel) / range;
              if (t <= 0) t = 0;
              else if (t >= 1) t = 1;
              else {
                t = Math.pow(t, contrast);
              }
              const val = Math.round(t * 255);
              data[idx] = val;
              data[idx + 1] = val;
              data[idx + 2] = val;
            } else if (mode === "clean_gray") {
              let t = ratio >= whiteLevel ? 1 : Math.pow(Math.max(0, ratio / whiteLevel), contrast);
              const val = Math.min(255, Math.max(0, Math.round(t * 255)));
              data[idx] = val;
              data[idx + 1] = val;
              data[idx + 2] = val;
            } else if (mode === "clean_color") {
              const factor = 255 / bg;
              let nr = Math.min(255, r * factor);
              let ng = Math.min(255, g * factor);
              let nb = Math.min(255, b * factor);

              if (ratio >= whiteLevel) {
                nr = 255;
                ng = 255;
                nb = 255;
              } else {
                const normLum = 0.299 * nr + 0.587 * ng + 0.114 * nb;
                const t = Math.max(0, Math.min(1, (normLum - 40) / (255 * whiteLevel - 40)));
                const inkBoost = Math.pow(t, contrast);
                nr = Math.round(nr * inkBoost);
                ng = Math.round(ng * inkBoost);
                nb = Math.round(nb * inkBoost);
              }

              data[idx] = Math.min(255, Math.max(0, nr));
              data[idx + 1] = Math.min(255, Math.max(0, ng));
              data[idx + 2] = Math.min(255, Math.max(0, nb));
            }
          }
        }

        ctx.putImageData(imgData, 0, 0);
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch (err) {
        console.error("Shadow removal failed:", err);
        resolve(imageSrc);
      }
    };
    img.onerror = () => resolve(imageSrc);
    img.src = normalizeImageSrc(imageSrc);
  });
}
