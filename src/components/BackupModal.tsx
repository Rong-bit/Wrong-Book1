import React, { useState, useRef } from "react";
import {
  X,
  Download,
  Upload,
  HardDrive,
  FileJson,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Sparkles,
  Layers,
  Copy,
  Check,
  Calendar,
  Image as ImageIcon,
} from "lucide-react";
import { QuestionItem, PaperSettings, BackupData } from "../types";

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  questions: QuestionItem[];
  paperSettings: PaperSettings;
  onRestoreQuestions: (restoredQuestions: QuestionItem[], mode: "merge" | "overwrite") => void;
}

export const BackupModal: React.FC<BackupModalProps> = ({
  isOpen,
  onClose,
  questions,
  paperSettings,
  onRestoreQuestions,
}) => {
  const [activeTab, setActiveTab] = useState<"export" | "import">("export");
  const [copied, setCopied] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [parsedBackup, setParsedBackup] = useState<BackupData | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [restoreMode, setRestoreMode] = useState<"merge" | "overwrite">("merge");
  const [restoreSuccessMsg, setRestoreSuccessMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // Subjects breakdown
  const subjectsBreakdown = questions.reduce((acc, q) => {
    const s = q.subject || "未分類";
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const imageCount = questions.filter((q) => Boolean(q.imageBase64)).length;
  const variantCount = questions.reduce(
    (sum, q) => sum + (q.similarVariants?.length || 0),
    0
  );

  // Generate backup object
  const getBackupDataObject = (): BackupData => {
    const now = new Date();
    const subjects: string[] = Array.from(
      new Set(questions.map((q) => q.subject).filter((s): s is string => Boolean(s)))
    );
    return {
      version: 1,
      appName: "數位錯題本考卷組題系統",
      exportedAt: now.toISOString(),
      timestamp: now.getTime(),
      questionCount: questions.length,
      subjects,
      questions,
      paperSettings,
    };
  };

  const backupJsonString = JSON.stringify(getBackupDataObject(), null, 2);
  const approxSizeKb = Math.round(new Blob([backupJsonString]).size / 1024);

  // Export & Download handler
  const handleDownloadBackup = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const mins = String(now.getMinutes()).padStart(2, "0");

    const fileName = `數位錯題本備份_${year}${month}${day}_${hours}${mins}.json`;
    const blob = new Blob([backupJsonString], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Copy JSON handler
  const handleCopyJson = () => {
    navigator.clipboard.writeText(backupJsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // Handle file select for import
  const handleFileChange = (file: File) => {
    setImportFile(file);
    setParseError(null);
    setParsedBackup(null);
    setRestoreSuccessMsg(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const parsed = JSON.parse(text);

        // Validation
        if (!parsed || typeof parsed !== "object") {
          throw new Error("備份檔案格式無效，不是合法的 JSON 物件。");
        }

        let rawQuestions: QuestionItem[] = [];
        if (Array.isArray(parsed.questions)) {
          rawQuestions = parsed.questions;
        } else if (Array.isArray(parsed)) {
          // Direct array of questions
          rawQuestions = parsed;
        } else {
          throw new Error("檔案中未找到題目列表 (questions 欄位缺少或不正確)。");
        }

        if (rawQuestions.length === 0) {
          throw new Error("此備份檔案中不包含任何題目。");
        }

        const subjects: string[] = Array.from(
          new Set(rawQuestions.map((q) => q.subject).filter((s): s is string => Boolean(s)))
        );

        const validatedBackup: BackupData = {
          version: parsed.version || 1,
          appName: parsed.appName || "數位錯題本考卷組題系統",
          exportedAt: parsed.exportedAt || new Date().toISOString(),
          timestamp: parsed.timestamp || Date.now(),
          questionCount: rawQuestions.length,
          subjects,
          questions: rawQuestions,
          paperSettings: parsed.paperSettings,
        };

        setParsedBackup(validatedBackup);
      } catch (err: any) {
        setParseError(err.message || "檔案解析失敗，請確認是否為正確的錯題本備份檔 (.json)。");
        setParsedBackup(null);
      }
    };
    reader.onerror = () => {
      setParseError("讀取檔案時發生錯誤。");
      setParsedBackup(null);
    };
    reader.readAsText(file);
  };

  // Drag and drop handlers
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  // Confirm Restore
  const handleConfirmRestore = () => {
    if (!parsedBackup || !parsedBackup.questions) return;

    onRestoreQuestions(parsedBackup.questions, restoreMode);
    setRestoreSuccessMsg(
      restoreMode === "merge"
        ? `成功合併匯入 ${parsedBackup.questions.length} 道題目！`
        : `成功以備份檔案完全覆蓋還原（共 ${parsedBackup.questions.length} 題）！`
    );

    setTimeout(() => {
      onClose();
    }, 1200);
  };

  const formatDate = (isoString?: string) => {
    if (!isoString) return "未知時間";
    try {
      const d = new Date(isoString);
      return d.toLocaleString("zh-TW", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-xl w-full border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center border border-sky-400/30">
              <HardDrive className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">題庫檔案備份與還原</h3>
              <p className="text-[11px] text-slate-400">
                可將整份錯題本（含截圖照片、算式排版與筆記）下載保存或一鍵還原
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-6 pt-3 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("export")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-bold border-t border-x transition ${
              activeTab === "export"
                ? "bg-white text-sky-700 border-slate-200 -mb-px shadow-xs"
                : "text-slate-600 border-transparent hover:text-slate-900"
            }`}
          >
            <Download className="w-3.5 h-3.5 text-sky-600" />
            <span>匯出 / 下載備份檔</span>
            <span className="px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-800 text-[10px]">
              {questions.length} 題
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("import")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-bold border-t border-x transition ${
              activeTab === "import"
                ? "bg-white text-indigo-700 border-slate-200 -mb-px shadow-xs"
                : "text-slate-600 border-transparent hover:text-slate-900"
            }`}
          >
            <Upload className="w-3.5 h-3.5 text-indigo-600" />
            <span>匯入 / 還原備份檔</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {activeTab === "export" ? (
            <div className="space-y-4">
              {/* Summary Card */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-700 flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-sky-600" />
                    目前錯題本內容統計
                  </span>
                  <span className="text-slate-500 font-mono text-[11px]">
                    預估備份大小：{approxSizeKb < 1024 ? `${approxSizeKb} KB` : `${(approxSizeKb / 1024).toFixed(1)} MB`}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2.5 rounded-lg bg-white border border-slate-200/80 shadow-2xs">
                    <div className="text-lg font-black text-slate-800">{questions.length}</div>
                    <div className="text-[10px] text-slate-500">總錯題數量</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white border border-slate-200/80 shadow-2xs">
                    <div className="text-lg font-black text-sky-700">{imageCount}</div>
                    <div className="text-[10px] text-slate-500">包含截圖考題</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white border border-slate-200/80 shadow-2xs">
                    <div className="text-lg font-black text-indigo-700">{variantCount}</div>
                    <div className="text-[10px] text-slate-500">AI 變形練習題</div>
                  </div>
                </div>

                {/* Subjects tag cloud */}
                {Object.keys(subjectsBreakdown).length > 0 && (
                  <div className="pt-1 flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-semibold text-slate-500">涵蓋科目：</span>
                    {Object.entries(subjectsBreakdown).map(([subj, count]) => (
                      <span
                        key={subj}
                        className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 text-[10px] font-medium"
                      >
                        {subj} ({count})
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* What does backup contain */}
              <div className="p-3.5 rounded-xl bg-sky-50/60 border border-sky-100 text-xs text-sky-950 space-y-1.5">
                <div className="font-bold flex items-center gap-1 text-sky-900">
                  <Sparkles className="w-3.5 h-3.5 text-sky-600" />
                  備份檔案 (.json) 包含內容：
                </div>
                <ul className="list-disc list-inside text-[11px] text-sky-800/90 space-y-0.5">
                  <li>各題文字、選項、標準答案、詳細算式步驟與數學 LaTeX 語法。</li>
                  <li>您上傳或剪貼簿貼上的高清考題截圖照片（已內嵌壓縮編碼）。</li>
                  <li>所有章節冊別標籤、錯誤原因、個人心得筆記與 AI 相似題。</li>
                  <li>自組試卷與康乃爾筆記本的版面配置參數。</li>
                </ul>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex flex-col sm:flex-row items-center gap-2.5">
                <button
                  type="button"
                  disabled={questions.length === 0}
                  onClick={handleDownloadBackup}
                  className="w-full sm:flex-1 py-3 px-4 rounded-xl bg-sky-600 hover:bg-sky-700 active:scale-98 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                  <span>下載錯題本備份檔案 (.json)</span>
                </button>

                <button
                  type="button"
                  disabled={questions.length === 0}
                  onClick={handleCopyJson}
                  className="w-full sm:w-auto py-3 px-3.5 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold text-xs flex items-center justify-center gap-1.5 transition disabled:opacity-50"
                  title="複製整份 JSON 代碼至剪貼簿"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4 text-slate-500" />}
                  <span>{copied ? "已複製到剪貼簿！" : "複製 JSON"}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Drop / Upload Zone */}
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 hover:border-indigo-500 hover:bg-indigo-50/30 rounded-2xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2 group"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".json"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleFileChange(e.target.files[0]);
                    }
                  }}
                />
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 group-hover:bg-indigo-100 text-indigo-600 flex items-center justify-center transition">
                  <FileJson className="w-6 h-6" />
                </div>
                <div>
                  <span className="text-xs font-bold text-slate-800 block">
                    點擊選擇或將備份檔案 (.json) 拖曳至此處
                  </span>
                  <span className="text-[11px] text-slate-400">
                    支援先前從本系統下載的錯題本備份檔案
                  </span>
                </div>
              </div>

              {/* Error Message */}
              {parseError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block">備份檔案讀取失敗</span>
                    <span>{parseError}</span>
                  </div>
                </div>
              )}

              {/* Success Notification */}
              {restoreSuccessMsg && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2 animate-in fade-in">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="font-bold">{restoreSuccessMsg}</span>
                </div>
              )}

              {/* Parsed File Preview */}
              {parsedBackup && (
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileJson className="w-4 h-4 text-indigo-600" />
                      <span className="font-bold text-xs text-slate-800 truncate max-w-[240px]">
                        {importFile?.name || "備份檔案"}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-500 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatDate(parsedBackup.exportedAt)}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2 rounded-lg bg-white border border-slate-200 text-xs">
                      <div className="font-black text-indigo-900 text-base">
                        {parsedBackup.questionCount}
                      </div>
                      <div className="text-[10px] text-slate-500">備份題數</div>
                    </div>
                    <div className="p-2 rounded-lg bg-white border border-slate-200 text-xs">
                      <div className="font-black text-slate-800 text-base">
                        {parsedBackup.subjects.length}
                      </div>
                      <div className="text-[10px] text-slate-500">學科科目</div>
                    </div>
                    <div className="p-2 rounded-lg bg-white border border-slate-200 text-xs">
                      <div className="font-black text-sky-700 text-base">
                        {parsedBackup.questions.filter((q) => Boolean(q.imageBase64)).length}
                      </div>
                      <div className="text-[10px] text-slate-500">附圖考題</div>
                    </div>
                  </div>

                  {/* Restore Mode Selection */}
                  <div className="pt-2 border-t border-slate-200 space-y-2">
                    <span className="text-xs font-bold text-slate-700 block">
                      請選擇還原方式：
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setRestoreMode("merge")}
                        className={`p-3 rounded-xl border text-left transition flex flex-col gap-1 ${
                          restoreMode === "merge"
                            ? "border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-400"
                            : "border-slate-200 bg-white hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-indigo-950">
                            合併加入現有題庫
                          </span>
                          <span className="text-[10px] text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded font-bold">
                            推薦
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500 leading-tight">
                          保留目前畫面上的題目，將備份檔案中的題目追加進來（自動防重複）。
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setRestoreMode("overwrite")}
                        className={`p-3 rounded-xl border text-left transition flex flex-col gap-1 ${
                          restoreMode === "overwrite"
                            ? "border-rose-500 bg-rose-50/50 ring-1 ring-rose-400"
                            : "border-slate-200 bg-white hover:bg-slate-50"
                        }`}
                      >
                        <span className="text-xs font-bold text-rose-950">
                          完全覆蓋現有題庫
                        </span>
                        <span className="text-[10px] text-slate-500 leading-tight">
                          清空目前的錯題本，完全恢復為該備份檔案當時的內容與狀態。
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Confirm Restore Button */}
                  <div className="pt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleConfirmRestore}
                      className={`flex-1 py-3 px-4 rounded-xl text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition active:scale-98 ${
                        restoreMode === "merge"
                          ? "bg-indigo-600 hover:bg-indigo-700"
                          : "bg-rose-600 hover:bg-rose-700"
                      }`}
                    >
                      <Upload className="w-4 h-4" />
                      <span>
                        確認{restoreMode === "merge" ? "合併匯入" : "覆蓋還原"} ({parsedBackup.questionCount} 題)
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setParsedBackup(null);
                        setImportFile(null);
                      }}
                      className="px-3 py-3 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-600 text-xs font-semibold transition"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
          <span>💡 備份檔案儲存在您的電腦本機，可隨時離線或在不同電腦、瀏覽器間轉移。</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-slate-600 hover:text-slate-900 rounded font-semibold"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
};
