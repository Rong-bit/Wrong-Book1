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
 * Compresses an image file or base64 string to a crisp, storage-friendly JPEG data URL.
 * Automatically supports HEIC/HEIF images (e.g. from iPhone / iPad cameras).
 * Max dimension: 1600px (crystal clear for 300dpi printing and high-res monitors).
 * File size typically reduced from 5MB~10MB down to 100KB~250KB.
 */
export async function compressImage(
  fileOrBase64: File | Blob | string,
  maxWidth = 1600,
  maxHeight = 1600,
  quality = 0.88
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

        // Draw image onto canvas
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

/**
 * Applies 4-point perspective warp (Homography) to straighten skewed test papers
 * corners order: [Top-Left, Top-Right, Bottom-Right, Bottom-Left]
 */
export async function applyPerspectiveCorrection(
  imageSrc: string,
  corners: [Point, Point, Point, Point],
  outputMaxWidth = 1800,
  outputMaxHeight = 1800,
  quality = 0.92
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

/**
 * Free cropping of a specified rectangle from an image
 */
export async function applyCrop(
  imageSrc: string,
  cropRect: CropRect,
  quality = 0.92
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

        // Auto-scale if cropRect was supplied as normalized [0, 1]
        const isNorm = cropRect.width <= 1.05 && cropRect.height <= 1.05;
        const rawX = isNorm ? cropRect.x * natW : cropRect.x;
        const rawY = isNorm ? cropRect.y * natH : cropRect.y;
        const rawW = isNorm ? cropRect.width * natW : cropRect.width;
        const rawH = isNorm ? cropRect.height * natH : cropRect.height;

        const cropX = Math.max(0, Math.min(natW - 5, Math.round(rawX)));
        const cropY = Math.max(0, Math.min(natH - 5, Math.round(rawY)));
        const cropW = Math.max(
          10,
          Math.min(natW - cropX, Math.round(rawW))
        );
        const cropH = Math.max(
          10,
          Math.min(natH - cropY, Math.round(rawH))
        );

        const canvas = document.createElement("canvas");
        canvas.width = cropW;
        canvas.height = cropH;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(normSrc);
          return;
        }

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, cropW, cropH);
        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

        resolve(canvas.toDataURL("image/jpeg", quality));
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
