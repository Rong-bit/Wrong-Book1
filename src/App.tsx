import React, { useState, useEffect, useCallback } from "react";
import {
  Sparkles,
  BookOpen,
  Filter,
  Plus,
  RefreshCw,
  Trash2,
  LayoutGrid,
  FileText,
  AlertCircle,
  Loader2,
  CheckCircle,
} from "lucide-react";
import { QuestionItem, PaperSettings, ViewLayout, ImageSettings, SimilarQuestionVariant } from "./types";
import { initialSampleQuestions } from "./data/sampleQuestions";
import {
  analyzeQuestionImage,
  getStoredApiKey,
  getMaskedKey,
} from "./services/aiService";
import { Navbar } from "./components/Navbar";
import { CaptureZone } from "./components/CaptureZone";
import { QuestionCard } from "./components/QuestionCard";
import { ImageControlModal } from "./components/ImageControlModal";
import { ByokModal } from "./components/ByokModal";
import { PdfExportModal } from "./components/PdfExportModal";
import { BackupModal } from "./components/BackupModal";
import { ImageCalibrationModal } from "./components/ImageCalibrationModal";
import { compressImage, normalizeImageSrc } from "./utils/imageUtils";

const STORAGE_QUESTIONS_KEY = "digital_notebook_questions_v1";

export default function App() {
  const [questions, setQuestions] = useState<QuestionItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_QUESTIONS_KEY);
      if (saved) {
        const parsed: QuestionItem[] = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((q) => {
            // Repair sample questions if they have outdated/broken/empty image
            if (q.id === "sample-1" && (!q.imageBase64 || q.imageBase64.includes("utf8") || q.imageBase64.startsWith("data:image/svg"))) {
              const fresh = initialSampleQuestions.find((s) => s.id === "sample-1");
              if (fresh) return { ...q, imageBase64: fresh.imageBase64 };
            }
            if (q.id === "sample-2" && (!q.imageBase64 || q.imageBase64.includes("utf8") || q.imageBase64.startsWith("data:image/svg"))) {
              const fresh = initialSampleQuestions.find((s) => s.id === "sample-2");
              if (fresh) return { ...q, imageBase64: fresh.imageBase64 };
            }
            if (q.imageBase64) {
              return { ...q, imageBase64: normalizeImageSrc(q.imageBase64) };
            }
            return q;
          });
        }
      }
    } catch (e) {
      console.warn("Failed reading saved questions:", e);
    }
    return initialSampleQuestions;
  });

  const [layout, setLayout] = useState<ViewLayout>("notebook");
  const [selectedSubjectFilter, setSelectedSubjectFilter] = useState<string>("全部");
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analyzingMessage, setAnalyzingMessage] = useState<string>("");
  const [selectedQuestionForImageModal, setSelectedQuestionForImageModal] =
    useState<QuestionItem | null>(null);
  const [isByokOpen, setIsByokOpen] = useState<boolean>(false);
  const [isPdfModalOpen, setIsPdfModalOpen] = useState<boolean>(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState<boolean>(false);
  const [hasCustomKey, setHasCustomKey] = useState<boolean>(false);
  const [pasteToast, setPasteToast] = useState<string | null>(null);
  const [isConfirmingClearAll, setIsConfirmingClearAll] = useState<boolean>(false);

  const [paperSettings, setPaperSettings] = useState<PaperSettings>({
    title: "錯題訂正本",
    subtitle: "命題範圍：數學科一元二次方程式 · 物理科牛頓運動定律",
    school: "",
    gradeClass: "九年級",
    studentName: "",
    seatNumber: "",
    paperSize: "B5",
    orientation: "portrait",
    mode: "cornell",
    questionDisplayMode: "both",
    questionsPerPage: 2,
    showGrid: true,
    showCheckboxes: true,
    showReviewTrack: true,
    includeAnswerSheet: true,
    includeImages: true,
    leaveBlankHeight: 100,
    columns: 1,
  });

  // Keep localStorage synced safely
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_QUESTIONS_KEY, JSON.stringify(questions));
    } catch (e) {
      console.warn("Storage quota exceeded, attempting lightweight backup:", e);
      try {
        const lightweight = questions.map((q) => {
          if (q.imageBase64 && q.imageBase64.length > 500000) {
            return { ...q, imageBase64: "" };
          }
          return q;
        });
        localStorage.setItem(STORAGE_QUESTIONS_KEY, JSON.stringify(lightweight));
      } catch (fallbackErr) {
        console.error("Secondary localStorage write failed:", fallbackErr);
      }
    }
  }, [questions]);

  // Check BYOK key status
  const refreshKeyStatus = useCallback(() => {
    setHasCustomKey(Boolean(getStoredApiKey()));
  }, []);

  useEffect(() => {
    refreshKeyStatus();
  }, [refreshKeyStatus]);

  // Process new image (from Ctrl+V paste or camera / upload)
  const processNewImage = useCallback(
    async (base64Data: string, subjectHint?: string) => {
      const tempId = "q_" + Date.now();
      setIsAnalyzing(true);
      setAnalyzingMessage("AI 正在辨識考題圖片並分析科目與單元...");

      const newQuestionPlaceholder: QuestionItem = {
        id: tempId,
        imageBase64: base64Data,
        imageSettings: {
          zoom: 100,
          rotation: 0,
          align: "center",
          includeInExport: true,
        },
        subject: subjectHint || "分析中...",
        gradeLevel: "AI 推論冊別中...",
        chapter: "AI 推論章節中...",
        unit: "AI 解析中...",
        questionText: "正在進行光學字元辨識與題型架構分析，請稍候...",
        explanation: "AI 正在推導詳細解題步驟...",
        createdAt: Date.now(),
        status: "analyzing",
      };

      // Put at the beginning
      setQuestions((prev) => [newQuestionPlaceholder, ...prev]);

      try {
        const result = await analyzeQuestionImage(base64Data, subjectHint);

        setQuestions((prev) =>
          prev.map((item) => {
            if (item.id === tempId) {
              return {
                ...item,
                subject: result.科目 || "未歸類",
                gradeLevel: result.冊別 || "",
                chapter: result.章節 || "",
                unit: result.單元 || "未歸類單元",
                questionText: result.題目文字 || "",
                questionType: result.題型 || "綜合題",
                answer: result.答案 || "",
                coreConcepts: result.核心考點 || "",
                commonPitfalls: result.易錯陷阱 || "",
                explanation: result.詳解步驟 || "",
                tips: result.關鍵技巧 || "",
                status: "ready",
              };
            }
            return item;
          })
        );
      } catch (err: any) {
        console.error("Analysis failed:", err);
        const errMsg = err?.message || "辨識發生錯誤";
        setQuestions((prev) =>
          prev.map((item) => {
            if (item.id === tempId) {
              return {
                ...item,
                subject: subjectHint || "自訂題目",
                unit: "手動修訂",
                questionText: "題目圖片辨識未完成 (" + errMsg + ")。點擊鉛筆可手動編輯文字。",
                explanation: "請點擊編輯填寫解答。",
                status: "error",
                errorMessage: errMsg,
              };
            }
            return item;
          })
        );

        if (errMsg.includes("Key") || errMsg.includes("金鑰")) {
          setIsByokOpen(true);
        }
      } finally {
        setIsAnalyzing(false);
        setAnalyzingMessage("");
      }
    },
    []
  );

  const [autoCalibrateOnCapture, setAutoCalibrateOnCapture] = useState<boolean>(() => {
    try {
      const val = localStorage.getItem("ai_exam_auto_calibrate");
      return val === null ? true : val === "true";
    } catch {
      return true;
    }
  });

  const handleToggleAutoCalibrate = (val: boolean) => {
    setAutoCalibrateOnCapture(val);
    try {
      localStorage.setItem("ai_exam_auto_calibrate", String(val));
    } catch (e) {
      console.warn("Saving auto calibrate setting failed", e);
    }
  };

  const [calibrationModal, setCalibrationModal] = useState<{
    isOpen: boolean;
    imageSrc: string;
    subjectHint?: string;
    targetQuestionId?: string;
    initialMode?: "perspective" | "crop";
  }>({
    isOpen: false,
    imageSrc: "",
  });

  const handleImageSelected = useCallback(
    (base64Data: string, subjectHint?: string) => {
      if (autoCalibrateOnCapture) {
        setCalibrationModal({
          isOpen: true,
          imageSrc: base64Data,
          subjectHint,
          initialMode: "perspective",
        });
      } else {
        processNewImage(base64Data, subjectHint);
      }
    },
    [autoCalibrateOnCapture, processNewImage]
  );

  const handleCalibrationConfirm = (processedBase64: string) => {
    if (calibrationModal.targetQuestionId) {
      const targetId = calibrationModal.targetQuestionId;
      handleUpdateQuestion(targetId, {
        imageBase64: processedBase64,
        imageSettings: {
          zoom: 100,
          rotation: 0,
          align: "center",
          includeInExport: true,
        },
      });
      setSelectedQuestionForImageModal((prev) =>
        prev && prev.id === targetId
          ? {
              ...prev,
              imageBase64: processedBase64,
              imageSettings: {
                ...prev.imageSettings,
                zoom: 100,
                rotation: 0,
              },
            }
          : null
      );
    } else {
      processNewImage(processedBase64, calibrationModal.subjectHint);
    }
    setCalibrationModal({ isOpen: false, imageSrc: "" });
  };

  const handleCalibrationSkip = () => {
    if (!calibrationModal.targetQuestionId && calibrationModal.imageSrc) {
      processNewImage(calibrationModal.imageSrc, calibrationModal.subjectHint);
    }
    setCalibrationModal({ isOpen: false, imageSrc: "" });
  };

  const handleOpenCalibrationForQuestion = (question: QuestionItem) => {
    let imgSrc = normalizeImageSrc(question.imageBase64);
    if (!imgSrc && question.id.startsWith("sample-")) {
      const sample = initialSampleQuestions.find((s) => s.id === question.id);
      if (sample) imgSrc = sample.imageBase64;
    }
    setCalibrationModal({
      isOpen: true,
      imageSrc: imgSrc,
      targetQuestionId: question.id,
      initialMode: "perspective",
    });
  };

  // Global paste event listener for Ctrl+V
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.indexOf("image") !== -1) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            setPasteToast("已偵測到剪貼簿截圖，正在載入...");
            setTimeout(() => setPasteToast(null), 3000);

            try {
              const compressed = await compressImage(file);
              if (compressed) {
                handleImageSelected(compressed);
              }
            } catch (err) {
              console.warn("Paste image compression failed, using reader fallback:", err);
              const reader = new FileReader();
              reader.onload = (uploadEvent) => {
                const base64 = uploadEvent.target?.result as string;
                if (base64) {
                  handleImageSelected(base64);
                }
              };
              reader.readAsDataURL(file);
            }
          }
          break;
        }
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [handleImageSelected]);

  // Question manipulation handlers
  const handleDeleteQuestion = (id: string) => {
    setQuestions((prev) => prev.filter((q) => q.id !== id));
    if (selectedQuestionForImageModal?.id === id) {
      setSelectedQuestionForImageModal(null);
    }
  };

  const handleUpdateQuestion = (id: string, updated: Partial<QuestionItem>) => {
    setQuestions((prev) =>
      prev.map((q) => (q.id === id ? { ...q, ...updated } : q))
    );
  };

  const handleUpdateImageSettings = (newSettings: ImageSettings) => {
    if (!selectedQuestionForImageModal) return;
    const targetId = selectedQuestionForImageModal.id;
    setQuestions((prev) =>
      prev.map((q) => (q.id === targetId ? { ...q, imageSettings: newSettings } : q))
    );
    setSelectedQuestionForImageModal((prev) =>
      prev ? { ...prev, imageSettings: newSettings } : null
    );
  };

  const handleRemoveImageOnly = (id: string) => {
    setQuestions((prev) =>
      prev.map((q) =>
        q.id === id
          ? {
              ...q,
              imageBase64: "",
              imageSettings: { ...q.imageSettings, includeInExport: false },
            }
          : q
      )
    );
  };

  const handleRetryAnalysis = async (questionId: string) => {
    const targetQ = questions.find((q) => q.id === questionId);
    if (!targetQ || !targetQ.imageBase64) return;

    setQuestions((prev) =>
      prev.map((item) =>
        item.id === questionId
          ? {
              ...item,
              status: "analyzing",
              errorMessage: undefined,
              questionText: "AI 正在重新解析圖片考題（已啟用 503 尖峰自動重試與備援模型防護）...",
              explanation: "AI 正在重新推導詳細解題步驟...",
            }
          : item
      )
    );

    try {
      const result = await analyzeQuestionImage(targetQ.imageBase64, targetQ.subject);
      setQuestions((prev) =>
        prev.map((item) => {
          if (item.id === questionId) {
            return {
              ...item,
              subject: result.科目 || item.subject || "未歸類",
              gradeLevel: result.冊別 || item.gradeLevel || "",
              chapter: result.章節 || item.chapter || "",
              unit: result.單元 || item.unit || "未歸類單元",
              questionText: result.題目文字 || "",
              questionType: result.題型 || "綜合題",
              answer: result.答案 || "",
              coreConcepts: result.核心考點 || "",
              commonPitfalls: result.易錯陷阱 || "",
              explanation: result.詳解步驟 || "",
              tips: result.關鍵技巧 || "",
              status: "ready",
              errorMessage: undefined,
            };
          }
          return item;
        })
      );
      setPasteToast("✨ 考題重新辨識成功！");
      setTimeout(() => setPasteToast(null), 3000);
    } catch (err: any) {
      console.error("Retry analysis failed:", err);
      const errMsg = err?.message || "辨識發生錯誤";
      setQuestions((prev) =>
        prev.map((item) => {
          if (item.id === questionId) {
            return {
              ...item,
              status: "error",
              errorMessage: errMsg,
              questionText: "題目圖片辨識未完成 (" + errMsg + ")。點擊下方可手動編輯或再次重試。",
            };
          }
          return item;
        })
      );

      if (errMsg.includes("Key") || errMsg.includes("金鑰")) {
        setIsByokOpen(true);
      }
    }
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    setQuestions((prev) => {
      const next = [...prev];
      const temp = next[index - 1];
      next[index - 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const handleMoveDown = (index: number) => {
    if (index >= questions.length - 1) return;
    setQuestions((prev) => {
      const next = [...prev];
      const temp = next[index + 1];
      next[index + 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const handleAddSimilarAsQuestion = (similar: SimilarQuestionVariant, parentQ: QuestionItem) => {
    const newQuestion: QuestionItem = {
      id: `similar_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      imageBase64: "",
      imageSettings: {
        zoom: 100,
        rotation: 0,
        align: "center",
        includeInExport: false,
      },
      subject: parentQ.subject,
      gradeLevel: parentQ.gradeLevel,
      chapter: parentQ.chapter,
      unit: parentQ.unit,
      questionText: similar.questionText,
      questionType: "舉一反三練習題",
      answer: similar.answer,
      coreConcepts: similar.coreConcepts || parentQ.coreConcepts,
      explanation: similar.explanation,
      tips: similar.tips,
      difficulty: similar.difficulty || "中等",
      myNotes: `【變形亮點】：${similar.variationPoint || "由錯題自動生成之同觀念練習題"}`,
      createdAt: Date.now(),
      status: "ready",
      isSimilarVariant: true,
      parentQuestionId: parentQ.id,
      variationPoint: similar.variationPoint,
    };

    setQuestions((prev) => {
      const parentIndex = prev.findIndex((q) => q.id === parentQ.id);
      if (parentIndex !== -1) {
        const next = [...prev];
        next.splice(parentIndex + 1, 0, newQuestion);
        return next;
      }
      return [...prev, newQuestion];
    });

    setPasteToast("✨ 已成功將練習題加入清單（排在原題後方）！");
    setTimeout(() => setPasteToast(null), 3500);
  };

  const handleLoadSamples = () => {
    setQuestions(initialSampleQuestions);
  };

  const handleClearAll = () => {
    setQuestions([]);
  };

  const handleRestoreQuestions = (
    restoredQuestions: QuestionItem[],
    mode: "merge" | "overwrite"
  ) => {
    if (mode === "overwrite") {
      setQuestions(restoredQuestions);
      setPasteToast(`✨ 已成功完全還原 ${restoredQuestions.length} 道考題！`);
    } else {
      // Merge mode: keep existing questions, append new ones avoiding duplicate IDs
      setQuestions((prev) => {
        const existingIds = new Set(prev.map((q) => q.id));
        const newItems = restoredQuestions.map((q) => {
          if (existingIds.has(q.id)) {
            return {
              ...q,
              id: `q_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            };
          }
          return q;
        });
        return [...prev, ...newItems];
      });
      setPasteToast(`✨ 已成功合併匯入 ${restoredQuestions.length} 道考題！`);
    }
    setTimeout(() => setPasteToast(null), 3500);
  };

  // Subjects for filtering
  const availableSubjects = Array.from(
    new Set(questions.map((q) => q.subject).filter(Boolean))
  );

  const filteredQuestions = questions.filter((q) => {
    if (selectedSubjectFilter === "全部") return true;
    return q.subject === selectedSubjectFilter;
  });

  return (
    <div className="min-h-dvh w-full max-w-full min-w-0 bg-slate-50 flex flex-col selection:bg-sky-100 selection:text-sky-900">
      {/* Navigation Bar */}
      <Navbar
        currentLayout={layout}
        onLayoutChange={setLayout}
        onOpenByok={() => setIsByokOpen(true)}
        onOpenExportPdf={() => setIsPdfModalOpen(true)}
        onOpenBackup={() => setIsBackupModalOpen(true)}
        hasCustomKey={hasCustomKey}
        maskedCustomKey={getMaskedKey(getStoredApiKey())}
        questionCount={questions.length}
        selectedFilter={selectedSubjectFilter}
        onFilterChange={setSelectedSubjectFilter}
        availableSubjects={availableSubjects}
      />

      {/* Floating Paste Notification Toast */}
      {pasteToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl flex items-center gap-2.5 text-xs font-semibold animate-in slide-in-from-bottom duration-200 border border-slate-700">
          <Sparkles className="w-4 h-4 text-amber-400 animate-spin" />
          {pasteToast}
        </div>
      )}

      {/* Main Container */}
      <main className="flex-1 w-full min-w-0 max-w-full md:max-w-7xl mx-auto px-3 md:px-6 py-4 sm:py-6">
        {/* Top Capture Area */}
        <CaptureZone
          onImageSelected={handleImageSelected}
          onLoadSamples={handleLoadSamples}
          onOpenByok={() => setIsByokOpen(true)}
          hasCustomKey={hasCustomKey}
          isAnalyzing={isAnalyzing}
          questionCount={questions.length}
          autoCalibrate={autoCalibrateOnCapture}
          onToggleAutoCalibrate={handleToggleAutoCalibrate}
        />

        {/* Status Bar / Filter & Stats */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          {/* Subject Filter Chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-slate-500 flex items-center gap-1 mr-1">
              <Filter className="w-3.5 h-3.5" /> 科目篩選：
            </span>
            <button
              type="button"
              onClick={() => setSelectedSubjectFilter("全部")}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                selectedSubjectFilter === "全部"
                  ? "bg-slate-900 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              全部 ({questions.length})
            </button>
            {availableSubjects.map((subj) => {
              const count = questions.filter((q) => q.subject === subj).length;
              const active = selectedSubjectFilter === subj;
              return (
                <button
                  key={subj}
                  type="button"
                  onClick={() => setSelectedSubjectFilter(subj)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                    active
                      ? "bg-sky-600 text-white shadow-xs"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {subj} ({count})
                </button>
              );
            })}
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2 self-end sm:self-auto">
            {questions.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={handleLoadSamples}
                  className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition"
                  title="重新填入示範考題"
                >
                  重載示範題
                </button>
                {isConfirmingClearAll ? (
                  <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-300 px-2 py-0.5 rounded-lg text-xs">
                    <span className="text-rose-700 font-bold text-[11px]">確定清空？</span>
                    <button
                      type="button"
                      onClick={() => {
                        setQuestions([]);
                        setIsConfirmingClearAll(false);
                      }}
                      className="px-2 py-0.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-[10px] font-bold shadow-2xs transition"
                    >
                      清空
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsConfirmingClearAll(false)}
                      className="px-1 text-slate-500 hover:text-slate-700 text-[10px]"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsConfirmingClearAll(true)}
                    className="px-2.5 py-1 text-xs text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition"
                    title="清空錯題列表"
                  >
                    清空題本
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Analyzing Banner */}
        {isAnalyzing && (
          <div className="mb-6 p-4 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-between gap-3 text-xs text-sky-900 animate-pulse">
            <div className="flex items-center gap-2.5 font-semibold">
              <Loader2 className="w-4 h-4 animate-spin text-sky-600" />
              <span>{analyzingMessage || "AI 正在處理題目中..."}</span>
            </div>
            <span className="text-[11px] text-sky-700 font-normal">
              自動辨識科目、單元、考點與逐步詳解
            </span>
          </div>
        )}

        {/* Empty State */}
        {filteredQuestions.length === 0 && !isAnalyzing && (
          <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center my-8">
            <div className="w-16 h-16 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center mx-auto mb-4 border border-sky-100">
              <BookOpen className="w-8 h-8" />
            </div>
            <h3 className="text-base font-bold text-slate-800 mb-1">
              {selectedSubjectFilter === "全部"
                ? "錯題本目前是空的"
                : `目前沒有「${selectedSubjectFilter}」科目的錯題`}
            </h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto mb-5 leading-relaxed">
              按下電腦鍵盤 <kbd className="font-mono font-bold bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">Ctrl + V</kbd> 即可直接貼上截圖，或使用手機相機拍照、選取檔案快速匯入。
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={handleLoadSamples}
                className="px-4 py-2 text-xs font-bold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-xl transition"
              >
                載入示範錯題試玩
              </button>
            </div>
          </div>
        )}

        {/* Question Cards Container */}
        {layout === "grid" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {filteredQuestions.map((q, idx) => (
              <QuestionCard
                key={q.id}
                question={q}
                index={idx}
                totalCount={filteredQuestions.length}
                layout={layout}
                onOpenImageControl={(question) => setSelectedQuestionForImageModal(question)}
                onOpenCalibration={handleOpenCalibrationForQuestion}
                onDelete={handleDeleteQuestion}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
                onUpdateQuestion={handleUpdateQuestion}
                onAddSimilarAsQuestion={handleAddSimilarAsQuestion}
                onOpenByokModal={() => setIsByokOpen(true)}
                onRetryAnalysis={handleRetryAnalysis}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-5 w-full min-w-0 md:max-w-4xl md:mx-auto">
            {filteredQuestions.map((q, idx) => (
              <QuestionCard
                key={q.id}
                question={q}
                index={idx}
                totalCount={filteredQuestions.length}
                layout={layout}
                onOpenImageControl={(question) => setSelectedQuestionForImageModal(question)}
                onOpenCalibration={handleOpenCalibrationForQuestion}
                onDelete={handleDeleteQuestion}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
                onUpdateQuestion={handleUpdateQuestion}
                onAddSimilarAsQuestion={handleAddSimilarAsQuestion}
                onOpenByokModal={() => setIsByokOpen(true)}
                onRetryAnalysis={handleRetryAnalysis}
              />
            ))}
          </div>
        )}
      </main>

      {/* Image Control Modal */}
      {selectedQuestionForImageModal && (
        <ImageControlModal
          isOpen={Boolean(selectedQuestionForImageModal)}
          questionId={selectedQuestionForImageModal.id}
          imageSrc={selectedQuestionForImageModal.imageBase64}
          settings={selectedQuestionForImageModal.imageSettings}
          onClose={() => setSelectedQuestionForImageModal(null)}
          onUpdateSettings={handleUpdateImageSettings}
          onDeleteQuestion={handleDeleteQuestion}
          onRemoveImageOnly={handleRemoveImageOnly}
          onOpenCalibration={() => {
            const q = selectedQuestionForImageModal;
            setSelectedQuestionForImageModal(null);
            handleOpenCalibrationForQuestion(q);
          }}
          onReplaceImage={(newBase64) => {
            handleUpdateQuestion(selectedQuestionForImageModal.id, {
              imageBase64: newBase64,
              imageSettings: {
                ...selectedQuestionForImageModal.imageSettings,
                zoom: 100,
                includeInExport: true,
              },
            });
            setSelectedQuestionForImageModal((prev) =>
              prev
                ? {
                    ...prev,
                    imageBase64: newBase64,
                    imageSettings: { ...prev.imageSettings, zoom: 100, includeInExport: true },
                  }
                : null
            );
          }}
        />
      )}

      {/* Perspective Correction and Cropping Modal */}
      {calibrationModal.isOpen && calibrationModal.imageSrc && (
        <ImageCalibrationModal
          isOpen={calibrationModal.isOpen}
          imageSrc={calibrationModal.imageSrc}
          initialMode={calibrationModal.initialMode || "perspective"}
          isExistingQuestion={Boolean(calibrationModal.targetQuestionId)}
          onConfirm={handleCalibrationConfirm}
          onSkip={handleCalibrationSkip}
          onReplaceTargetImage={(newImg) => {
            if (calibrationModal.targetQuestionId) {
              handleUpdateQuestion(calibrationModal.targetQuestionId, {
                imageBase64: newImg,
              });
            }
          }}
          onClose={() => setCalibrationModal({ isOpen: false, imageSrc: "" })}
        />
      )}

      {/* BYOK Settings Modal */}
      <ByokModal
        isOpen={isByokOpen}
        onClose={() => setIsByokOpen(false)}
        onKeyUpdated={refreshKeyStatus}
      />

      {/* PDF Export & Print Modal */}
      <PdfExportModal
        isOpen={isPdfModalOpen}
        questions={filteredQuestions}
        settings={paperSettings}
        onClose={() => setIsPdfModalOpen(false)}
        onUpdateSettings={setPaperSettings}
      />

      {/* Backup & Restore Modal */}
      <BackupModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        questions={questions}
        paperSettings={paperSettings}
        onRestoreQuestions={handleRestoreQuestions}
      />
    </div>
  );
}
