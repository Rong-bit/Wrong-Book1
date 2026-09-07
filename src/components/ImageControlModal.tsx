import React, { useState, useRef } from "react";
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCw,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Trash2,
  Image as ImageIcon,
  Check,
  Eye,
  EyeOff,
  Upload,
  AlertCircle,
  Maximize2,
  Loader2,
} from "lucide-react";
import { ImageSettings } from "../types";
import { normalizeImageSrc, compressImage } from "../utils/imageUtils";

interface ImageControlModalProps {
  isOpen: boolean;
  questionId: string;
  imageSrc: string;
  settings: ImageSettings;
  onClose: () => void;
  onUpdateSettings: (newSettings: ImageSettings) => void;
  onDeleteQuestion: (id: string) => void;
  onRemoveImageOnly?: (id: string) => void;
  onReplaceImage?: (newBase64: string) => void;
  onOpenCalibration?: () => void;
}

export const ImageControlModal: React.FC<ImageControlModalProps> = ({
  isOpen,
  questionId,
  imageSrc,
  settings,
  onClose,
  onUpdateSettings,
  onDeleteQuestion,
  onRemoveImageOnly,
  onReplaceImage,
  onOpenCalibration,
}) => {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleZoomChange = (newZoom: number) => {
    const clamped = Math.max(40, Math.min(200, newZoom));
    onUpdateSettings({ ...settings, zoom: clamped });
  };

  const handleRotate = () => {
    const nextRotation = (settings.rotation + 90) % 360;
    onUpdateSettings({ ...settings, rotation: nextRotation });
  };

  const handleAlign = (align: "left" | "center" | "right") => {
    onUpdateSettings({ ...settings, align });
  };

  const handleToggleInclude = () => {
    onUpdateSettings({ ...settings, includeInExport: !settings.includeInExport });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onReplaceImage) return;
    setIsReplacing(true);
    try {
      const compressed = await compressImage(file);
      onReplaceImage(compressed);
      setPreviewError(false);
    } catch (err) {
      console.error("Failed to replace image in modal:", err);
    } finally {
      setIsReplacing(false);
      e.target.value = "";
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-6 border border-slate-200 relative flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center border border-sky-100">
              <ImageIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">圖片控制面板</h3>
              <p className="text-xs text-slate-500">調整題幹圖片之大小比例、方向與考卷排版屬性</p>
            </div>
          </div>
          <button
            id="close-image-modal-btn"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Hidden input for replacing image */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.heic,.heif,image/heic,image/heif"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Live Preview Area */}
        <div className="my-4 p-4 rounded-xl bg-slate-100 border border-slate-200/80 overflow-hidden flex items-center justify-center min-h-[220px] max-h-[320px] relative">
          {isReplacing && (
            <div className="absolute inset-0 bg-white/80 backdrop-blur-xs flex flex-col items-center justify-center z-20">
              <Loader2 className="w-6 h-6 animate-spin text-sky-600 mb-2" />
              <span className="text-xs font-bold text-slate-700">正在處理並轉碼圖片 (含 HEIC)...</span>
            </div>
          )}
          {previewError ? (
            <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl text-center max-w-md">
              <AlertCircle className="w-8 h-8 text-amber-600 mx-auto mb-2" />
              <div className="text-xs font-bold text-amber-950 mb-1">截圖檔案載入異常</div>
              <div className="text-[11px] text-amber-800 mb-3">
                原圖片資料可能不完整或暫存已過期，您可以直接選取新檔案替換。
              </div>
              {onReplaceImage && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold inline-flex items-center gap-1.5 shadow-xs transition"
                >
                  <Upload className="w-3.5 h-3.5" /> 重新選取圖片
                </button>
              )}
            </div>
          ) : (
            <>
              <div
                className={`w-full flex ${
                  settings.align === "left"
                    ? "justify-start"
                    : settings.align === "right"
                    ? "justify-end"
                    : "justify-center"
                }`}
              >
                <img
                  src={normalizeImageSrc(imageSrc)}
                  alt="題目截圖預覽"
                  onError={() => setPreviewError(true)}
                  onLoad={() => setPreviewError(false)}
                  className="rounded-lg shadow-sm border border-slate-300 max-h-[260px] object-contain transition-transform duration-200"
                  style={{
                    transform: `rotate(${settings.rotation}deg) scale(${settings.zoom / 100})`,
                    transformOrigin: "center center",
                  }}
                />
              </div>
              <div className="absolute bottom-2 right-2 px-2 py-1 rounded bg-black/60 text-white text-[11px] font-mono backdrop-blur-xs">
                {settings.zoom}% · {settings.rotation}°
              </div>
            </>
          )}
        </div>

        {/* Controls */}
        <div className="space-y-4 overflow-y-auto pr-1">
          {/* Zoom Controls */}
          <div>
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-1.5">
              <span className="flex items-center gap-1.5">
                <ZoomIn className="w-4 h-4 text-sky-600" />
                縮放比例 ({settings.zoom}%)
              </span>
              <div className="flex items-center gap-1">
                {[50, 75, 100, 125, 150].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => handleZoomChange(val)}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                      settings.zoom === val
                        ? "bg-sky-600 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {val}%
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => handleZoomChange(settings.zoom - 10)}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                title="縮小 10%"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <input
                id="image-zoom-slider"
                type="range"
                min="40"
                max="200"
                step="5"
                value={settings.zoom}
                onChange={(e) => handleZoomChange(Number(e.target.value))}
                className="w-full accent-sky-600 cursor-pointer"
              />
              <button
                type="button"
                onClick={() => handleZoomChange(settings.zoom + 10)}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                title="放大 10%"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Rotate & Alignment */}
          <div className="grid grid-cols-2 gap-4">
            {/* Rotate */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                圖片旋轉方向
              </label>
              <button
                id="rotate-image-btn"
                type="button"
                onClick={handleRotate}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition active:scale-95"
              >
                <RotateCw className="w-4 h-4 text-indigo-600" />
                順時針旋轉 90° (目前: {settings.rotation}°)
              </button>
            </div>

            {/* Alignment */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                對齊排版位置
              </label>
              <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => handleAlign("left")}
                  className={`flex-1 flex items-center justify-center py-1.5 rounded-lg text-xs font-medium transition ${
                    settings.align === "left"
                      ? "bg-white text-sky-700 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <AlignLeft className="w-3.5 h-3.5 mr-1" /> 靠左
                </button>
                <button
                  type="button"
                  onClick={() => handleAlign("center")}
                  className={`flex-1 flex items-center justify-center py-1.5 rounded-lg text-xs font-medium transition ${
                    settings.align === "center"
                      ? "bg-white text-sky-700 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <AlignCenter className="w-3.5 h-3.5 mr-1" /> 置中
                </button>
                <button
                  type="button"
                  onClick={() => handleAlign("right")}
                  className={`flex-1 flex items-center justify-center py-1.5 rounded-lg text-xs font-medium transition ${
                    settings.align === "right"
                      ? "bg-white text-sky-700 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <AlignRight className="w-3.5 h-3.5 mr-1" /> 靠右
                </button>
              </div>
            </div>
          </div>

          {/* Toggle include in export */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {settings.includeInExport ? (
                <Eye className="w-4 h-4 text-emerald-600" />
              ) : (
                <EyeOff className="w-4 h-4 text-slate-400" />
              )}
              <span className="text-xs font-medium text-slate-800">
                PDF 考卷/筆記本匯出時保留此截圖
              </span>
            </div>
            <button
              id="toggle-export-image-btn"
              type="button"
              onClick={handleToggleInclude}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                settings.includeInExport
                  ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                  : "bg-slate-200 text-slate-600"
              }`}
            >
              {settings.includeInExport ? "顯示於考卷" : "已隱藏截圖"}
            </button>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isConfirmingDelete ? (
              <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-300 px-2.5 py-1 rounded-xl text-xs">
                <span className="text-rose-700 font-bold text-xs">確定刪除此題？</span>
                <button
                  type="button"
                  onClick={() => {
                    onDeleteQuestion(questionId);
                    setIsConfirmingDelete(false);
                    onClose();
                  }}
                  className="px-2 py-0.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-bold shadow-2xs transition"
                >
                  確定刪除
                </button>
                <button
                  type="button"
                  onClick={() => setIsConfirmingDelete(false)}
                  className="px-1.5 py-0.5 text-slate-500 hover:text-slate-700 text-xs"
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                id="delete-question-from-modal-btn"
                type="button"
                onClick={() => setIsConfirmingDelete(true)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 border border-rose-200 flex items-center gap-1.5 transition"
              >
                <Trash2 className="w-3.5 h-3.5" /> 刪除此題
              </button>
            )}
            {onOpenCalibration && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenCalibration();
                }}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 flex items-center gap-1.5 transition active:scale-95"
                title="開啟四點透視校正（拉正歪斜考卷）與自由框選裁切"
              >
                <Maximize2 className="w-3.5 h-3.5" /> 透視拉正 / 裁切
              </button>
            )}
            {onReplaceImage && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 flex items-center gap-1.5 transition active:scale-95"
              >
                <Upload className="w-3.5 h-3.5" /> 更換截圖
              </button>
            )}
            {onRemoveImageOnly && (
              <button
                type="button"
                onClick={() => {
                  onRemoveImageOnly(questionId);
                  onClose();
                }}
                className="px-3 py-1.5 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 border border-slate-200 transition"
              >
                僅移除圖片
              </button>
            )}
          </div>
          <button
            id="confirm-image-settings-btn"
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 flex items-center gap-1.5 shadow-xs transition"
          >
            <Check className="w-4 h-4" /> 完成設定
          </button>
        </div>
      </div>
    </div>
  );
};
