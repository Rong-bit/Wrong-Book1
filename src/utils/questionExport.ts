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
 * Whether「僅排版文字」should attach a figure.
 * Only dedicated 選圖形 crops — never the stem / text screenshot (imageBase64).
 */
export function shouldShowFigureInTextOnlyMode(
  q: Pick<QuestionItem, "questionText" | "imageBase64" | "imageSettings" | "figureImageBase64">
): boolean {
  return Boolean(getTextOnlyFigureSrc(q));
}

/**
 * Image for「僅排版文字」mode: figure/map crop only.
 * Never returns imageBase64 (that is the text or dual-panel screenshot).
 */
export function getTextOnlyFigureSrc(
  q: Pick<QuestionItem, "imageBase64" | "figureImageBase64" | "imageSettings" | "questionText">
): string | null {
  if (q.imageSettings && q.imageSettings.includeInExport === false) return null;
  const fig = q.figureImageBase64;
  if (typeof fig === "string" && fig.length > 0) return fig;
  return null;
}
