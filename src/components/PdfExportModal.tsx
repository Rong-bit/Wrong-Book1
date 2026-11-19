import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  X,
  Download,
  Loader2,
  FileText,
  Settings2,
  BookOpen,
  GraduationCap,
  LayoutTemplate,
  AlertTriangle,
  CheckSquare,
  Sparkles,
  Eye,
  AlignLeft,
} from "lucide-react";
import { PaperSettings, QuestionItem } from "../types";
import { MathRenderer } from "./MathRenderer";
import { normalizeImageSrc } from "../utils/imageUtils";
import { getTextOnlyFigureSrc } from "../utils/questionExport";
import { exportToHighDefPdf } from "../services/pdfService";
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
  cornell: "96mm",
  paper: "112mm",
} as const;

function ExportFigure({
  src,
  maxHeight,
  fit = false,
}: {
  src: string;
  maxHeight?: string;
  /**
   * true: shrink into the flex-grown cell (每頁 2 題／背科精簡).
   * Large maps scale down with object-contain instead of overflowing.
   */
  fit?: boolean;
}) {
  if (fit) {
    // Shrink oversized maps into the flex slot; border hugs the scaled bitmap.
    return (
      <div className="print-figure h-full w-full min-h-0 min-w-0 flex items-center justify-center overflow-hidden">
        <img
          src={normalizeImageSrc(src)}
          alt="題目附圖（地圖／圖示）"
          className="print-figure-img block max-h-full max-w-full w-auto h-auto min-h-0 min-w-0 object-contain object-center border border-slate-300 bg-white rounded-sm"
        />
      </div>
    );
  }
  return (
    <div className="print-figure flex w-full justify-end items-start">
      <img
        src={normalizeImageSrc(src)}
        alt="題目附圖（地圖／圖示）"
        className="print-figure-img block w-auto max-w-full h-auto object-contain object-right-top border border-slate-300 bg-white rounded-sm"
        style={maxHeight ? { maxHeight } : undefined}
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
  const [isExporting, setIsExporting] = useState(false);
  const [progressText, setProgressText] = useState("");
  /**
   * Phone preview: transform-scale the full A4/B5 sheet to fit the modal width.
   * Do NOT use CSS `zoom` — Safari iOS reflows mm/flex at the zoomed width and
   * crushes the Cornell header into vertical one-character columns.
   * Scale wrapper is outside previewRef so print clone stays full size.
   */
  const [previewScale, setPreviewScale] = useState(1);
  const [previewLayout, setPreviewLayout] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const previewRef = useRef<HTMLDivElement>(null);
  const previewCanvasRef = useRef<HTMLDivElement>(null);
  const previewScaleRef = useRef<HTMLDivElement>(null);

  const isCornellCompact = settings.questionsPerPage === "compact";
  /** 背科精簡固定 4 題；圖形縮進每格剩餘高度。每頁 1／2 題也固定題數。 */
  const requestedCornellCap = useMemo(() => {
    if (settings.questionsPerPage === "compact") return 4;
    if (settings.questionsPerPage === 1) return 1;
    return 2;
  }, [settings.questionsPerPage]);
  /** 每頁 2 題：兩張卡片各占半頁，圖形縮進該題範圍。背科精簡同樣把圖縮進格子，固定 4 題。 */
  const isTwoUp = !isCornellCompact && requestedCornellCap === 2;
  const scaleFigure = isTwoUp || isCornellCompact;

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
      setIsExporting(false);
      setProgressText("");
      return;
    }
    // Export is fixed to typeset text + figure attach; normalize legacy modes.
    if (
      settings.questionDisplayMode !== "textOnly" ||
      settings.includeImages !== false
    ) {
      onUpdateSettings({
        ...settings,
        questionDisplayMode: "textOnly",
        includeImages: false,
      });
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

  const cornellPageSize = requestedCornellCap;

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

  // Fit the on-screen preview to the phone width via transform:scale + a
  // reserved layout box (transform alone would leave a huge empty scroll area).
  useEffect(() => {
    if (!isOpen || !showPreview) {
      setPreviewScale(1);
      setPreviewLayout({ width: 0, height: 0 });
      return;
    }
    const canvas = previewCanvasRef.current;
    const inner = previewRef.current;
    const scaleEl = previewScaleRef.current;
    if (!canvas || !inner || !scaleEl) return;

    const update = () => {
      const paperMm = settings.paperSize === "B5" ? 182 : 210;
      const paperPx = paperMm * (96 / 25.4);
      const available = Math.max(0, canvas.clientWidth - 8);
      const next = available > 0 ? Math.min(1, available / paperPx) : 1;
      const scale = Number.isFinite(next) && next > 0 ? next : 1;
      // Measure unscaled layout size (offset* ignores ancestor transforms).
      const rawW = Math.max(inner.scrollWidth, paperPx);
      const rawH = Math.max(inner.scrollHeight, 1);
      setPreviewScale(scale);
      setPreviewLayout({ width: rawW * scale, height: rawH * scale });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(canvas);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [isOpen, showPreview, settings.paperSize, cornellPages.length]);

  if (!isOpen) return null;

  const handleDownloadPdf = async () => {
    const source =
      previewRef.current ||
      document.getElementById("printable-paper-container");
    if (!source) return;

    setIsExporting(true);
    setExportError(null);
    // Capture at full A4/B5 layout — phone preview transform must not shrink pages.
    const prevScale = previewScale;
    setPreviewScale(1);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    try {
      await exportToHighDefPdf(source, settings, (msg) => setProgressText(msg));
    } catch (err: unknown) {
      console.error("PDF export failed:", err);
      const msg =
        err instanceof Error ? err.message : "產生 PDF 時發生未知問題";
      setExportError(msg);
    } finally {
      setPreviewScale(prevScale);
      setIsExporting(false);
      setProgressText("");
    }
  };

  const paperWidthStyle = settings.paperSize === "B5" ? "182mm" : "210mm";
  const paperHeightStyle = settings.paperSize === "B5" ? "257mm" : "297mm";

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
                  ? "確認紙張畫面無誤後，再下載 PDF"
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
                onClick={() => void handleDownloadPdf()}
                disabled={isExporting || !showPreview}
                className="px-2.5 py-1 text-[11px] font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition disabled:opacity-60"
              >
                再試一次下載 PDF
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
              調整完成後按「預覽排版」，會另開畫面顯示紙張。確認無誤後再下載 PDF。
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
                    較小本、學校練習簿
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
                    家用印表機預設
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
                      <div className="text-[9px] opacity-80 mt-0.5">半頁一題 · 圖隨格縮放</div>
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
                      <div className="text-[9px] opacity-80 mt-0.5">四題一頁 · 圖隨格縮放</div>
                    </button>
                  </div>
                  {settings.questionsPerPage === "compact" ? (
                    <p className="mt-1.5 text-[10px] text-amber-800/90 leading-snug">
                      固定每頁 4 題。圖形依每一格剩下的高度縮放（寬圖偏扁、高圖偏窄），題幹在圖上、複習列在圖下。
                    </p>
                  ) : settings.questionsPerPage === 1 ? (
                    <p className="mt-1.5 text-[10px] text-amber-800/90 leading-snug">
                      固定每頁 1 題，圖形與演算區用滿該頁。
                    </p>
                  ) : (
                    <p className="mt-1.5 text-[10px] text-amber-800/90 leading-snug">
                      固定每頁 2 題，每一題占半頁。題幹在上、圖形縮進中間剩餘高度、複習區固定貼底，避免高圖／寬圖把版面擠歪。
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

            {/* Fixed export layout: typeset stem + optional figure */}
            <div className="pt-2 border-t border-slate-100 space-y-2">
              <div className="w-full p-2.5 rounded-xl border border-indigo-200 bg-indigo-50/80 text-indigo-950 flex items-start gap-2">
                <AlignLeft className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold">排版文字（附圖形）</div>
                  <p className="text-[10px] text-indigo-900/80 font-normal mt-0.5 leading-relaxed">
                    題幹印辨識文字；有「選圖形」才緊接題幹附上地圖／圖區，複習區在圖下。文字截圖辨識後不保留，也不再匯出。
                  </p>
                </div>
              </div>

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
          <div
            ref={previewCanvasRef}
            className="print-preview-canvas flex-1 min-h-0 bg-slate-300/80 p-4 md:p-8 overflow-y-auto overflow-x-hidden flex flex-col items-center"
          >
            {/* Transform scale (not zoom) lives outside previewRef so print stays full A4/B5. */}
            <div
              className="print-preview-fit"
              style={
                previewScale < 0.999 && previewLayout.width > 0
                  ? {
                      width: previewLayout.width,
                      height: previewLayout.height,
                      overflow: "hidden",
                      flexShrink: 0,
                    }
                  : undefined
              }
            >
              <div
                ref={previewScaleRef}
                className="print-preview-scale"
                style={
                  previewScale < 0.999
                    ? {
                        transform: `scale(${previewScale})`,
                        transformOrigin: "top left",
                        width: settings.paperSize === "B5" ? "182mm" : "210mm",
                      }
                    : undefined
                }
              >
            <div
              ref={previewRef}
              id="printable-paper-container"
              className="flex flex-col items-center"
              style={{
                width: settings.paperSize === "B5" ? "182mm" : "210mm",
              }}
            >
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
                      {/* Sheet Top Header — meta stacks on the right so long
                          年級／副標 cannot crush the title into vertical glyphs. */}
                      <div className="pb-2 mb-2 border-b-2 border-slate-900 flex items-end justify-between gap-3 min-w-0">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h1 className="text-base font-black tracking-wider text-slate-900 shrink-0">
                              {settings.title || "錯題訂正本"}
                            </h1>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-bold tracking-widest shrink-0">
                              CORNELL NOTE
                            </span>
                          </div>
                          {settings.subtitle && (
                            <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2 break-words">
                              {settings.subtitle}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-0.5 text-[11px] text-slate-700 shrink-0 max-w-[46%] min-w-0">
                          <span className="truncate max-w-full">
                            年級：<u>&nbsp;{settings.gradeClass || "________"}&nbsp;</u>
                          </span>
                          <span className="whitespace-nowrap">
                            姓名：<u>&nbsp;{settings.studentName || "____________"}&nbsp;</u>
                          </span>
                          <span className="whitespace-nowrap">
                            日期：<u>&nbsp;________/____/____&nbsp;</u>
                          </span>
                        </div>
                      </div>

                      {/* Questions in this sheet */}
                      <div
                        data-cornell-body
                        data-cornell-two-up={isTwoUp ? "1" : undefined}
                        className={`flex-1 min-h-0 flex flex-col overflow-hidden ${
                          isCornellCompact ? "gap-1.5 justify-start" : "gap-2.5"
                        }`}
                      >
                        {pageQs.map(({ q, index }, qIdx) => (
                          <div
                            key={q.id}
                            data-cornell-card
                            className={`border border-slate-300 rounded-lg overflow-hidden flex flex-row relative bg-white ${
                              isTwoUp
                                ? "flex-1 min-h-0 basis-0"
                                : scaleFigure
                                  ? "flex-1 min-h-0"
                                  : "flex-1 min-h-min"
                            }`}
                          >
                            {/* LEFT SIDEBAR: Metadata & Mistake Reason Analysis */}
                            <div
                              data-cornell-sidebar
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
                              className={`flex-1 min-w-0 bg-white flex flex-col ${
                                scaleFigure ? "min-h-0" : "min-h-min"
                              }`}
                            >
                              {/* Top Question Body — natural height; 2-up keeps review pinned under a flex figure slot */}
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

                                <div className="space-y-1">
                                  <div
                                    className={`text-slate-900 leading-relaxed whitespace-pre-line ${
                                      isCornellCompact ? "text-[11px]" : "text-xs"
                                    }`}
                                  >
                                    <MathRenderer content={q.questionText} />
                                  </div>
                                </div>
                              </div>

                              {(() => {
                                const figureSrc = getTextOnlyFigureSrc(q);
                                // 每頁 2 題：即使沒有圖也留 flex 空槽，讓兩題的複習區都貼在卡片底部對齊
                                if (isTwoUp) {
                                  return (
                                    <div
                                      data-cornell-figure-slot
                                      className="flex-1 min-h-0 min-w-0 overflow-hidden border-b border-slate-200 bg-white px-1.5 py-1 flex items-center justify-center"
                                    >
                                      {figureSrc ? (
                                        <ExportFigure src={figureSrc} fit />
                                      ) : null}
                                    </div>
                                  );
                                }
                                if (!figureSrc) return null;
                                return (
                                  <div
                                    className={`border-b border-slate-200 bg-white ${
                                      scaleFigure
                                        ? "flex-1 min-h-0 overflow-hidden px-1.5 py-1"
                                        : "shrink-0 px-2 py-1.5"
                                    }`}
                                  >
                                    <ExportFigure
                                      src={figureSrc}
                                      fit={scaleFigure}
                                      maxHeight={FIGURE_MAX_HEIGHT.cornell}
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

                        <div className="space-y-1.5">
                          <div className="text-sm leading-relaxed whitespace-pre-line text-slate-900">
                            <MathRenderer content={q.questionText} />
                          </div>
                          {(() => {
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
                ? ` · 每頁 ${cornellPageSize} 題`
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
              排版文字＋圖區
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
                  id="download-pdf-btn"
                  type="button"
                  onClick={() => void handleDownloadPdf()}
                  disabled={isExporting}
                  className="flex-1 sm:flex-none px-4 sm:px-5 py-2.5 sm:py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 active:scale-95 rounded-xl transition flex items-center justify-center gap-1.5 shadow-md disabled:opacity-60 disabled:pointer-events-none"
                >
                  {isExporting ? (
                    <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4 shrink-0" />
                  )}
                  {isExporting ? progressText || "產生 PDF 中…" : "下載 PDF"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowPreview(false)}
                  disabled={isExporting}
                  className="px-3 sm:px-4 py-2.5 sm:py-2 text-xs font-semibold text-slate-600 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl transition disabled:opacity-60"
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
