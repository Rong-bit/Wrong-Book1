import { QuestionItem } from "../types";

/**
 * Detect questions that depend on a printed figure / map / diagram.
 */
export function questionDependsOnFigure(questionText: string): boolean {
  const t = (questionText || "").replace(/\s+/g, "");
  if (!t) return false;
  return /附圖|下圖|上圖|左圖|右圖|如圖|圖中|見圖|看圖|圖示|示意圖|地圖|座標圖|剖面圖|分布圖|氣候圖|等高線|附圖中|下列圖|各圖|圖為|圖一|圖二|圖三|圖四|本圖|該圖|此圖|看左圖|看右圖/.test(
    t
  );
}

/**
 * Whether this question finished OCR with a dedicated figure field
 * (string including "" = explicit none). Safe to drop the stem screenshot.
 */
export function canReleaseTextScreenshot(
  q: Pick<QuestionItem, "status" | "questionText" | "imageBase64" | "figureImageBase64">
): boolean {
  if (q.status !== "ready") return false;
  if (!q.questionText?.trim()) return false;
  if (typeof q.figureImageBase64 !== "string") return false;
  return Boolean(q.imageBase64);
}

/**
 * Clear the stem / dual-panel screenshot after successful OCR when a figure
 * field was already split out. Keeps figureImageBase64 (including "").
 */
export function releaseTextScreenshot<
  T extends Pick<QuestionItem, "status" | "questionText" | "imageBase64" | "figureImageBase64">
>(q: T): T {
  if (!canReleaseTextScreenshot(q)) return q;
  return { ...q, imageBase64: "" };
}

/** Preview / control panel: prefer stem crop, else dedicated figure. */
export function getQuestionPreviewSrc(
  q: Pick<QuestionItem, "imageBase64" | "figureImageBase64">
): string | null {
  if (q.imageBase64) return q.imageBase64;
  const fig = q.figureImageBase64;
  if (typeof fig === "string" && fig.length > 0) return fig;
  return null;
}

/**
 * Whether export should attach a figure under the typeset stem.
 */
export function shouldShowFigureInTextOnlyMode(
  q: Pick<QuestionItem, "questionText" | "imageBase64" | "imageSettings" | "figureImageBase64">
): boolean {
  return Boolean(getTextOnlyFigureSrc(q));
}

/**
 * Figure attach for fixed「排版文字＋圖區」export.
 * - Non-empty figureImageBase64 → dedicated 選圖形 crop
 * - figureImageBase64 === "" → explicit none (do not fall back)
 * - figureImageBase64 undefined + imageBase64 still present → legacy / unsplit crop
 */
export function getTextOnlyFigureSrc(
  q: Pick<QuestionItem, "imageBase64" | "figureImageBase64" | "imageSettings" | "questionText">
): string | null {
  if (q.imageSettings && q.imageSettings.includeInExport === false) return null;
  const fig = q.figureImageBase64;
  if (typeof fig === "string") {
    return fig.length > 0 ? fig : null;
  }
  if (q.imageBase64) return q.imageBase64;
  return null;
}
