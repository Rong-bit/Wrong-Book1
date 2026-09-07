import React from "react";
import {
  BookOpen,
  FileDown,
  Key,
  Layers,
  FileText,
  Grid,
  CheckCircle2,
  Sparkles,
  HardDrive,
} from "lucide-react";
import { ViewLayout } from "../types";

interface NavbarProps {
  currentLayout: ViewLayout;
  onLayoutChange: (layout: ViewLayout) => void;
  onOpenByok: () => void;
  onOpenExportPdf: () => void;
  onOpenBackup: () => void;
  hasCustomKey: boolean;
  maskedCustomKey?: string;
  questionCount: number;
  selectedFilter: string;
  onFilterChange: (subject: string) => void;
  availableSubjects: string[];
}

export const Navbar: React.FC<NavbarProps> = ({
  currentLayout,
  onLayoutChange,
  onOpenByok,
  onOpenExportPdf,
  onOpenBackup,
  hasCustomKey,
  maskedCustomKey,
  questionCount,
  selectedFilter,
  onFilterChange,
  availableSubjects,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/90 shadow-2xs no-print">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        {/* Logo & Title */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-600 text-white flex items-center justify-center shadow-md shadow-sky-500/10">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                數位錯題本
              </h1>
              <span className="hidden sm:inline-block text-[11px] font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-800">
                考卷組題系統
              </span>
            </div>
            <p className="text-[11px] text-slate-500 hidden md:block">
              Ctrl+V / 手機拍照即錄 · AI 自動辨識單元 · 高清 B5/A4 考卷導出
            </p>
          </div>
        </div>

        {/* Center: Layout View Switcher */}
        <div className="hidden lg:flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200/60">
          <button
            id="view-notebook-btn"
            type="button"
            onClick={() => onLayoutChange("notebook")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              currentLayout === "notebook"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 text-amber-600" />
            錯題精讀本
          </button>
          <button
            id="view-paper-btn"
            type="button"
            onClick={() => onLayoutChange("paper")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              currentLayout === "paper"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-indigo-600" />
            自組試卷排版
          </button>
          <button
            id="view-grid-btn"
            type="button"
            onClick={() => onLayoutChange("grid")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              currentLayout === "grid"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Grid className="w-3.5 h-3.5 text-sky-600" />
            卡片總覽
          </button>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2 sm:gap-2.5">
          {/* BYOK Button */}
          <button
            id="open-byok-btn"
            type="button"
            onClick={onOpenByok}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition flex items-center gap-1.5 shadow-2xs ${
              hasCustomKey
                ? "bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300 ring-1 ring-emerald-200"
                : "bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200"
            }`}
            title="設定自備 Gemini API 金鑰 (BYOK - Bring Your Own Key)"
          >
            <Key className={`w-3.5 h-3.5 ${hasCustomKey ? "text-emerald-600" : "text-amber-600"}`} />
            {hasCustomKey ? (
              <span className="flex items-center gap-1.5">
                <span className="hidden md:inline text-emerald-900 font-bold">自備金鑰:</span>
                <span className="font-mono text-[11px] text-emerald-700">{maskedCustomKey || "已啟用"}</span>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <span>自備金鑰</span>
                <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">(BYOK)</span>
              </span>
            )}
          </button>

          {/* Backup / Restore Button */}
          <button
            id="open-backup-btn"
            type="button"
            onClick={onOpenBackup}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 transition flex items-center gap-1.5 shadow-2xs"
            title="題庫備份與還原 (下載 / 匯入 .json 檔案)"
          >
            <HardDrive className="w-3.5 h-3.5 text-sky-600" />
            <span className="hidden sm:inline">檔案備份</span>
          </button>

          {/* Export PDF Button */}
          <button
            id="open-pdf-export-btn"
            type="button"
            disabled={questionCount === 0}
            onClick={onOpenExportPdf}
            className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 active:scale-95 transition shadow-xs flex items-center gap-2 disabled:opacity-40"
          >
            <FileDown className="w-4 h-4 text-sky-400" />
            <span>匯出考卷 (B5/A4)</span>
            <span className="px-1.5 py-0.2 rounded-full bg-slate-800 text-[10px] text-sky-300">
              {questionCount}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
};
