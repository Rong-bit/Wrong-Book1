import jsPDF from "jspdf";
import html2canvas from "html2canvas-pro";
import { PaperSettings } from "../types";

const SKIP_STYLE_PROPS = new Set([
  "animation",
  "animation-delay",
  "animation-direction",
  "animation-duration",
  "animation-fill-mode",
  "animation-iteration-count",
  "animation-name",
  "animation-play-state",
  "animation-timing-function",
  "transition",
  "transition-delay",
  "transition-duration",
  "transition-property",
  "transition-timing-function",
  "cursor",
  "caret-color",
]);

let colorProbe: CanvasRenderingContext2D | null | undefined;

function toRgbColor(value: string): string {
  if (!value || !/(oklch|oklab|lab\(|lch\(|color\()/i.test(value)) {
    return value;
  }
  try {
    if (colorProbe === undefined) {
      colorProbe = document.createElement("canvas").getContext("2d");
    }
    if (!colorProbe) return value;
    colorProbe.fillStyle = "#000000";
    colorProbe.fillStyle = value;
    return typeof colorProbe.fillStyle === "string" ? colorProbe.fillStyle : value;
  } catch {
    return value;
  }
}

function sanitizeCssValue(value: string): string {
  if (!value || !/(oklch|oklab|lab\(|lch\(|color\()/i.test(value)) {
    return value;
  }
  return value.replace(
    /(?:oklch|oklab|lab|lch|color)\((?:[^()]*|\([^()]*\))*\)/gi,
    (match) => toRgbColor(match)
  );
}

function collectElements(root: Element): Element[] {
  return [root, ...Array.from(root.querySelectorAll("*"))];
}

function copyComputedStyles(sourceRoot: HTMLElement, cloneRoot: HTMLElement) {
  const sourceEls = collectElements(sourceRoot);
  const cloneEls = collectElements(cloneRoot);
  const count = Math.min(sourceEls.length, cloneEls.length);

  for (let i = 0; i < count; i++) {
    const source = sourceEls[i];
    const clone = cloneEls[i] as HTMLElement;
    if (!clone?.style) continue;

    const computed = window.getComputedStyle(source);
    for (let j = 0; j < computed.length; j++) {
      const prop = computed[j];
      if (SKIP_STYLE_PROPS.has(prop) || prop.startsWith("--")) continue;
      if (prop === "-webkit-text-fill-color") {
        const fill = computed.getPropertyValue(prop);
        if (fill === "transparent" || fill === "rgba(0, 0, 0, 0)") continue;
      }
      const raw = computed.getPropertyValue(prop);
      if (!raw) continue;
      clone.style.setProperty(
        prop,
        sanitizeCssValue(raw),
        computed.getPropertyPriority(prop)
      );
    }
  }
}

export async function exportToHighDefPdf(
  containerElement: HTMLElement,
  settings: PaperSettings,
  onProgress?: (progressText: string) => void
): Promise<void> {
  if (!containerElement) {
    throw new Error("找不到試卷預覽元素");
  }

  onProgress?.("正在準備頁面渲染...");

  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  const isLandscape = settings.orientation === "landscape";
  const b5Width = 182;
  const b5Height = 257;
  const a4Width = 210;
  const a4Height = 297;

  let pageWidth = settings.paperSize === "B5" ? b5Width : a4Width;
  let pageHeight = settings.paperSize === "B5" ? b5Height : a4Height;

  if (isLandscape) {
    const tmp = pageWidth;
    pageWidth = pageHeight;
    pageHeight = tmp;
  }

  const pdf = new jsPDF({
    orientation: isLandscape ? "landscape" : "portrait",
    unit: "mm",
    format: settings.paperSize === "B5" ? [182, 257] : "a4",
    compress: true,
  });

  const capture = async (sourceNode: HTMLElement) => {
    return html2canvas(sourceNode, {
      scale: 2.0,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: "#ffffff",
      imageTimeout: 15000,
      foreignObjectRendering: false,
      onclone: (clonedDoc: Document, clonedEl?: HTMLElement) => {
        const target =
          clonedEl || (clonedDoc.body.firstElementChild as HTMLElement | null);
        if (target) {
          copyComputedStyles(sourceNode, target);
          target.style.backgroundColor = "#ffffff";
          target.style.color = "#0f172a";
        }
      },
    });
  };

  const pageNodes = containerElement.querySelectorAll<HTMLElement>(".paper-sheet");

  if (pageNodes.length > 0) {
    for (let i = 0; i < pageNodes.length; i++) {
      const pageNode = pageNodes[i];
      onProgress?.(`正在繪製第 ${i + 1} / ${pageNodes.length} 頁...`);

      const canvas = await capture(pageNode);
      const imgData = canvas.toDataURL("image/jpeg", 0.95);

      if (i > 0) {
        pdf.addPage(
          settings.paperSize === "B5" ? [182, 257] : "a4",
          isLandscape ? "landscape" : "portrait"
        );
      }

      pdf.addImage(imgData, "JPEG", 0, 0, pageWidth, pageHeight, undefined, "FAST");
    }
  } else {
    onProgress?.("正在轉換高解析度向量畫布...");
    const canvas = await capture(containerElement);

    const imgWidth = pageWidth;
    const pageHeightPx = (canvas.width * pageHeight) / pageWidth;
    let heightLeft = canvas.height;
    let position = 0;

    const imgData = canvas.toDataURL("image/jpeg", 0.95);
    pdf.addImage(
      imgData,
      "JPEG",
      0,
      position,
      imgWidth,
      (canvas.height * imgWidth) / canvas.width,
      undefined,
      "FAST"
    );
    heightLeft -= pageHeightPx;

    while (heightLeft > 0) {
      position = heightLeft - canvas.height;
      pdf.addPage(
        settings.paperSize === "B5" ? [182, 257] : "a4",
        isLandscape ? "landscape" : "portrait"
      );
      pdf.addImage(
        imgData,
        "JPEG",
        0,
        (position * pageHeight) / pageHeightPx,
        imgWidth,
        (canvas.height * imgWidth) / canvas.width,
        undefined,
        "FAST"
      );
      heightLeft -= pageHeightPx;
    }
  }

  onProgress?.("正在儲存 PDF 檔案...");
  const cleanTitle = (settings.title || "錯題考卷").replace(/[/\\?%*:|"<>]/g, "_");
  const fileName = `${cleanTitle}_${settings.paperSize}_${new Date().toISOString().slice(0, 10)}.pdf`;
  pdf.save(fileName);
}
