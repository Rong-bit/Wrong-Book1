import React, { useRef, useState } from "react";
import {
  Camera,
  Upload,
  ClipboardPaste,
  Sparkles,
  BookOpen,
  Image as ImageIcon,
  CheckCircle2,
  Key,
  Loader2,
} from "lucide-react";
import { compressImage, isSupportedImageFile, isHeic } from "../utils/imageUtils";

interface CaptureZoneProps {
  onImageSelected: (base64: string, subjectHint?: string) => void;
  onLoadSamples: () => void;
  onOpenByok?: () => void;
  hasCustomKey?: boolean;
  isAnalyzing: boolean;
  questionCount: number;
  autoCalibrate?: boolean;
  onToggleAutoCalibrate?: (val: boolean) => void;
}

export const CaptureZone: React.FC<CaptureZoneProps> = ({
  onImageSelected,
  onLoadSamples,
  onOpenByok,
  hasCustomKey = false,
  isAnalyzing,
  questionCount,
  autoCalibrate = true,
  onToggleAutoCalibrate,
}) => {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState<string>("");
  const [isConvertingHeic, setIsConvertingHeic] = useState(false);

  const handleFile = async (file: File) => {
    if (!isSupportedImageFile(file)) {
      alert("請選擇圖片格式檔案 (支援 JPG、PNG、WebP、HEIC / HEIF 等)");
      return;
    }

    if (isHeic(file)) {
      setIsConvertingHeic(true);
    }

    try {
      const compressed = await compressImage(file);
      if (compressed) {
        onImageSelected(compressed, selectedSubject || undefined);
      }
    } catch (err) {
      console.warn("Image compression failed, using FileReader fallback:", err);
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result && typeof e.target.result === "string") {
          onImageSelected(e.target.result, selectedSubject || undefined);
        }
      };
      reader.readAsDataURL(file);
    } finally {
      setIsConvertingHeic(false);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
      e.target.value = ""; // reset
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFile(file);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-5 mb-6">
      {/* Hidden inputs with full image format support including HEIC/HEIF */}
      <input
        ref={cameraInputRef}
        id="camera-capture-input"
        type="file"
        accept="image/*,.heic,.heif,image/heic,image/heif"
        capture="environment"
        className="hidden"
        onChange={handleFileInputChange}
      />
      <input
        ref={galleryInputRef}
        id="gallery-file-input"
        type="file"
        accept="image/*,.heic,.heif,image/heic,image/heif"
        className="hidden"
        onChange={handleFileInputChange}
      />

      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-sky-100 text-sky-800">
              <Sparkles className="w-3 h-3" />
              AI 智能辨識
            </span>
            {onOpenByok && (
              <button
                type="button"
                onClick={onOpenByok}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border transition ${
                  hasCustomKey
                    ? "bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100"
                    : "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200"
                }`}
                title="點擊配置 Gemini API 自備金鑰"
              >
                <Key className="w-3 h-3 text-amber-600" />
                <span>BYOK {hasCustomKey ? "自備金鑰已啟用" : "可自備 Key"}</span>
              </button>
            )}
            <span className="text-xs text-slate-500 font-medium hidden sm:inline">
              支援 Ctrl+V 貼圖 · 手機拍照 · 批次自組卷
            </span>
          </div>
          <h2 className="text-xl font-extrabold text-slate-900 mt-1 tracking-tight">
            錯題擷取與智慧題本
          </h2>
        </div>

        {/* Optional Subject Hint Tag Selector */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-semibold text-slate-500 mr-1">優先科目：</span>
          {["自動辨識", "數學", "物理", "化學", "生物", "英文", "國文"].map((subj) => {
            const val = subj === "自動辨識" ? "" : subj;
            const active = selectedSubject === val;
            return (
              <button
                key={subj}
                type="button"
                onClick={() => setSelectedSubject(val)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                  active
                    ? "bg-slate-900 text-white font-semibold shadow-xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {subj}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Drag/Drop and Action Banner */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        className={`mt-4 rounded-xl border-2 border-dashed p-5 transition-all duration-200 flex flex-col md:flex-row items-center justify-between gap-4 ${
          isDragOver
            ? "border-sky-500 bg-sky-50/70 scale-[1.005]"
            : "border-slate-300/90 bg-slate-50/60 hover:bg-slate-50"
        }`}
      >
        {/* Left: Ctrl+V Guidance */}
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-white border border-slate-200 shadow-xs flex items-center justify-center text-sky-600 shrink-0">
            <ClipboardPaste className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm text-slate-800">
                電腦截圖後，在頁面任意處按下
              </span>
              <kbd className="px-2 py-0.5 text-xs font-mono font-bold bg-white text-slate-800 border border-slate-300 rounded shadow-xs">
                Ctrl + V
              </kbd>
              <span className="text-xs text-slate-500">(Mac 為 ⌘+V)</span>
              <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                支援 HEIC / JPG / PNG
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              截圖後直接貼上，支援 iPhone/iPad 的 HEIC 拍照照片自動轉碼，並透過 Gemini AI 解析科目、單元與詳解。
            </p>
            {isConvertingHeic && (
              <div className="mt-2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-800 text-xs font-medium animate-pulse">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-600 shrink-0" />
                <span>正在轉碼 iPhone HEIC 照片為高畫質格式，請稍候...</span>
              </div>
            )}
          </div>
        </div>

        {/* Right: Buttons */}
        <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
          {/* Mobile Camera input capture */}
          <button
            id="mobile-camera-btn"
            type="button"
            disabled={isAnalyzing}
            onClick={() => cameraInputRef.current?.click()}
            className="px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 active:scale-95 transition shadow-xs flex items-center gap-1.5 disabled:opacity-50"
          >
            <Camera className="w-4 h-4" />
            手機拍照即錄
          </button>

          {/* Desktop File Upload */}
          <button
            id="upload-file-btn"
            type="button"
            disabled={isAnalyzing}
            onClick={() => galleryInputRef.current?.click()}
            className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 active:scale-95 border border-slate-200 transition shadow-xs flex items-center gap-1.5 disabled:opacity-50"
          >
            <Upload className="w-4 h-4 text-slate-500" />
            選取圖檔
          </button>

          {/* Load Sample Questions */}
          {questionCount === 0 && (
            <button
              id="load-samples-btn"
              type="button"
              onClick={onLoadSamples}
              className="px-3.5 py-2.5 rounded-xl text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 active:scale-95 border border-amber-200 transition flex items-center gap-1.5"
            >
              <BookOpen className="w-4 h-4" />
              載入示範錯題
            </button>
          )}
        </div>
      </div>

      {/* Auto Calibration Toggle & Feature Banner */}
      <div className="mt-3.5 pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
        <label className="inline-flex items-center gap-2 cursor-pointer select-none group">
          <input
            type="checkbox"
            checked={autoCalibrate}
            onChange={(e) => onToggleAutoCalibrate?.(e.target.checked)}
            className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500 border-slate-300 transition cursor-pointer"
          />
          <span className="font-semibold text-slate-700 group-hover:text-slate-900 transition flex items-center gap-1.5">
            <span>📷 拍照或選圖後，自動開啟「四點透視拉正與自由裁切」</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-100 text-sky-800">
              推薦啟用
            </span>
          </span>
        </label>

        <div className="flex items-center gap-3 text-[11px] text-slate-500">
          <span className="flex items-center gap-1 text-slate-600">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span>四點拉正歪斜考卷 · 自由框選精準題目</span>
          </span>
        </div>
      </div>
    </div>
  );
};
