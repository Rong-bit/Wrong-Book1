import React, { useState, useRef } from "react";
import {
  X,
  Printer,
  Download,
  FileText,
  Settings2,
  CheckCircle,
  Loader2,
  BookOpen,
  GraduationCap,
  LayoutTemplate,
  AlertTriangle,
  CheckSquare,
  Sparkles,
  Image as ImageIcon,
  Camera,
  AlignLeft,
} from "lucide-react";
import { PaperSettings, QuestionItem, PaperSize } from "../types";
import { exportToHighDefPdf } from "../services/pdfService";
import { MathRenderer } from "./MathRenderer";

interface PdfExportModalProps {
  isOpen: boolean;
  questions: QuestionItem[];
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

export const PdfExportModal: React.FC<PdfExportModalProps> = ({
  isOpen,
  questions,
  settings,
  onClose,
  onUpdateSettings,
}) => {
  const [isExporting, setIsExporting] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  const handleDownloadPdf = async () => {
    if (!previewRef.current) return;
    setIsExporting(true);
    setExportError(null);
    try {
      await exportToHighDefPdf(previewRef.current, settings, (msg) => {
        setProgressText(msg);
      });
    } catch (err: any) {
      console.error("PDF export failed:", err);
      const msg = err?.message || "產生 PDF 時發生未知問題";
      setExportError(msg);
    } finally {
      setIsExporting(false);
      setProgressText("");
    }
  };

  const handlePrint = () => {
    window.print();
  };

  // Chunk questions for Cornell mode
  const cornellPageSize = settings.questionsPerPage || 2;
  const cornellPages: { pageIndex: number; questions: { q: QuestionItem; index: number }[] }[] = [];
  for (let i = 0; i < questions.length; i += cornellPageSize) {
    const chunk = questions.slice(i, i + cornellPageSize).map((q, offset) => ({
      q,
      index: i + offset,
    }));
    cornellPages.push({
      pageIndex: Math.floor(i / cornellPageSize),
      questions: chunk,
    });
  }

  const paperWidthStyle = settings.paperSize === "B5" ? "182mm" : "210mm";
  const paperHeightStyle = settings.paperSize === "B5" ? "257mm" : "297mm";

  const displayMode =
    settings.questionDisplayMode ||
    (settings.includeImages ? "both" : "textOnly");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-2 md:p-6 animate-in fade-in duration-200">
      <div className="bg-slate-100 rounded-2xl shadow-2xl max-w-6xl w-full h-[95vh] flex flex-col overflow-hidden border border-slate-300">
        {/* Top Header */}
        <div className="px-6 py-4 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center border border-sky-200">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                高清 PDF 錯題本排版與匯出
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium">
                  {settings.mode === "cornell"
                    ? "康乃爾雙欄訂正本"
                    : settings.mode === "notebook"
                    ? "錯題精讀本"
                    : "自組測驗卷"}
                </span>
              </h3>
              <p className="text-xs text-slate-500">
                支援康乃爾雙欄訂正、5mm 數學方格微網格、艾賓浩斯 5 次複習打卡，符合 B5 / A4 高清輸出
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
          <div className="px-6 py-2.5 bg-rose-50 border-b border-rose-200 text-xs text-rose-800 flex items-center justify-between gap-3 shrink-0">
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

        {/* Content Body: Left Settings Panel + Right Live Paper Preview */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Settings Sidebar */}
          <div className="w-full md:w-84 bg-white border-r border-slate-200 p-5 overflow-y-auto shrink-0 space-y-4 text-xs">
            <div className="flex items-center gap-1.5 font-bold text-slate-800 text-sm pb-1 border-b border-slate-100">
              <Settings2 className="w-4 h-4 text-sky-600" />
              版面規格與排版風格
            </div>

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
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSettings({ ...settings, questionsPerPage: 2 })
                      }
                      className={`py-1.5 px-2 rounded-lg border text-center transition ${
                        (settings.questionsPerPage || 2) === 2
                          ? "bg-amber-600 text-white border-amber-600 font-bold"
                          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      每頁 2 題 (黃金比例)
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
                      每頁 1 題 (超大演算)
                    </button>
                  </div>
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
                  placeholder="例：經典錯題強化與訂正筆記本"
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
                  placeholder="例：範圍：一元二次方程式 · 牛頓運動定律"
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 focus:bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    班級 / 年級
                  </label>
                  <input
                    type="text"
                    value={settings.gradeClass}
                    onChange={(e) =>
                      onUpdateSettings({ ...settings, gradeClass: e.target.value })
                    }
                    placeholder="例：九年級"
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

                {/* Option 3: Text Only */}
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
                      <span className="block text-xs">僅排版文字 (無截圖)</span>
                      <span className="block text-[10px] text-slate-500 font-normal">
                        純文字印刷排版，節省頁面空間與墨水
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

          {/* Live Preview Canvas View */}
          <div className="flex-1 bg-slate-300/80 p-4 md:p-8 overflow-y-auto flex flex-col items-center">
            <div ref={previewRef} id="printable-paper-container" className="w-full flex flex-col items-center">
              {/* CORNELL MODE RENDERING */}
              {settings.mode === "cornell" ? (
                <>
                  {cornellPages.map(({ pageIndex, questions: pageQs }) => (
                    <div
                      key={`cornell-page-${pageIndex}`}
                      className="paper-sheet bg-white text-slate-900 shadow-xl transition-all duration-200 border border-slate-300 font-sans mb-8 relative flex flex-col justify-between"
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
                              {settings.title || "錯題訂正與強化筆記本"}
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
                            班級：<u>&nbsp;{settings.gradeClass || "________"}&nbsp;</u>
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
                      <div className="flex-1 min-h-0 flex flex-col gap-2.5">
                        {pageQs.map(({ q, index }, qIdx) => (
                          <div
                            key={q.id}
                            className="flex-1 min-h-0 border border-slate-300 rounded-lg overflow-hidden flex flex-row relative bg-white"
                          >
                            {/* LEFT SIDEBAR: Metadata & Mistake Reason Analysis */}
                            <div className="w-48 sm:w-52 shrink-0 bg-slate-50 border-r border-slate-300 p-2.5 flex flex-col justify-between text-[11px] font-sans">
                              <div className="space-y-2">
                                {/* Date and Subject / Source */}
                                <div>
                                  <div className="flex items-center justify-between text-slate-500 text-[10px] font-mono border-b border-slate-200 pb-0.5 mb-1">
                                    <span className="font-bold tracking-wider text-slate-700">DATE</span>
                                    <span>____ / ___ / ___</span>
                                  </div>
                                  <div className="font-semibold text-slate-800 flex items-center gap-1">
                                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-sky-100 text-sky-800 font-bold">
                                      {q.subject || "科目"}
                                    </span>
                                    <span className="text-[10px] text-slate-500 truncate">
                                      來源: ___________
                                    </span>
                                  </div>
                                </div>

                                {/* Grade / Volume / Chapter */}
                                <div>
                                  <div className="text-[10px] text-slate-500 font-bold">主題 / 冊別</div>
                                  <div className="text-slate-800 font-medium text-[11px] leading-tight">
                                    {q.gradeLevel || "冊別待定"}
                                    {q.chapter ? ` · ${q.chapter}` : ""}
                                  </div>
                                </div>

                                {/* Core Knowledge Point */}
                                <div>
                                  <div className="text-[10px] text-slate-500 font-bold">核心考點</div>
                                  <div className="text-slate-900 font-bold text-[11px] leading-tight text-amber-900 bg-amber-50/70 p-1 rounded border border-amber-200/60">
                                    {q.unit || "觀念綜合"}
                                  </div>
                                </div>

                                {/* Mistake Reason Checklist */}
                                {settings.showCheckboxes !== false && (
                                  <div>
                                    <div className="text-[10px] text-slate-600 font-bold mb-1 flex items-center justify-between">
                                      <span>原因分析 (可複選)</span>
                                      <span className="text-[9px] text-slate-400">WHY</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-y-1 gap-x-1 text-[10px] text-slate-700">
                                      {MISTAKE_REASONS.map((reason) => (
                                        <div key={reason} className="flex items-center gap-1">
                                          <div className="w-3 h-3 rounded-[2px] border border-slate-400 bg-white" />
                                          <span className="truncate">{reason}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Mastery Level Rating */}
                              <div className="pt-1.5 border-t border-slate-200 flex items-center justify-between text-[10px] text-slate-600">
                                <span className="font-bold">掌握度：</span>
                                <span className="tracking-widest text-slate-400 font-mono text-xs">
                                  ☆☆☆☆☆
                                </span>
                              </div>
                            </div>

                            {/* RIGHT MAIN AREA: Question text + Math grid notebook workspace */}
                            <div className="flex-1 flex flex-col min-w-0 bg-white">
                              {/* Top Question Body */}
                              <div className="p-2.5 border-b border-slate-200 max-h-[48%] overflow-y-auto">
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
                                  q.imageBase64 && q.imageSettings?.includeInExport ? (
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
                                        src={q.imageBase64}
                                        alt="題目原圖截圖"
                                        className="max-h-48 sm:max-h-56 w-auto object-contain border border-slate-200 rounded shadow-2xs"
                                        style={{
                                          transform: `rotate(${q.imageSettings.rotation || 0}deg) scale(${
                                            (q.imageSettings.zoom || 100) / 100
                                          })`,
                                        }}
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
                                ) : (
                                  <>
                                    {displayMode === "both" &&
                                      q.imageBase64 &&
                                      q.imageSettings?.includeInExport && (
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
                                            src={q.imageBase64}
                                            alt="題目原圖"
                                            className="max-h-28 object-contain border border-slate-200 rounded"
                                            style={{
                                              transform: `rotate(${q.imageSettings.rotation || 0}deg) scale(${
                                                (q.imageSettings.zoom || 100) / 100
                                              })`,
                                            }}
                                          />
                                        </div>
                                      )}
                                    <div className="text-xs text-slate-900 leading-relaxed whitespace-pre-line">
                                      <MathRenderer content={q.questionText} />
                                    </div>
                                  </>
                                )}
                              </div>

                              {/* Bottom Handwritten Math Grid & Spaced Repetition Checklist */}
                              <div
                                className={`flex-1 p-2 flex flex-col justify-between relative ${
                                  settings.showGrid !== false ? "math-grid-bg" : "bg-white"
                                }`}
                              >
                                <div className="text-[10px] text-slate-400 font-sans tracking-wider pointer-events-none select-none">
                                  【演算推導 · 思維訂正筆記區】
                                </div>

                                {/* Spaced Repetition Review Bar */}
                                {settings.showReviewTrack !== false && (
                                  <div className="self-end bg-white/95 px-2.5 py-1 rounded-md border border-slate-300/80 shadow-2xs flex items-center gap-2 text-[10px] text-slate-700">
                                    <span className="font-bold text-slate-800">
                                      艾賓浩斯複習打卡 (V/X)：
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                      {REVIEW_INTERVALS.map((label, idx) => (
                                        <div key={label} className="flex flex-col items-center">
                                          <div className="w-4 h-4 rounded-[2px] border-2 border-slate-400 bg-white" />
                                          <span className="text-[8px] text-slate-400 mt-0.5">
                                            {label}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
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
                          班級：<u>&nbsp;{settings.gradeClass || "________"}&nbsp;</u>
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
                    {questions.map((q, idx) => (
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
                          q.imageBase64 && q.imageSettings?.includeInExport ? (
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
                                src={q.imageBase64}
                                alt="題目原圖截圖"
                                className="max-h-64 object-contain border border-slate-200 rounded shadow-2xs"
                                style={{
                                  transform: `rotate(${q.imageSettings.rotation || 0}deg) scale(${
                                    (q.imageSettings.zoom || 100) / 100
                                  })`,
                                  transformOrigin: "center center",
                                }}
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
                        ) : (
                          <>
                            {displayMode === "both" &&
                              q.imageBase64 &&
                              q.imageSettings?.includeInExport && (
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
                                    src={q.imageBase64}
                                    alt="題目原圖"
                                    className="max-h-52 object-contain border border-slate-200 rounded"
                                    style={{
                                      transform: `rotate(${q.imageSettings.rotation || 0}deg) scale(${
                                        (q.imageSettings.zoom || 100) / 100
                                      })`,
                                      transformOrigin: "center center",
                                    }}
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
                                  <MathRenderer content={q.explanation} />
                                </div>
                              </div>
                            )}
                            {q.myNotes && (
                              <div className="text-indigo-800 bg-indigo-50/70 p-1.5 rounded">
                                <span className="font-bold">【個人覆盤】：</span>
                                <span>{q.myNotes}</span>
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
                      適用試卷：{settings.title || "錯題複習強化卷"} · 共 {questions.length} 題
                    </p>
                  </div>

                  <div className="space-y-4 text-xs">
                    {questions.map((q, idx) => (
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
                          <MathRenderer content={q.explanation} />
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

        {/* Modal Bottom Footer Actions */}
        <div className="px-6 py-3.5 bg-white border-t border-slate-200 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-500 flex items-center gap-2">
            <span>已加入 {questions.length} 道試題</span>
            <span>·</span>
            <span>
              規格：{settings.paperSize} ({settings.paperSize === "B5" ? "182×257mm" : "210×297mm"})
            </span>
            <span>·</span>
            <span className="font-semibold text-slate-700">
              {settings.mode === "cornell"
                ? `康乃爾訂正本 (${cornellPages.length} 頁)`
                : settings.mode === "notebook"
                ? "錯題精讀本"
                : "自組測驗卷"}
            </span>
            <span>·</span>
            <span className="text-slate-600">
              {displayMode === "imageOnly"
                ? "僅截圖照片 (無文字)"
                : displayMode === "both"
                ? "文字與照片"
                : "純文字"}
            </span>
            {progressText && (
              <span className="text-sky-600 font-semibold flex items-center gap-1 animate-pulse ml-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> {progressText}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              id="print-browser-btn"
              type="button"
              onClick={handlePrint}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl transition flex items-center gap-1.5 shadow-xs"
            >
              <Printer className="w-4 h-4 text-slate-600" />
              瀏覽器原生列印 (或另存 PDF)
            </button>
            <button
              id="download-highdef-pdf-btn"
              type="button"
              disabled={isExporting}
              onClick={handleDownloadPdf}
              className="px-5 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 active:scale-95 rounded-xl transition flex items-center gap-1.5 shadow-md disabled:opacity-50"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  產生高畫質 PDF 中...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  下載高清 {settings.paperSize} PDF 檔案
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
