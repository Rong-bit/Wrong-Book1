import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import {
  X,
  Printer,
  FileText,
  Settings2,
  BookOpen,
  GraduationCap,
  LayoutTemplate,
  AlertTriangle,
  CheckSquare,
  Sparkles,
  Eye,
  Image as ImageIcon,
  Camera,
  AlignLeft,
} from "lucide-react";
import { PaperSettings, QuestionItem, PaperSize, ImageSettings } from "../types";
import { MathRenderer } from "./MathRenderer";
import { normalizeImageSrc } from "../utils/imageUtils";
import { getTextOnlyFigureSrc } from "../utils/questionExport";
import {
  listSubjectFilterKeys,
  matchesSubjectFilter,
  normalizeSubjectKey,
} from "../utils/curriculumLabels";

interface PdfExportModalProps {
  isOpen: boolean;
  /** Ready questions (already excludes analyzing). */
  questions: QuestionItem[];
  /** Total notebook size (may include analyzing); shown when export skips some. */
  notebookTotal?: number;
  /** Notebook subject chip when opening export — default export scope. */
  initialSubjectFilter?: string;
  settings: PaperSettings;
  onClose: () => void;
  onUpdateSettings: (newSettings: PaperSettings) => void;
}

const MISTAKE_REASONS = [
  "觀念盲區",
  "題意誤判",
  "陷阱誘答",
  "超綱冷門",
  "跨章整合",
  "條件疏漏",
  "計算失誤",
  "核心未熟",
];

const REVIEW_INTERVALS = ["1D", "2D", "4D", "7D", "15D"];

/**
 * Printed height of a「選圖形」map.
 * Old caps were 16–40 CSS px-rem (~17–42mm), so place names were unreadably small.
 */
const FIGURE_MAX_HEIGHT = {
  cornellCompact: "72mm",
  cornell: "96mm",
  paper: "112mm",
} as const;

function questionImageStyle(
  settings: ImageSettings | undefined
): React.CSSProperties | undefined {
  const rotation = settings?.rotation || 0;
  const zoom = settings?.zoom ?? 100;
  // rotate(0) scale(1) still promotes a layer; Chrome then prints that layer
  // at screen DPI and maps/diagrams look soft.
  if (rotation === 0 && zoom === 100) return undefined;
  return {
    transform: `rotate(${rotation}deg) scale(${zoom / 100})`,
    transformOrigin: "center center",
  };
}

function ExportFigure({
  src,
  maxHeight,
  fit = false,
}: {
  src: string;
  maxHeight?: string;
  /** Fill the leftover slot so two questions can share one page. */
  fit?: boolean;
}) {
  return (
    <div className={`print-figure flex w-full justify-end ${fit ? "h-full min-h-0 items-start" : ""}`}>
      <img
        src={normalizeImageSrc(src)}
        alt="題目附圖（地圖／圖示）"
        className={`print-figure-img block w-auto max-w-full object-contain border border-slate-300 bg-white rounded-sm ${
          fit ? "h-auto max-h-full min-h-0" : "h-auto"
        }`}
        style={fit ? undefined : { maxHeight }}
      />
    </div>
  );
}

function CornellReview({
  isCornellCompact,
  showGrid,
  showReviewTrack,
  sharePage = false,
}: {
  isCornellCompact: boolean;
  showGrid: boolean;
  showReviewTrack: boolean;
  /** Two questions share the sheet: keep a writing strip, don't grow past the other card. */
  sharePage?: boolean;
}) {
  if (isCornellCompact) {
    if (!showReviewTrack) return null;
    return (
      <div className="px-1.5 py-0.5 flex justify-end shrink-0 bg-white">
        <div className="bg-white rounded border border-slate-300/80 flex items-center gap-1 px-1.5 py-0.5 text-[8px] text-slate-700">
          <span className="font-bold text-slate-800">複習：</span>
          <div className="flex items-center gap-1">
            {REVIEW_INTERVALS.map((label) => (
              <div
                key={label}
                className="w-3 h-3 rounded-[2px] border border-slate-400 bg-white"
                title={label}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${
        sharePage ? "shrink-0 min-h-[22mm]" : "flex-1 min-h-[28mm]"
      } p-2 flex flex-col justify-between relative ${showGrid ? "math-grid-bg" : "bg-white"}`}
    >
      <div className="text-[10px] text-slate-400 font-sans tracking-wider pointer-events-none select-none">
        【演算推導 · 思維訂正筆記區】
      </div>
      {showReviewTrack && (
        <div className="self-end bg-white/95 px-2.5 py-1 rounded-md border border-slate-300/80 shadow-2xs flex items-center gap-2 text-[10px] text-slate-700">
          <span className="font-bold text-slate-800">艾賓浩斯複習打卡 (V/X)：</span>
          <div className="flex items-center gap-1">
            {REVIEW_INTERVALS.map((label) => (
              <div key={label} className="flex flex-col items-center">
                <div className="w-4 h-4 rounded-[2px] border-2 border-slate-400 bg-white" />
                <span className="text-[8px] text-slate-400 mt-0.5">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const PdfExportModal: React.FC<PdfExportModalProps> = ({
  isOpen,
  questions,
  notebookTotal,
  initialSubjectFilter = "全部",
  settings,
  onClose,
  onUpdateSettings,
}) => {
  const [exportError, setExportError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [exportSubject, setExportSubject] = useState(initialSubjectFilter);
  const previewRef = useRef<HTMLDivElement>(null);

  const isCornellCompact = settings.questionsPerPage === "compact";
  /** User-requested max questions per Cornell page (before auto-fit shrink). */
  const requestedCornellCap = useMemo(() => {
    if (settings.questionsPerPage === "compact") {
      return settings.paperSize === "B5" ? 5 : 6;
    }
    if (settings.questionsPerPage === 1) return 1;
    return 2;
  }, [settings.questionsPerPage, settings.paperSize]);
  /** 每頁 2 題：兩張卡片平分紙高，圖縮進格子裡，不改成一題一頁。 */
  const isTwoUp = !isCornellCompact && requestedCornellCap === 2;
  /**
   * Actual questions per page after overflow fit.
   * Same idea as 背科精簡: shrink until page content is not clipped.
   */
  const [cornellFitSize, setCornellFitSize] = useState(requestedCornellCap);

  const subjectOptions = useMemo(
    () => listSubjectFilterKeys(questions.map((q) => q.subject)),
    [questions]
  );

  /** Questions actually printed / previewed for the chosen subject scope. */
  const exportQuestions = useMemo(() => {
    if (exportSubject === "全部") return questions;
    return questions.filter((q) => matchesSubjectFilter(q.subject, exportSubject));
  }, [questions, exportSubject]);

  useEffect(() => {
    if (!isOpen) {
      setShowPreview(false);
      setExportError(null);
      return;
    }
  }, [isOpen]);

  // Sync notebook chip → export scope only when opening / chip changes.
  // Do NOT depend on `questions` identity — that used to reset「地理」back to「全部」
  // (or wipe a manual chip pick) and pull math into the preview again.
  useEffect(() => {
    if (!isOpen) return;
    if (!initialSubjectFilter || initialSubjectFilter === "全部") {
      setExportSubject("全部");
      return;
    }
    const canonical =
      normalizeSubjectKey(initialSubjectFilter) || initialSubjectFilter;
    setExportSubject(canonical);
  }, [isOpen, initialSubjectFilter]);

  const questionsFitKey = useMemo(
    () =>
      exportQuestions
        .map((q) => `${q.id}:${q.figureImageBase64 ? "f" : q.imageBase64 ? "i" : "n"}`)
        .join("|"),
    [exportQuestions]
  );

  useEffect(() => {
    setCornellFitSize(requestedCornellCap);
  }, [
    requestedCornellCap,
    settings.questionDisplayMode,
    questionsFitKey,
    exportSubject,
    isOpen,
  ]);

  const cornellPageSize = Math.max(
    1,
    Math.min(cornellFitSize, requestedCornellCap)
  );
  /** True when auto-fit lowered density below the user's chip choice. */
  const cornellFitReduced = cornellPageSize < requestedCornellCap;

  const cornellPages = useMemo(() => {
    const pages: { pageIndex: number; questions: { q: QuestionItem; index: number }[] }[] =
      [];
    for (let i = 0; i < exportQuestions.length; i += cornellPageSize) {
      const chunk = exportQuestions.slice(i, i + cornellPageSize).map((q, offset) => ({
        q,
        index: i + offset,
      }));
      pages.push({
        pageIndex: Math.floor(i / cornellPageSize),
        questions: chunk,
      });
    }
    return pages;
  }, [exportQuestions, cornellPageSize]);

  // Compact packs as many as fit. 每頁 1／2 題 stays at the chosen count;
  // figures shrink into the sheet instead of dropping the second question.
  useLayoutEffect(() => {
    if (!isOpen || !showPreview || settings.mode !== "cornell") return;
    if (!isCornellCompact) return;
    if (cornellFitSize <= 1) return;
    const root = previewRef.current;
    if (!root) return;

    let cancelled = false;
    let shrinkQueued = false;

    const pageOverflows = () => {
      const bodies = Array.from(
        root.querySelectorAll("[data-cornell-body]")
      ) as HTMLElement[];
      for (const el of bodies) {
        if (el.scrollHeight > el.clientHeight + 2) return true;
        const cards = Array.from(
          el.querySelectorAll("[data-cornell-card]")
        ) as HTMLElement[];
        // flex-1 + min-h-0 used to shrink cards and clip inside overflow:hidden,
        // leaving scrollHeight === clientHeight. Measure natural card heights instead.
        if (cards.length > 0) {
          const first = cards[0];
          const last = cards[cards.length - 1];
          const span =
            last.offsetTop + last.scrollHeight - first.offsetTop;
          if (span > el.clientHeight + 2) return true;
        }
        for (const card of cards) {
          if (card.scrollHeight > card.clientHeight + 2) return true;
        }
        const panes = Array.from(
          el.querySelectorAll("[data-cornell-question]")
        ) as HTMLElement[];
        for (const pane of panes) {
          if (pane.scrollHeight > pane.clientHeight + 2) return true;
        }
      }
      return false;
    };

    const shrinkIfNeeded = () => {
      if (cancelled || shrinkQueued) return;
      if (!pageOverflows()) return;
      shrinkQueued = true;
      // Defer setState so ResizeObserver callbacks settle first
      requestAnimationFrame(() => {
        shrinkQueued = false;
        if (cancelled) return;
        if (!pageOverflows()) return;
        setCornellFitSize((n) => (n > 1 ? n - 1 : n));
      });
    };

    shrinkIfNeeded();

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => shrinkIfNeeded())
        : null;
    root.querySelectorAll("[data-cornell-body]").forEach((el) => ro?.observe(el));

    const onAssetSettle = () => shrinkIfNeeded();
    const imgs: HTMLImageElement[] = Array.from(
      root.querySelectorAll("img")
    ) as HTMLImageElement[];
    for (const img of imgs) {
      if (!img.complete) {
        img.addEventListener("load", onAssetSettle);
        img.addEventListener("error", onAssetSettle);
      }
    }

    // KaTeX / font metrics often settle after first paint
    const t1 = window.setTimeout(onAssetSettle, 120);
    const t2 = window.setTimeout(onAssetSettle, 500);
    const t3 = window.setTimeout(onAssetSettle, 1400);
    if (typeof document !== "undefined" && "fonts" in document) {
      void document.fonts.ready.then(onAssetSettle).catch(() => undefined);
    }

    return () => {
      cancelled = true;
      ro?.disconnect();
      for (const img of imgs) {
        img.removeEventListener("load", onAssetSettle);
        img.removeEventListener("error", onAssetSettle);
      }
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [
    isOpen,
    showPreview,
    settings.mode,
    cornellFitSize,
    cornellPages,
    settings.questionDisplayMode,
    settings.paperSize,
    isCornellCompact,
  ]);

  if (!isOpen) return null;

  const handlePrint = () => {
    const source =
      previewRef.current ||
      document.getElementById("printable-paper-container");
    if (!source) return;

    // Compact only: fixed 1／2 per page must not be rewritten at print time.
    if (settings.mode === "cornell" && isCornellCompact && cornellFitSize > 1) {
      const bodies = Array.from(
        source.querySelectorAll("[data-cornell-body]")
      ) as HTMLElement[];
      let overflow = false;
      for (const el of bodies) {
        if (el.scrollHeight > el.clientHeight + 2) overflow = true;
        const cards = Array.from(
          el.querySelectorAll("[data-cornell-card]")
        ) as HTMLElement[];
        if (cards.length > 0) {
          const first = cards[0];
          const last = cards[cards.length - 1];
          const span =
            last.offsetTop + last.scrollHeight - first.offsetTop;
          if (span > el.clientHeight + 2) overflow = true;
        }
        for (const card of cards) {
          if (card.scrollHeight > card.clientHeight + 2) overflow = true;
        }
        const panes = Array.from(
          el.querySelectorAll("[data-cornell-question]")
        ) as HTMLElement[];
        for (const pane of panes) {
          if (pane.scrollHeight > pane.clientHeight + 2) overflow = true;
        }
      }
      if (overflow) {
        setCornellFitSize((n) => n - 1);
        setExportError("仍在依內容調整每頁題數以免裁切圖形，請確認預覽後再列印一次");
        return;
      }
    }

    const root = document.documentElement;
    const isB5 = settings.paperSize === "B5";
    const isMobile =
      window.matchMedia("(pointer: coarse)").matches ||
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    document.getElementById("exam-print-root")?.remove();
    document.getElementById("exam-print-page-size")?.remove();

    const printRoot = document.createElement("div");
    printRoot.id = "exam-print-root";
    printRoot.appendChild(source.cloneNode(true));
    document.body.appendChild(printRoot);

    // Match preview paperHeightStyle (257/297) so fit-check and print use the same box.
    // Mobile uses a shorter sheet for browser chrome, but keep desktop exact.
    const sheetWidth = isMobile ? "100%" : isB5 ? "182mm" : "210mm";
    const sheetHeight = isMobile
      ? isB5
        ? "220mm"
        : "248mm"
      : isB5
        ? "257mm"
        : "297mm";

    const pageStyle = document.createElement("style");
    pageStyle.id = "exam-print-page-size";
    pageStyle.textContent = `
      @page { size: ${isB5 ? "182mm 257mm" : "A4 portrait"}; margin: 0; }
      #exam-print-root .paper-sheet-fit {
        width: ${sheetWidth} !important;
        max-width: 100% !important;
        height: ${sheetHeight} !important;
        max-height: ${sheetHeight} !important;
        min-height: 0 !important;
      }
    `;
    document.head.appendChild(pageStyle);

    root.classList.add("printing-exam");
    root.setAttribute("data-print-size", settings.paperSize);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      root.classList.remove("printing-exam");
      root.removeAttribute("data-print-size");
      printRoot.remove();
      pageStyle.remove();
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.setTimeout(cleanup, 120000);
    window.print();
  };

  const paperWidthStyle = settings.paperSize === "B5" ? "182mm" : "210mm";
  const paperHeightStyle = settings.paperSize === "B5" ? "257mm" : "297mm";

  const displayMode =
    settings.questionDisplayMode ||
    (settings.includeImages ? "both" : "textOnly");

  /** imageOnly / both: full crop; textOnly: figure-only; textPlain: never */
  const shouldRenderQuestionImage = (q: QuestionItem): boolean => {
    if (displayMode === "textPlain") return false;
    if (q.imageSettings?.includeInExport === false) return false;
    if (displayMode === "imageOnly" || displayMode === "both") {
      return Boolean(q.imageBase64);
    }
    if (displayMode === "textOnly") return Boolean(getTextOnlyFigureSrc(q));
    return false;
  };

  return (
    <div className="app-screen-overlay bg-slate-900/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="app-screen-sheet bg-slate-100 rounded-2xl shadow-2xl border border-slate-300">
        {/* Top Header */}
        <div className="px-4 py-3 md:px-6 md:py-4 bg-white border-b border-slate-200 flex items-center justify-between shrink-0 no-print">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center border border-sky-200">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                {showPreview ? "預覽排版" : "高清 PDF 錯題本排版與匯出"}
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium">
                  {settings.mode === "cornell"
                    ? "康乃爾雙欄訂正本"
                    : settings.mode === "notebook"
                    ? "錯題精讀本"
                    : "自組測驗卷"}
                </span>
              </h3>
              <p className="text-xs text-slate-500 hidden sm:block">
                {showPreview
                  ? "確認紙張畫面無誤後，再按列印送給印表機"
                  : "先調整規格，再另開畫面預覽康乃爾雙欄與紙張排版"}
              </p>
            </div>
          </div>
          <button
            id="close-pdf-modal-btn"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Export Error Alert Banner */}
        {exportError && (
          <div className="px-6 py-2.5 bg-rose-50 border-b border-rose-200 text-xs text-rose-800 flex items-center justify-between gap-3 shrink-0 no-print">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>PDF 匯出提醒：{exportError}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrint}
                className="px-2.5 py-1 text-[11px] font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition"
              >
                改用瀏覽器原生列印 (另存 PDF)
              </button>
              <button
                type="button"
                onClick={() => setExportError(null)}
                className="p-1 text-rose-400 hover:text-rose-700 rounded-md"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {!showPreview ? (
        <div className="flex-1 min-h-0 overflow-y-auto no-print bg-white">
          <div className="w-full max-w-3xl mx-auto p-5 space-y-4 text-xs">
            <div className="flex items-center gap-1.5 font-bold text-slate-800 text-sm pb-1 border-b border-slate-100">
              <Settings2 className="w-4 h-4 text-sky-600" />
              版面規格與排版風格
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              調整完成後按「預覽排版」，會另開畫面顯示紙張。確認無誤後再列印。
            </p>

            {/* Paper Size */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1.5">
                標準紙張尺寸
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onUpdateSettings({ ...settings, paperSize: "B5" })}
                  className={`py-2 px-3 rounded-xl font-bold border transition text-center ${
                    settings.paperSize === "B5"
                      ? "bg-sky-600 text-white border-sky-600 shadow-xs"
                      : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  B5 (182×257 mm)
                  <span className="block text-[10px] font-normal opacity-90 mt-0.5">
                    學生錯題本最常用
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateSettings({ ...settings, paperSize: "A4" })}
                  className={`py-2 px-3 rounded-xl font-bold border transition text-center ${
                    settings.paperSize === "A4"
                      ? "bg-sky-600 text-white border-sky-600 shadow-xs"
                      : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  A4 (210×297 mm)
                  <span className="block text-[10px] font-normal opacity-90 mt-0.5">
                    標準試卷/印表機
                  </span>
                </button>
              </div>
            </div>

            {/* Subject scope — follows notebook filter by default */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1.5">
                匯出科目範圍
              </label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setExportSubject("全部")}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition ${
                    exportSubject === "全部"
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  全部 ({questions.length})
                </button>
                {subjectOptions.map((subj) => {
                  const count = questions.filter((q) =>
                    matchesSubjectFilter(q.subject, subj)
                  ).length;
                  const active =
                    exportSubject !== "全部" &&
                    matchesSubjectFilter(subj, exportSubject);
                  return (
                    <button
                      key={subj}
                      type="button"
                      onClick={() => setExportSubject(subj)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition ${
                        active
                          ? "bg-sky-600 text-white border-sky-600"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {subj} ({count})
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[10px] text-slate-500 leading-snug">
                預設帶入錯題本目前科目篩選
                {initialSubjectFilter && initialSubjectFilter !== "全部"
                  ? `（${initialSubjectFilter}）`
                  : ""}
                ；選「全部」才會混入其他科目。
              </p>
            </div>

            {/* Export Mode: Cornell vs Notebook vs Exam Paper */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1.5">
                排版格式模式
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => onUpdateSettings({ ...settings, mode: "cornell" })}
                  className={`p-2 rounded-xl border flex flex-col items-center gap-1 transition text-center relative ${
                    settings.mode === "cornell"
                      ? "bg-amber-50 text-amber-950 border-amber-400 font-bold shadow-xs"
                      : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  <span className="absolute -top-1.5 -right-1 bg-amber-500 text-white text-[9px] px-1 rounded-full">
                    熱門
                  </span>
                  <LayoutTemplate className="w-4 h-4 text-amber-600" />
                  <span className="text-[11px]">康乃爾訂正</span>
                  <span className="text-[9px] text-slate-500 font-normal">
                    雙欄+手寫網格
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => onUpdateSettings({ ...settings, mode: "notebook" })}
                  className={`p-2 rounded-xl border flex flex-col items-center gap-1 transition text-center ${
                    settings.mode === "notebook"
                      ? "bg-indigo-50 text-indigo-950 border-indigo-400 font-bold shadow-xs"
                      : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  <BookOpen className="w-4 h-4 text-indigo-600" />
                  <span className="text-[11px]">錯題精讀本</span>
                  <span className="text-[9px] text-slate-500 font-normal">
                    含逐步推導
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => onUpdateSettings({ ...settings, mode: "exam" })}
                  className={`p-2 rounded-xl border flex flex-col items-center gap-1 transition text-center ${
                    settings.mode === "exam"
                      ? "bg-sky-50 text-sky-950 border-sky-400 font-bold shadow-xs"
                      : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  <GraduationCap className="w-4 h-4 text-sky-600" />
                  <span className="text-[11px]">自組測驗卷</span>
                  <span className="text-[9px] text-slate-500 font-normal">
                    挖空純作答
                  </span>
                </button>
              </div>
            </div>

            {/* Cornell Mode Specific Controls */}
            {settings.mode === "cornell" && (
              <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl space-y-2.5">
                <div className="font-bold text-amber-900 flex items-center gap-1.5 text-[11px]">
                  <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                  康乃爾錯題本專屬設定
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    每頁題數配置
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSettings({ ...settings, questionsPerPage: 2 })
                      }
                      className={`py-1.5 px-2 rounded-lg border text-center transition ${
                        settings.questionsPerPage === 2 ||
                        settings.questionsPerPage == null
                          ? "bg-amber-600 text-white border-amber-600 font-bold"
                          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <div className="text-[11px] font-bold">每頁 2 題</div>
                      <div className="text-[9px] opacity-80 mt-0.5">黃金比例 · 數理演算</div>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSettings({ ...settings, questionsPerPage: 1 })
                      }
                      className={`py-1.5 px-2 rounded-lg border text-center transition ${
                        settings.questionsPerPage === 1
                          ? "bg-amber-600 text-white border-amber-600 font-bold"
                          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <div className="text-[11px] font-bold">每頁 1 題</div>
                      <div className="text-[9px] opacity-80 mt-0.5">超大演算空間</div>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSettings({ ...settings, questionsPerPage: "compact" })
                      }
                      className={`py-1.5 px-2 rounded-lg border text-center transition ${
                        settings.questionsPerPage === "compact"
                          ? "bg-amber-600 text-white border-amber-600 font-bold"
                          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                      }`}
                      title="地理、公民、歷史等背科：題與題緊接、不留手寫空白，避免紙張浪費"
                    >
                      <div className="text-[11px] font-bold">背科精簡</div>
                      <div className="text-[9px] opacity-80 mt-0.5">無留白 · 密排</div>
                    </button>
                  </div>
                  {settings.questionsPerPage === "compact" ? (
                    <p className="mt-1.5 text-[10px] text-amber-800/90 leading-snug">
                      適合地理、公民、歷史等死背科目：題與題緊接、不留手寫空白；預覽會依內容自動調整每頁題數（目前約{" "}
                      {cornellPageSize} 題／頁），避免題目被裁切。
                    </p>
                  ) : settings.questionsPerPage === 1 ? (
                    <p className="mt-1.5 text-[10px] text-amber-800/90 leading-snug">
                      固定每頁 1 題，圖形與演算區用滿該頁。
                    </p>
                  ) : (
                    <p className="mt-1.5 text-[10px] text-amber-800/90 leading-snug">
                      固定每頁 2 題。圖形與筆記區會縮進同一頁，不會改成一題一頁。
                    </p>
                  )}
                </div>

                <div className="space-y-1.5 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.showGrid ?? true}
                      onChange={(e) =>
                        onUpdateSettings({ ...settings, showGrid: e.target.checked })
                      }
                      className="rounded text-amber-600 focus:ring-amber-500 w-3.5 h-3.5"
                    />
                    <span className="text-slate-700">顯示 5mm 數學微網格手寫底紋</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.showCheckboxes ?? true}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...settings,
                          showCheckboxes: e.target.checked,
                        })
                      }
                      className="rounded text-amber-600 focus:ring-amber-500 w-3.5 h-3.5"
                    />
                    <span className="text-slate-700">包含 8 大錯誤原因分析核取框</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.showReviewTrack ?? true}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...settings,
                          showReviewTrack: e.target.checked,
                        })
                      }
                      className="rounded text-amber-600 focus:ring-amber-500 w-3.5 h-3.5"
                    />
                    <span className="text-slate-700">
                      包含艾賓浩斯 5 次複習打卡檢核
                    </span>
                  </label>
                </div>
              </div>
            )}

            {/* Exam & Notebook Details */}
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  試卷/筆記本標題
                </label>
                <input
                  type="text"
                  value={settings.title}
                  onChange={(e) =>
                    onUpdateSettings({ ...settings, title: e.target.value })
                  }
                  placeholder="例：錯題訂正本"
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 focus:bg-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  命題範圍 / 註記
                </label>
                <input
                  type="text"
                  value={settings.subtitle}
                  onChange={(e) =>
                    onUpdateSettings({ ...settings, subtitle: e.target.value })
                  }
                  placeholder="例：第1章 一元二次方程式"
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 focus:bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    年級
                  </label>
                  <input
                    type="text"
                    value={settings.gradeClass}
                    onChange={(e) =>
                      onUpdateSettings({ ...settings, gradeClass: e.target.value })
                    }
                    placeholder="例：國三上"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    學生姓名
                  </label>
                  <input
                    type="text"
                    value={settings.studentName}
                    onChange={(e) =>
                      onUpdateSettings({ ...settings, studentName: e.target.value })
                    }
                    placeholder="學生姓名"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 focus:bg-white"
                  />
                </div>
              </div>
            </div>

            {/* Question Content Display Mode */}
            <div className="pt-2 border-t border-slate-100 space-y-2">
              <label className="block font-semibold text-slate-700">
                題目內容呈現方式
              </label>

              <div className="space-y-1.5">
                {/* Option 1: Image Only */}
                <button
                  type="button"
                  onClick={() =>
                    onUpdateSettings({
                      ...settings,
                      questionDisplayMode: "imageOnly",
                      includeImages: true,
                    })
                  }
                  className={`w-full p-2 rounded-xl border flex items-center justify-between text-left transition ${
                    displayMode === "imageOnly"
                      ? "bg-amber-50 border-amber-400 text-amber-950 font-bold shadow-2xs"
                      : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Camera className="w-4 h-4 text-amber-600 shrink-0" />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs">僅截圖照片 (沒文字)</span>
                        <span className="text-[9px] bg-amber-200 text-amber-900 px-1.5 py-0.2 rounded font-bold">
                          原汁原味
                        </span>
                      </div>
                      <span className="block text-[10px] text-slate-500 font-normal">
                        直接呈現原題裁切照片，不印辨識文字
                      </span>
                    </div>
                  </div>
                  <div
                    className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      displayMode === "imageOnly"
                        ? "border-amber-600 bg-amber-600"
                        : "border-slate-300"
                    }`}
                  >
                    {displayMode === "imageOnly" && (
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                    )}
                  </div>
                </button>

                {/* Option 2: Both Text and Image */}
                <button
                  type="button"
                  onClick={() =>
                    onUpdateSettings({
                      ...settings,
                      questionDisplayMode: "both",
                      includeImages: true,
                    })
                  }
                  className={`w-full p-2 rounded-xl border flex items-center justify-between text-left transition ${
                    displayMode === "both"
                      ? "bg-sky-50 border-sky-400 text-sky-950 font-bold shadow-2xs"
                      : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-sky-600 shrink-0" />
                    <div>
                      <span className="block text-xs">包含文字與題目截圖</span>
                      <span className="block text-[10px] text-slate-500 font-normal">
                        上方顯示原題照片，下方顯示文字排版
                      </span>
                    </div>
                  </div>
                  <div
                    className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      displayMode === "both"
                        ? "border-sky-600 bg-sky-600"
                        : "border-slate-300"
                    }`}
                  >
                    {displayMode === "both" && (
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                    )}
                  </div>
                </button>

                {/* Option 3: Text + figure attach */}
                <button
                  type="button"
                  onClick={() =>
                    onUpdateSettings({
                      ...settings,
                      questionDisplayMode: "textOnly",
                      includeImages: false,
                    })
                  }
                  className={`w-full p-2 rounded-xl border flex items-center justify-between text-left transition ${
                    displayMode === "textOnly"
                      ? "bg-indigo-50 border-indigo-400 text-indigo-950 font-bold shadow-2xs"
                      : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <AlignLeft className="w-4 h-4 text-indigo-600 shrink-0" />
                    <div>
                      <span className="block text-xs">僅排版文字（附圖形圖）</span>
                      <span className="block text-[10px] text-slate-500 font-normal">
                        印排版文字；有「選圖形」才緊接題幹附上地圖／圖區，複習區在圖下，不附文字截圖
                      </span>
                    </div>
                  </div>
                  <div
                    className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      displayMode === "textOnly"
                        ? "border-indigo-600 bg-indigo-600"
                        : "border-slate-300"
                    }`}
                  >
                    {displayMode === "textOnly" && (
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                    )}
                  </div>
                </button>

                {/* Option 4: Pure text — no screenshots at all */}
                <button
                  type="button"
                  onClick={() =>
                    onUpdateSettings({
                      ...settings,
                      questionDisplayMode: "textPlain",
                      includeImages: false,
                    })
                  }
                  className={`w-full p-2 rounded-xl border flex items-center justify-between text-left transition ${
                    displayMode === "textPlain"
                      ? "bg-emerald-50 border-emerald-400 text-emerald-950 font-bold shadow-2xs"
                      : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <AlignLeft className="w-4 h-4 text-emerald-600 shrink-0" />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs">僅排版文字 (無截圖)</span>
                        <span className="text-[9px] bg-emerald-200 text-emerald-900 px-1.5 py-0.2 rounded font-bold">
                          省墨
                        </span>
                      </div>
                      <span className="block text-[10px] text-slate-500 font-normal">
                        純文字印刷排版；不放文字截圖、也不放地圖／圖形截圖
                      </span>
                    </div>
                  </div>
                  <div
                    className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      displayMode === "textPlain"
                        ? "border-emerald-600 bg-emerald-600"
                        : "border-slate-300"
                    }`}
                  >
                    {displayMode === "textPlain" && (
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                    )}
                  </div>
                </button>
              </div>

              {/* Answer Sheet Toggle */}
              <label className="flex items-center gap-2 cursor-pointer pt-2 border-t border-slate-100">
                <input
                  type="checkbox"
                  checked={settings.includeAnswerSheet}
                  onChange={(e) =>
                    onUpdateSettings({
                      ...settings,
                      includeAnswerSheet: e.target.checked,
                    })
                  }
                  className="rounded text-sky-600 focus:ring-sky-500 w-4 h-4"
                />
                <span className="text-slate-700 font-medium">
                  末頁附上參考答案與解題解析
                </span>
              </label>
            </div>
          </div>
        </div>
        ) : (
          <div className="print-preview-canvas flex-1 min-h-0 bg-slate-300/80 p-4 md:p-8 overflow-y-auto overflow-x-auto flex flex-col items-center">
            <div ref={previewRef} id="printable-paper-container" className="w-full flex flex-col items-center">
              {/* CORNELL MODE RENDERING */}
              {settings.mode === "cornell" ? (
                <>
                  {cornellPages.map(({ pageIndex, questions: pageQs }) => (
                    <div
                      key={`cornell-page-${pageIndex}`}
                      className={`paper-sheet paper-sheet-fit paper-${settings.paperSize.toLowerCase()} bg-white text-slate-900 shadow-xl transition-all duration-200 border border-slate-300 font-sans mb-8 relative flex flex-col justify-between`}
                      style={{
                        width: paperWidthStyle,
                        minHeight: paperHeightStyle,
                        height: paperHeightStyle,
                        padding: "8mm 10mm",
                        boxSizing: "border-box",
                      }}
                    >
                      {/* Sheet Top Header */}
                      <div className="pb-2 mb-2 border-b-2 border-slate-900 flex items-end justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <h1 className="text-base font-black tracking-wider text-slate-900">
                              {settings.title || "錯題訂正本"}
                            </h1>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-bold tracking-widest">
                              CORNELL NOTE
                            </span>
                          </div>
                          {settings.subtitle && (
                            <p className="text-[10px] text-slate-500 mt-0.5">
                              {settings.subtitle}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-slate-700">
                          <span>
                            年級：<u>&nbsp;{settings.gradeClass || "________"}&nbsp;</u>
                          </span>
                          <span>
                            姓名：<u>&nbsp;{settings.studentName || "____________"}&nbsp;</u>
                          </span>
                          <span>
                            日期：<u>&nbsp;________/____/____&nbsp;</u>
                          </span>
                        </div>
                      </div>

                      {/* Questions in this sheet */}
                      <div
                        data-cornell-body
                        className={`flex-1 min-h-0 flex flex-col overflow-hidden ${
                          isCornellCompact ? "gap-1.5 justify-start" : "gap-2.5"
                        }`}
                      >
                        {pageQs.map(({ q, index }, qIdx) => (
                          <div
                            key={q.id}
                            data-cornell-card
                            className={`border border-slate-300 rounded-lg overflow-hidden flex flex-row relative bg-white ${
                              isCornellCompact
                                ? "shrink-0 items-start"
                                : isTwoUp
                                  ? "flex-1 min-h-0"
                                  : "flex-1 min-h-min"
                            }`}
                          >
                            {/* LEFT SIDEBAR: Metadata & Mistake Reason Analysis */}
                            <div
                              className={`shrink-0 bg-slate-50 border-r border-slate-300 flex flex-col text-[11px] font-sans ${
                                isCornellCompact
                                  ? "w-36 sm:w-40 p-1.5"
                                  : "w-48 sm:w-52 p-2.5 justify-between"
                              }`}
                            >
                              <div className={isCornellCompact ? "space-y-1" : "space-y-2"}>
                                {/* Subject / Source */}
                                <div>
                                  <div className="font-semibold text-slate-800 flex items-center gap-1 flex-wrap">
                                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-sky-100 text-sky-800 font-bold">
                                      {q.subject || "科目"}
                                    </span>
                                    {!isCornellCompact && (
                                      <span className="text-[10px] text-slate-500 truncate">
                                        來源: ___________
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* Grade / Volume / Chapter */}
                                <div>
                                  <div className="text-[10px] text-slate-500 font-bold">主題 / 冊別</div>
                                  <div
                                    className={`text-slate-800 font-medium leading-tight ${
                                      isCornellCompact ? "text-[10px]" : "text-[11px]"
                                    }`}
                                  >
                                    {q.gradeLevel || "冊別待定"}
                                    {q.chapter ? ` · ${q.chapter}` : ""}
                                  </div>
                                </div>

                                {/* Core Knowledge Point */}
                                <div>
                                  <div className="text-[10px] text-slate-500 font-bold">核心考點</div>
                                  <div
                                    className={`text-slate-900 font-bold leading-tight text-amber-900 bg-amber-50/70 p-1 rounded border border-amber-200/60 ${
                                      isCornellCompact ? "text-[10px]" : "text-[11px]"
                                    }`}
                                  >
                                    {q.unit || "觀念綜合"}
                                  </div>
                                </div>

                                {/* Mistake Reason Checklist */}
                                {settings.showCheckboxes !== false && (
                                  <div>
                                    <div className="text-[10px] text-slate-600 font-bold mb-1 flex items-center justify-between">
                                      <span>原因分析{isCornellCompact ? "" : " (可複選)"}</span>
                                      {!isCornellCompact && (
                                        <span className="text-[9px] text-slate-400">WHY</span>
                                      )}
                                    </div>
                                    <div
                                      className={`grid grid-cols-2 text-slate-700 ${
                                        isCornellCompact
                                          ? "gap-y-0.5 gap-x-0.5 text-[9px]"
                                          : "gap-y-1 gap-x-1 text-[10px]"
                                      }`}
                                    >
                                      {MISTAKE_REASONS.map((reason) => (
                                        <div key={reason} className="flex items-center gap-1">
                                          <div
                                            className={`rounded-[2px] border border-slate-400 bg-white shrink-0 ${
                                              isCornellCompact ? "w-2.5 h-2.5" : "w-3 h-3"
                                            }`}
                                          />
                                          <span className="truncate">{reason}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Mastery Level Rating — skip in compact to save space */}
                              {!isCornellCompact && (
                                <div className="pt-1.5 border-t border-slate-200 flex items-center justify-between text-[10px] text-slate-600">
                                  <span className="font-bold">掌握度：</span>
                                  <span className="tracking-widest text-slate-400 font-mono text-xs">
                                    ☆☆☆☆☆
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* RIGHT MAIN AREA: Question text + Math grid notebook workspace */}
                            <div
                              className={`flex-1 flex flex-col min-w-0 bg-white ${
                                isCornellCompact || isTwoUp ? "min-h-0" : "min-h-min"
                              }`}
                            >
                              {/* Top Question Body — natural height (no max-h clip); page fit shrinks density instead */}
                              <div
                                data-cornell-question
                                className={`border-b border-slate-200 shrink-0 ${
                                  isCornellCompact ? "p-1.5" : "p-2.5"
                                }`}
                              >
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-xs font-black px-2 py-0.5 rounded bg-slate-900 text-white font-mono">
                                    第 {index + 1} 題
                                  </span>
                                  {q.isSimilarVariant && (
                                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 border border-amber-300 font-bold">
                                      AI 舉一反三練習題
                                    </span>
                                  )}
                                  {q.difficulty && (
                                    <span className="text-[10px] px-1.5 py-0.2 rounded border border-slate-300 text-slate-600">
                                      難度：{q.difficulty}
                                    </span>
                                  )}
                                </div>

                                {/* Question Content based on displayMode */}
                                {displayMode === "imageOnly" ? (
                                  shouldRenderQuestionImage(q) ? (
                                    <div
                                      className={`my-1.5 flex ${
                                        q.imageSettings.align === "left"
                                          ? "justify-start"
                                          : q.imageSettings.align === "right"
                                          ? "justify-end"
                                          : "justify-center"
                                      }`}
                                    >
                                      <img
                                        src={normalizeImageSrc(q.imageBase64)}
                                        alt="題目原圖截圖"
                                        className={`w-auto max-w-full object-contain border border-slate-200 rounded shadow-2xs ${
                                          isCornellCompact
                                            ? "max-h-20"
                                            : "max-h-48 sm:max-h-56"
                                        }`}
                                        style={questionImageStyle(q.imageSettings)}
                                      />
                                    </div>
                                  ) : (
                                    <div className="text-xs text-slate-800 leading-relaxed whitespace-pre-line">
                                      <span className="text-[10px] text-amber-700 font-bold bg-amber-50 px-1 py-0.5 rounded mr-1">
                                        (此題無截圖照片，自動顯示文字)
                                      </span>
                                      <MathRenderer content={q.questionText} />
                                    </div>
                                  )
                                ) : displayMode === "textOnly" ||
                                  displayMode === "textPlain" ? (
                                  <div className="space-y-1">
                                    <div
                                      className={`text-slate-900 leading-relaxed whitespace-pre-line ${
                                        isCornellCompact ? "text-[11px]" : "text-xs"
                                      }`}
                                    >
                                      <MathRenderer content={q.questionText} />
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    {shouldRenderQuestionImage(q) && (
                                        <div
                                          className={`my-1.5 flex ${
                                            q.imageSettings.align === "left"
                                              ? "justify-start"
                                              : q.imageSettings.align === "right"
                                              ? "justify-end"
                                              : "justify-center"
                                          }`}
                                        >
                                          <img
                                            src={normalizeImageSrc(q.imageBase64)}
                                            alt="題目原圖"
                                            className={`max-w-full object-contain border border-slate-200 rounded ${
                                              isCornellCompact ? "max-h-16" : "max-h-28"
                                            }`}
                                            style={questionImageStyle(q.imageSettings)}
                                          />
                                        </div>
                                      )}
                                    <div
                                      className={`text-slate-900 leading-relaxed whitespace-pre-line ${
                                        isCornellCompact ? "text-[11px]" : "text-xs"
                                      }`}
                                    >
                                      <MathRenderer content={q.questionText} />
                                    </div>
                                  </>
                                )}
                              </div>

                              {displayMode === "textOnly" &&
                                (() => {
                                  const figureSrc = getTextOnlyFigureSrc(q);
                                  if (!figureSrc) return null;
                                  return (
                                    <div
                                      className={`border-b border-slate-200 bg-white ${
                                        isTwoUp
                                          ? "flex-1 min-h-0 overflow-hidden px-2 py-1"
                                          : isCornellCompact
                                            ? "shrink-0 px-1.5 py-1"
                                            : "shrink-0 px-2 py-1.5"
                                      }`}
                                    >
                                      <ExportFigure
                                        src={figureSrc}
                                        fit={isTwoUp}
                                        maxHeight={
                                          isCornellCompact
                                            ? FIGURE_MAX_HEIGHT.cornellCompact
                                            : FIGURE_MAX_HEIGHT.cornell
                                        }
                                      />
                                    </div>
                                  );
                                })()}
                              <CornellReview
                                isCornellCompact={isCornellCompact}
                                showGrid={settings.showGrid !== false}
                                showReviewTrack={settings.showReviewTrack !== false}
                                sharePage={isTwoUp}
                              />
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Sheet Bottom Footer */}
                      <div className="pt-2 mt-2 border-t border-slate-200 text-center text-[9px] text-slate-400 font-mono tracking-wider flex items-center justify-between">
                        <span>- 數位錯題本 · CORNELL MISTAKE LOG TEMPLATE -</span>
                        <span>
                          PAGE {pageIndex + 1} / {cornellPages.length}
                        </span>
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                /* NOTEBOOK & EXAM MODES */
                <div
                  className="paper-sheet bg-white text-slate-900 shadow-xl transition-all duration-200 border border-slate-300 font-serif mb-8"
                  style={{
                    width: paperWidthStyle,
                    minHeight: paperHeightStyle,
                    padding: "14mm 16mm",
                    boxSizing: "border-box",
                  }}
                >
                  {/* Paper Header */}
                  <div className="text-center pb-4 mb-5 border-b-2 border-slate-900">
                    <h1 className="text-xl md:text-2xl font-black tracking-widest text-slate-900 mb-1">
                      {settings.title || "數位錯題複習考卷"}
                    </h1>
                    {settings.subtitle && (
                      <p className="text-xs font-sans text-slate-600 mb-2">
                        {settings.subtitle}
                      </p>
                    )}

                    {/* Student Info Row */}
                    <div className="flex items-center justify-between text-xs font-sans border-t border-slate-300 pt-2 px-2 text-slate-700">
                      <div className="flex gap-4">
                        <span>
                          年級：<u>&nbsp;{settings.gradeClass || "________"}&nbsp;</u>
                        </span>
                        <span>
                          座號：<u>&nbsp;{settings.seatNumber || "____"}&nbsp;</u>
                        </span>
                        <span>
                          姓名：<u>&nbsp;{settings.studentName || "____________"}&nbsp;</u>
                        </span>
                      </div>
                      <div className="border border-slate-900 px-3 py-1 text-center font-bold">
                        得分：_________
                      </div>
                    </div>
                  </div>

                  {/* Questions List */}
                  <div className="space-y-6">
                    {exportQuestions.map((q, idx) => (
                      <div
                        key={q.id}
                        className="print-avoid-break pb-4 border-b border-slate-200/80 last:border-0"
                      >
                        <div className="flex items-baseline gap-2 mb-2 font-sans">
                          <span className="font-bold text-sm text-slate-900 font-mono">
                            {idx + 1}.
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded bg-slate-100 font-semibold text-slate-700">
                            【{q.subject}
                            {q.gradeLevel ? ` ${q.gradeLevel}` : ""}
                            {q.chapter ? ` · ${q.chapter}` : ""}
                            {` · ${q.unit}`}】
                          </span>
                          {q.isSimilarVariant && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-bold">
                              AI 舉一反三練習題
                            </span>
                          )}
                          {q.difficulty && (
                            <span className="text-[11px] text-slate-500">
                              難度：{q.difficulty}
                            </span>
                          )}
                        </div>

                        {/* Question Content based on displayMode */}
                        {displayMode === "imageOnly" ? (
                          shouldRenderQuestionImage(q) ? (
                            <div
                              className={`my-2 flex ${
                                q.imageSettings.align === "left"
                                  ? "justify-start"
                                  : q.imageSettings.align === "right"
                                  ? "justify-end"
                                  : "justify-center"
                              }`}
                            >
                              <img
                                src={normalizeImageSrc(q.imageBase64)}
                                alt="題目原圖截圖"
                                className="max-h-64 max-w-full object-contain border border-slate-200 rounded shadow-2xs"
                                style={questionImageStyle(q.imageSettings)}
                              />
                            </div>
                          ) : (
                            <div className="text-sm leading-relaxed whitespace-pre-line text-slate-900">
                              <span className="text-xs text-amber-700 font-bold bg-amber-50 px-1 py-0.5 rounded mr-1">
                                (此題無截圖照片，自動顯示文字)
                              </span>
                              <MathRenderer content={q.questionText} />
                            </div>
                          )
                        ) : displayMode === "textOnly" || displayMode === "textPlain" ? (
                          <div className="space-y-1.5">
                            <div className="text-sm leading-relaxed whitespace-pre-line text-slate-900">
                              <MathRenderer content={q.questionText} />
                            </div>
                            {displayMode === "textOnly" &&
                              (() => {
                                const figureSrc = getTextOnlyFigureSrc(q);
                                if (!figureSrc) return null;
                                return (
                                  <ExportFigure
                                    src={figureSrc}
                                    maxHeight={FIGURE_MAX_HEIGHT.paper}
                                  />
                                );
                              })()}
                          </div>
                        ) : (
                          <>
                            {shouldRenderQuestionImage(q) && (
                                <div
                                  className={`my-2 flex ${
                                    q.imageSettings.align === "left"
                                      ? "justify-start"
                                      : q.imageSettings.align === "right"
                                      ? "justify-end"
                                      : "justify-center"
                                  }`}
                                >
                                  <img
                                    src={normalizeImageSrc(q.imageBase64)}
                                    alt="題目原圖"
                                    className="max-h-52 max-w-full object-contain border border-slate-200 rounded"
                                    style={questionImageStyle(q.imageSettings)}
                                  />
                                </div>
                              )}
                            <div className="text-sm leading-relaxed whitespace-pre-line text-slate-900">
                              <MathRenderer content={q.questionText} />
                            </div>
                          </>
                        )}

                        {/* Exam Mode: Blank workspace for student work */}
                        {settings.mode === "exam" ? (
                          <div
                            className="mt-3 border border-dashed border-slate-300 rounded bg-slate-50/40 p-2"
                            style={{ height: `${settings.leaveBlankHeight || 100}px` }}
                          >
                            <span className="text-[10px] text-slate-400 font-sans">
                              【計算與作答區域】
                            </span>
                          </div>
                        ) : (
                          /* Notebook Mode: Analysis, Pitfalls, and Solution */
                          <div className="mt-3 space-y-2 font-sans bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
                            {q.answer && (
                              <div>
                                <span className="font-bold text-emerald-800">
                                  【參考答案】：
                                </span>
                                <span className="font-semibold text-emerald-900">
                                  <MathRenderer content={q.answer} />
                                </span>
                              </div>
                            )}
                            {q.coreConcepts && (
                              <div className="text-slate-700">
                                <span className="font-bold text-sky-800">
                                  【核心考點】：
                                </span>
                                <span><MathRenderer content={q.coreConcepts} /></span>
                              </div>
                            )}
                            {q.commonPitfalls && (
                              <div className="text-amber-800">
                                <span className="font-bold">【易錯陷阱】：</span>
                                <span><MathRenderer content={q.commonPitfalls} /></span>
                              </div>
                            )}
                            {q.explanation && (
                              <div className="text-slate-700 pt-1 border-t border-slate-200/80">
                                <span className="font-bold block text-slate-900 mb-0.5">
                                  【詳細推導步驟】：
                                </span>
                                <div className="whitespace-pre-line text-slate-600">
                                  <MathRenderer content={q.explanation} breakNumberedSteps />
                                </div>
                              </div>
                            )}
                            {q.myNotes && (
                              <div className="text-indigo-800 bg-indigo-50/70 p-1.5 rounded">
                                <span className="font-bold">【個人覆盤】：</span>
                                <MathRenderer content={q.myNotes} />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Page Footer */}
                  <div className="mt-8 pt-4 border-t border-slate-300 text-center text-[10px] text-slate-400 font-sans">
                    數位錯題本與自組考卷系統 · 高清 {settings.paperSize} 標準尺寸輸出
                  </div>
                </div>
              )}

              {/* Appendix: Answer & Solution Sheet if requested */}
              {settings.includeAnswerSheet && (
                <div
                  className="paper-sheet bg-white text-slate-900 shadow-xl transition-all duration-200 border border-slate-300 font-sans mb-8"
                  style={{
                    width: paperWidthStyle,
                    minHeight: paperHeightStyle,
                    padding: "14mm 16mm",
                    boxSizing: "border-box",
                  }}
                >
                  <div className="text-center pb-3 mb-4 border-b-2 border-slate-900">
                    <h2 className="text-lg font-black tracking-wider text-slate-900 mb-1">
                      【參考答案與詳細步驟解析】
                    </h2>
                    <p className="text-xs text-slate-500">
                      適用試卷：{settings.title || "錯題複習強化卷"} · 共 {exportQuestions.length} 題
                      {exportSubject !== "全部" ? `（${exportSubject}）` : ""}
                    </p>
                  </div>

                  <div className="space-y-4 text-xs">
                    {exportQuestions.map((q, idx) => (
                      <div
                        key={q.id}
                        className="p-3 bg-slate-50 rounded-lg border border-slate-200 print-avoid-break"
                      >
                        <div className="font-bold text-slate-900 text-sm mb-1.5 flex items-center justify-between border-b border-slate-200 pb-1">
                          <span>
                            第 {idx + 1} 題【{q.subject}
                            {q.gradeLevel ? ` ${q.gradeLevel}` : ""}
                            {q.chapter ? ` · ${q.chapter}` : ""} · {q.unit}】
                          </span>
                          <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            標準答案：<MathRenderer content={q.answer || "詳見解題過程"} />
                          </span>
                        </div>
                        {q.coreConcepts && (
                          <div className="mb-1 text-slate-700">
                            <span className="font-bold text-sky-800">核心考點：</span>
                            <MathRenderer content={q.coreConcepts} />
                          </div>
                        )}
                        {q.variationPoint && (
                          <div className="mb-1 text-amber-800">
                            <span className="font-bold">改編亮點：</span>
                            {q.variationPoint}
                          </div>
                        )}
                        {q.commonPitfalls && (
                          <div className="mb-1.5 text-amber-800">
                            <span className="font-bold">易錯陷阱：</span>
                            <MathRenderer content={q.commonPitfalls} />
                          </div>
                        )}
                        <div className="text-slate-600 whitespace-pre-line leading-relaxed pt-1 border-t border-slate-200/60">
                          <span className="font-bold text-slate-800 block mb-0.5">
                            詳細推導：
                          </span>
                          <MathRenderer content={q.explanation} breakNumberedSteps />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-8 pt-4 border-t border-slate-300 text-center text-[10px] text-slate-400">
                    - 附錄解答頁結束 -
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Modal Bottom Footer Actions */}
        <div className="app-safe-footer px-4 pt-3 md:px-6 md:pt-3.5 bg-white border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shrink-0 no-print">
          <div className="text-[11px] sm:text-xs text-slate-500 flex items-center gap-1.5 sm:gap-2 flex-wrap min-w-0">
            <span>
              匯出 {exportQuestions.length} 道
              {exportSubject !== "全部" ? `「${exportSubject}」` : ""}試題
              {typeof notebookTotal === "number" && notebookTotal !== exportQuestions.length
                ? `（錯題本共 ${notebookTotal}）`
                : ""}
              {settings.mode === "cornell"
                ? isCornellCompact
                  ? ` · 密排約 ${cornellPageSize} 題／頁${
                      cornellFitReduced ? "（已自動降密以免裁切）" : ""
                    }`
                  : ` · 每頁 ${cornellPageSize} 題`
                : ""}
            </span>
            <span className="hidden sm:inline">·</span>
            <span>
              規格：{settings.paperSize} ({settings.paperSize === "B5" ? "182×257mm" : "210×297mm"})
            </span>
            <span className="hidden sm:inline">·</span>
            <span className="font-semibold text-slate-700">
              {settings.mode === "cornell"
                ? `康乃爾訂正本 (${cornellPages.length} 頁)`
                : settings.mode === "notebook"
                ? "錯題精讀本"
                : "自組測驗卷"}
            </span>
            <span className="hidden sm:inline">·</span>
            <span className="text-slate-600 hidden sm:inline">
              {displayMode === "imageOnly"
                ? "僅截圖照片 (無文字)"
                : displayMode === "both"
                ? "文字與照片"
                : displayMode === "textPlain"
                ? "純文字（無截圖）"
                : "排版文字＋圖區（無文字圖）"}
            </span>
          </div>

          <div className="flex items-stretch sm:items-center gap-2 sm:gap-3 w-full sm:w-auto">
            {!showPreview ? (
              <button
                type="button"
                onClick={() => setShowPreview(true)}
                className="w-full sm:w-auto px-4 sm:px-5 py-2.5 sm:py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 active:scale-95 rounded-xl transition flex items-center justify-center gap-1.5 shadow-md"
              >
                <Eye className="w-4 h-4 shrink-0" />
                預覽排版
              </button>
            ) : (
              <>
                <button
                  id="print-browser-btn"
                  type="button"
                  onClick={handlePrint}
                  className="flex-1 sm:flex-none px-4 sm:px-5 py-2.5 sm:py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 active:scale-95 rounded-xl transition flex items-center justify-center gap-1.5 shadow-md"
                >
                  <Printer className="w-4 h-4 shrink-0" />
                  列印
                </button>
                <button
                  type="button"
                  onClick={() => setShowPreview(false)}
                  className="px-3 sm:px-4 py-2.5 sm:py-2 text-xs font-semibold text-slate-600 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl transition"
                >
                  返回設定
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
