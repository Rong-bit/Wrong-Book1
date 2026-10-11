import { QuestionItem } from "../types";

/**
 * Detect questions that depend on a printed figure / map / diagram.
 * Used so "僅排版文字" still attaches the screenshot when text alone is insufficient.
 */
export function questionDependsOnFigure(questionText: string): boolean {
  const t = (questionText || "").replace(/\s+/g, "");
  if (!t) return false;
  return /附圖|下圖|上圖|左圖|右圖|如圖|圖中|見圖|看圖|圖示|示意圖|地圖|座標圖|剖面圖|分布圖|氣候圖|等高線|附圖中|下列圖|各圖|圖為|圖一|圖二|圖三|圖四|本圖|該圖|此圖|看左圖|看右圖/.test(
    t
  );
}

/**
 * In text-only PDF mode: keep the crop when the stem needs a figure,
 * or when OCR text is essentially missing (photo is the only content).
 */
export function shouldShowFigureInTextOnlyMode(
  q: Pick<QuestionItem, "questionText" | "imageBase64" | "imageSettings" | "figureImageBase64">
): boolean {
  if (q.imageSettings && q.imageSettings.includeInExport === false) return false;
  // Dedicated diagram crop from 選圖形 → always attach in text-only mode
  if (q.figureImageBase64) return true;
  if (!q.imageBase64) return false;
  const t = (q.questionText || "").trim();
  if (!t || t.length < 10) return true;
  return questionDependsOnFigure(t);
}

/**
 * Image to show beside layout text in「僅排版文字」mode.
 * Prefer figure-only crop; never prefer the dual text+diagram composite when a
 * dedicated figure exists.
 */
export function getTextOnlyFigureSrc(
  q: Pick<QuestionItem, "imageBase64" | "figureImageBase64" | "imageSettings" | "questionText">
): string | null {
  if (q.imageSettings && q.imageSettings.includeInExport === false) return null;
  if (q.figureImageBase64) return q.figureImageBase64;
  // Legacy questions without figureImageBase64: fall back to full image when needed
  if (shouldShowFigureInTextOnlyMode(q) && q.imageBase64) return q.imageBase64;
  return null;
}
