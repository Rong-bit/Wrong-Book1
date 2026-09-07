import jsPDF from "jspdf";
import html2canvas from "html2canvas-pro";
import { PaperSettings } from "../types";

export async function exportToHighDefPdf(
  containerElement: HTMLElement,
  settings: PaperSettings,
  onProgress?: (progressText: string) => void
): Promise<void> {
  if (!containerElement) {
    throw new Error("找不到試卷預覽元素");
  }

  onProgress?.("正在準備頁面渲染...");

  // Dimensions in mm
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

  const canvasOptions = {
    scale: 2.0, // High definition DPI rendering
    useCORS: true,
    allowTaint: true,
    logging: false,
    backgroundColor: "#ffffff",
    imageTimeout: 15000,
    onclone: (clonedDoc: Document) => {
      // Ensure printable container has explicit white background and dark text
      const target = clonedDoc.getElementById("printable-paper-container");
      if (target) {
        target.style.backgroundColor = "#ffffff";
        target.style.color = "#0f172a";
      }
    },
  };

  // Find all page sections if multi-page layout is used, otherwise capture full container
  const pageNodes = containerElement.querySelectorAll<HTMLElement>(".paper-sheet");

  if (pageNodes.length > 0) {
    for (let i = 0; i < pageNodes.length; i++) {
      const pageNode = pageNodes[i];
      onProgress?.(`正在繪製第 ${i + 1} / ${pageNodes.length} 頁...`);

      const canvas = await html2canvas(pageNode, canvasOptions);
      const imgData = canvas.toDataURL("image/jpeg", 0.95);

      if (i > 0) {
        pdf.addPage(settings.paperSize === "B5" ? [182, 257] : "a4", isLandscape ? "landscape" : "portrait");
      }

      pdf.addImage(imgData, "JPEG", 0, 0, pageWidth, pageHeight, undefined, "FAST");
    }
  } else {
    onProgress?.("正在轉換高解析度向量畫布...");
    const canvas = await html2canvas(containerElement, canvasOptions);

    const imgWidth = pageWidth;
    const pageHeightPx = (canvas.width * pageHeight) / pageWidth;
    let heightLeft = canvas.height;
    let position = 0;

    const imgData = canvas.toDataURL("image/jpeg", 0.95);
    pdf.addImage(imgData, "JPEG", 0, position, imgWidth, (canvas.height * imgWidth) / canvas.width, undefined, "FAST");
    heightLeft -= pageHeightPx;

    while (heightLeft > 0) {
      position = heightLeft - canvas.height;
      pdf.addPage(settings.paperSize === "B5" ? [182, 257] : "a4", isLandscape ? "landscape" : "portrait");
      pdf.addImage(imgData, "JPEG", 0, (position * pageHeight) / pageHeightPx, imgWidth, (canvas.height * imgWidth) / canvas.width, undefined, "FAST");
      heightLeft -= pageHeightPx;
    }
  }

  onProgress?.("正在儲存 PDF 檔案...");
  const cleanTitle = (settings.title || "錯題考卷").replace(/[/\\?%*:|"<>]/g, "_");
  const fileName = `${cleanTitle}_${settings.paperSize}_${new Date().toISOString().slice(0, 10)}.pdf`;
  pdf.save(fileName);
}
