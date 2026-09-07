import React, { useState } from "react";
import {
  ChevronUp,
  ChevronDown,
  Trash2,
  Edit3,
  Check,
  RotateCw,
  ZoomIn,
  Sliders,
  AlertTriangle,
  Lightbulb,
  BookMarked,
  BookOpen,
  GraduationCap,
  Eye,
  EyeOff,
  Tag,
  Sparkles,
  Plus,
  Loader2,
  HelpCircle,
  CheckCircle2,
  RefreshCw,
  ChevronRight,
  FileQuestion,
} from "lucide-react";
import { QuestionItem, ViewLayout, SimilarQuestionVariant } from "../types";
import { generateSimilarQuestion } from "../services/aiService";

interface QuestionCardProps {
  question: QuestionItem;
  index: number;
  totalCount: number;
  layout: ViewLayout;
  onOpenImageControl: (question: QuestionItem) => void;
  onDelete: (id: string) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onUpdateQuestion: (id: string, updated: Partial<QuestionItem>) => void;
  onAddSimilarAsQuestion?: (similar: SimilarQuestionVariant, parentQ: QuestionItem) => void;
  onOpenByokModal?: () => void;
}

export const QuestionCard: React.FC<QuestionCardProps> = ({
  question,
  index,
  totalCount,
  layout,
  onOpenImageControl,
  onDelete,
  onMoveUp,
  onMoveDown,
  onUpdateQuestion,
  onAddSimilarAsQuestion,
  onOpenByokModal,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedSubject, setEditedSubject] = useState(question.subject || "");
  const [editedGradeLevel, setEditedGradeLevel] = useState(question.gradeLevel || "");
  const [editedChapter, setEditedChapter] = useState(question.chapter || "");
  const [editedUnit, setEditedUnit] = useState(question.unit || "");
  const [editedText, setEditedText] = useState(question.questionText);
  const [editedExplanation, setEditedExplanation] = useState(question.explanation);
  const [editedNotes, setEditedNotes] = useState(question.myNotes || "");
  const [showAnswerInPaper, setShowAnswerInPaper] = useState(false);

  // AI Similar Question Generator State
  const [isGeneratingSimilar, setIsGeneratingSimilar] = useState(false);
  const [similarError, setSimilarError] = useState<string | null>(null);
  const [variationType, setVariationType] = useState<"similar" | "easier" | "harder">("similar");
  const [showSimilarSection, setShowSimilarSection] = useState(false);
  const [revealedVariantAnswers, setRevealedVariantAnswers] = useState<{ [id: string]: boolean }>({});
  const [addedVariantsMap, setAddedVariantsMap] = useState<{ [id: string]: boolean }>({});

  const handleSaveEdit = () => {
    onUpdateQuestion(question.id, {
      subject: editedSubject,
      gradeLevel: editedGradeLevel,
      chapter: editedChapter,
      unit: editedUnit,
      questionText: editedText,
      explanation: editedExplanation,
      myNotes: editedNotes,
    });
    setIsEditing(false);
  };

  const handleGenerateSimilar = async () => {
    setIsGeneratingSimilar(true);
    setSimilarError(null);
    setShowSimilarSection(true);

    try {
      const res = await generateSimilarQuestion({
        questionText: question.questionText,
        subject: question.subject,
        gradeLevel: question.gradeLevel,
        chapter: question.chapter,
        unit: question.unit,
        answer: question.answer,
        coreConcepts: question.coreConcepts,
        variationType,
        difficulty: variationType === "easier" ? "基礎" : variationType === "harder" ? "挑戰" : "中等",
      });

      const newVariant: SimilarQuestionVariant = {
        id: `var_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        questionText: res.題目文字,
        answer: res.答案,
        coreConcepts: res.核心考點 || question.coreConcepts,
        variationPoint: res.變形設計重點,
        explanation: res.詳解步驟,
        tips: res.解題技巧提示,
        difficulty: (res.難度 as any) || (variationType === "easier" ? "基礎" : variationType === "harder" ? "挑戰" : "中等"),
        createdAt: Date.now(),
      };

      const currentVariants = question.similarVariants || [];
      onUpdateQuestion(question.id, {
        similarVariants: [newVariant, ...currentVariants],
      });
    } catch (err: any) {
      console.error("Failed to generate similar question:", err);
      const msg = err?.message || "生成相似題目失敗";
      setSimilarError(msg);
      if (err?.needKey && onOpenByokModal) {
        onOpenByokModal();
      }
    } finally {
      setIsGeneratingSimilar(false);
    }
  };

  const toggleVariantAnswer = (id: string) => {
    setRevealedVariantAnswers((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleAddVariantToNotebook = (variant: SimilarQuestionVariant) => {
    if (onAddSimilarAsQuestion) {
      onAddSimilarAsQuestion(variant, question);
      setAddedVariantsMap((prev) => ({
        ...prev,
        [variant.id]: true,
      }));
    }
  };

  const handleDeleteVariant = (variantId: string) => {
    const currentVariants = question.similarVariants || [];
    const updated = currentVariants.filter((v) => v.id !== variantId);
    onUpdateQuestion(question.id, {
      similarVariants: updated,
    });
  };

  const getSubjectColor = (subj: string) => {
    switch (subj) {
      case "數學":
        return "bg-blue-50 text-blue-700 border-blue-200";
      case "物理":
        return "bg-cyan-50 text-cyan-700 border-cyan-200";
      case "化學":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "生物":
        return "bg-lime-50 text-lime-700 border-lime-200";
      case "英文":
        return "bg-purple-50 text-purple-700 border-purple-200";
      case "國文":
        return "bg-amber-50 text-amber-700 border-amber-200";
      default:
        return "bg-slate-50 text-slate-700 border-slate-200";
    }
  };

  const isExamPaper = layout === "paper";
  const variants = question.similarVariants || [];

  return (
    <div
      id={`question-card-${question.id}`}
      className={`bg-white rounded-2xl border transition-all duration-200 ${
        question.isSimilarVariant
          ? "border-amber-300 bg-amber-50/20 shadow-xs p-5"
          : isExamPaper
          ? "border-slate-300/80 p-6 shadow-xs font-serif"
          : "border-slate-200 shadow-xs hover:shadow-md p-5"
      }`}
    >
      {/* Top Header Bar */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100 mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Question Sequence Number */}
          <span
            className={`w-7 h-7 rounded-lg font-mono font-bold text-xs flex items-center justify-center shrink-0 ${
              question.isSimilarVariant
                ? "bg-amber-600 text-white"
                : "bg-slate-900 text-white"
            }`}
          >
            {question.isSimilarVariant ? "練" : index + 1}
          </span>

          {/* Similar Question Indicator Tag */}
          {question.isSimilarVariant && (
            <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1 shadow-2xs">
              <Sparkles className="w-3 h-3 text-amber-600" />
              AI 舉一反三練習題
            </span>
          )}

          {/* Subject Badge */}
          <span
            className={`px-2.5 py-0.5 rounded-md text-xs font-bold border ${getSubjectColor(
              question.subject
            )}`}
          >
            {question.subject || "綜合"}
          </span>

          {/* Book / Volume Badge (冊別) */}
          {question.gradeLevel && (
            <span
              className="px-2 py-0.5 rounded-md text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/80 flex items-center gap-1 shadow-2xs"
              title="教材冊別與年級"
            >
              <GraduationCap className="w-3 h-3 text-indigo-600 shrink-0" />
              {question.gradeLevel}
            </span>
          )}

          {/* Chapter Badge (章節) */}
          {question.chapter && (
            <span
              className="px-2 py-0.5 rounded-md text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200/80 flex items-center gap-1 shadow-2xs"
              title="所屬章節名稱"
            >
              <BookOpen className="w-3 h-3 text-amber-600 shrink-0" />
              {question.chapter}
            </span>
          )}

          {/* Unit Badge */}
          <span
            className="px-2.5 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-700 flex items-center gap-1 border border-slate-200/60"
            title="所屬小節或主題"
          >
            <Tag className="w-3 h-3 text-slate-400" />
            {question.unit || "未分類單元"}
          </span>

          {question.questionType && (
            <span className="text-[11px] text-slate-500 font-sans">
              [{question.questionType}]
            </span>
          )}

          {/* Variation Point if this is a variant */}
          {question.variationPoint && (
            <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-medium">
              💡 {question.variationPoint}
            </span>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => onMoveUp(index)}
            className="p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-30 rounded-lg hover:bg-slate-100 transition"
            title="向上移動題目"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={index === totalCount - 1}
            onClick={() => onMoveDown(index)}
            className="p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-30 rounded-lg hover:bg-slate-100 transition"
            title="向下移動題目"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setIsEditing(!isEditing)}
            className={`p-1.5 rounded-lg transition ${
              isEditing ? "bg-sky-100 text-sky-700" : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            }`}
            title="編輯題目文字與詳解"
          >
            <Edit3 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("確定刪除此題目嗎？")) {
                onDelete(question.id);
              }
            }}
            className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition"
            title="刪除題目"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Image Preview with Interactive Trigger */}
      {question.imageBase64 && question.imageSettings.includeInExport && (
        <div className="mb-4">
          <div
            className={`w-full flex ${
              question.imageSettings.align === "left"
                ? "justify-start"
                : question.imageSettings.align === "right"
                ? "justify-end"
                : "justify-center"
            }`}
          >
            <div
              onClick={() => onOpenImageControl(question)}
              className="group relative cursor-pointer inline-block rounded-xl overflow-hidden border border-slate-200/80 bg-slate-50 transition hover:shadow-md"
              title="點擊圖片開啟控制面板 (放大、縮小、旋轉、刪除)"
            >
              <img
                src={question.imageBase64}
                alt="題目截圖"
                className="max-h-64 object-contain transition-transform duration-200 select-none"
                style={{
                  transform: `rotate(${question.imageSettings.rotation}deg) scale(${
                    question.imageSettings.zoom / 100
                  })`,
                  transformOrigin: "center center",
                }}
              />
              {/* Hover overlay hint */}
              <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 text-white text-xs font-semibold backdrop-blur-xs">
                <Sliders className="w-4 h-4" />
                點擊開啟圖片控制面板 (縮放 / 旋轉 / 排版)
              </div>
            </div>
          </div>
          <div className="mt-1 flex items-center justify-center gap-2 text-[11px] text-slate-400">
            <span>縮放：{question.imageSettings.zoom}%</span>
            <span>·</span>
            <span>旋轉：{question.imageSettings.rotation}°</span>
            <span>·</span>
            <button
              type="button"
              onClick={() => onOpenImageControl(question)}
              className="text-sky-600 hover:underline inline-flex items-center gap-0.5 font-medium"
            >
              <Sliders className="w-3 h-3" /> 調整圖片
            </button>
          </div>
        </div>
      )}

      {/* Question Content & Edit Mode */}
      {isEditing ? (
        <div className="space-y-3 p-3.5 bg-slate-50 rounded-xl border border-slate-200 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                科目
              </label>
              <input
                type="text"
                value={editedSubject}
                onChange={(e) => setEditedSubject(e.target.value)}
                placeholder="例如：數學"
                className="w-full text-xs p-2 rounded-lg border border-slate-300 bg-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                年級 / 冊別
              </label>
              <input
                type="text"
                value={editedGradeLevel}
                onChange={(e) => setEditedGradeLevel(e.target.value)}
                placeholder="例如：國二上 (第3冊)"
                className="w-full text-xs p-2 rounded-lg border border-slate-300 bg-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                章節名稱
              </label>
              <input
                type="text"
                value={editedChapter}
                onChange={(e) => setEditedChapter(e.target.value)}
                placeholder="例如：第2章 平方根"
                className="w-full text-xs p-2 rounded-lg border border-slate-300 bg-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                單元名稱
              </label>
              <input
                type="text"
                value={editedUnit}
                onChange={(e) => setEditedUnit(e.target.value)}
                placeholder="例如：2-1 平方根的意義"
                className="w-full text-xs p-2 rounded-lg border border-slate-300 bg-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">
              題目文字內容
            </label>
            <textarea
              rows={4}
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              className="w-full text-xs p-2.5 rounded-lg border border-slate-300 bg-white leading-relaxed"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">
              詳細推導步驟
            </label>
            <textarea
              rows={4}
              value={editedExplanation}
              onChange={(e) => setEditedExplanation(e.target.value)}
              className="w-full text-xs p-2.5 rounded-lg border border-slate-300 bg-white leading-relaxed"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">
              個人心得 / 覆盤筆記
            </label>
            <input
              type="text"
              value={editedNotes}
              onChange={(e) => setEditedNotes(e.target.value)}
              placeholder="寫下您為何做錯、解題卡在哪個步驟..."
              className="w-full text-xs p-2 rounded-lg border border-slate-300 bg-white"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded-lg transition"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSaveEdit}
              className="px-4 py-1.5 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition flex items-center gap-1 shadow-xs"
            >
              <Check className="w-3.5 h-3.5" /> 儲存變更
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Question Text */}
          <div className="text-sm leading-relaxed text-slate-800 whitespace-pre-line">
            {question.questionText}
          </div>

          {/* Exam Paper Mode: Blank workspace & answer preview toggle */}
          {isExamPaper && (
            <div className="pt-2 border-t border-dashed border-slate-200">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-sans">
                  【作答空白區域 · 學生解題區】
                </span>
                <button
                  type="button"
                  onClick={() => setShowAnswerInPaper(!showAnswerInPaper)}
                  className="text-[11px] text-slate-500 hover:text-slate-800 font-sans flex items-center gap-1"
                >
                  {showAnswerInPaper ? (
                    <>
                      <EyeOff className="w-3.5 h-3.5" /> 隱藏參考答案
                    </>
                  ) : (
                    <>
                      <Eye className="w-3.5 h-3.5" /> 快速查看答案
                    </>
                  )}
                </button>
              </div>

              <div className="mt-2 h-24 border border-dashed border-slate-300 rounded-lg bg-slate-50/40 p-2 flex items-center justify-center text-xs text-slate-400 font-sans">
                印出時保留空白作答演算區域
              </div>

              {showAnswerInPaper && question.answer && (
                <div className="mt-2 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-sans">
                  <span className="font-bold">參考答案：</span> {question.answer}
                </div>
              )}
            </div>
          )}

          {/* Notebook Mode: Rich learning badges */}
          {!isExamPaper && (
            <div className="space-y-3 pt-2">
              {/* Answer & Core Concept */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {question.answer && (
                  <div className="p-3 rounded-xl bg-emerald-50/80 border border-emerald-200/80 text-xs">
                    <span className="font-bold text-emerald-900 block mb-0.5">
                      標準答案
                    </span>
                    <span className="text-emerald-800 font-semibold">
                      {question.answer}
                    </span>
                  </div>
                )}
                {question.coreConcepts && (
                  <div className="p-3 rounded-xl bg-sky-50/80 border border-sky-200/80 text-xs">
                    <span className="font-bold text-sky-900 block mb-0.5 flex items-center gap-1">
                      <Lightbulb className="w-3.5 h-3.5 text-sky-600" />
                      核心考點
                    </span>
                    <span className="text-sky-800">{question.coreConcepts}</span>
                  </div>
                )}
              </div>

              {/* Common Pitfalls */}
              {question.commonPitfalls && (
                <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200/80 text-xs text-amber-900 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block mb-0.5">易錯陷阱與概念盲區</span>
                    <span className="whitespace-pre-line text-amber-800 leading-relaxed">
                      {question.commonPitfalls}
                    </span>
                  </div>
                </div>
              )}

              {/* Detailed Step-by-Step Explanation */}
              {question.explanation && (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs leading-relaxed text-slate-700">
                  <span className="font-bold text-slate-900 block mb-1">
                    詳細解題步驟
                  </span>
                  <div className="whitespace-pre-line text-slate-700">
                    {question.explanation}
                  </div>
                </div>
              )}

              {/* Key Tips */}
              {question.tips && (
                <div className="text-[11px] text-indigo-700 bg-indigo-50/60 p-2.5 rounded-lg border border-indigo-100 flex items-center gap-1.5">
                  <span className="font-bold">解題技巧：</span>
                  <span>{question.tips}</span>
                </div>
              )}

              {/* Student Personal Notes */}
              <div className="p-3 rounded-xl bg-slate-50/60 border border-dashed border-slate-300 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-slate-700 flex items-center gap-1">
                    <BookMarked className="w-3.5 h-3.5 text-slate-500" />
                    我的訂正心得 / 覆盤筆記
                  </span>
                  {!question.myNotes && (
                    <button
                      type="button"
                      onClick={() => setIsEditing(true)}
                      className="text-sky-600 hover:underline text-[11px]"
                    >
                      + 新增覆盤心得
                    </button>
                  )}
                </div>
                {question.myNotes ? (
                  <p className="text-slate-600 italic">{question.myNotes}</p>
                ) : (
                  <p className="text-slate-400 italic">尚無個人心得筆記，點擊鉛筆圖示即可填寫。</p>
                )}
              </div>
            </div>
          )}

          {/* AI 舉一反三 · 相似題型生成與練習模組 */}
          {!question.isSimilarVariant && (
            <div className="mt-4 pt-4 border-t border-slate-200/90 font-sans">
              <div className="bg-linear-to-r from-amber-50/80 via-orange-50/40 to-sky-50/50 rounded-2xl border border-amber-200/80 p-3.5 sm:p-4">
                {/* Module Header */}
                <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-amber-500 text-white flex items-center justify-center shadow-xs">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        AI 舉一反三 · 相似題型練習
                        {variants.length > 0 && (
                          <span className="px-1.5 py-0.2 rounded-full bg-amber-200 text-amber-900 text-[10px] font-semibold">
                            已產出 {variants.length} 題
                          </span>
                        )}
                      </h4>
                      <p className="text-[10px] text-slate-500">
                        根據本題考點「{question.unit || question.coreConcepts || "核心觀念"}」智能改編數字與情境，立即驗證理解！
                      </p>
                    </div>
                  </div>

                  {/* Toggle Expand / Collapse & Clear if has variants */}
                  {variants.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setShowSimilarSection(!showSimilarSection)}
                        className="text-xs text-amber-800 hover:text-amber-900 font-semibold flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-100/60 hover:bg-amber-100 transition"
                      >
                        {showSimilarSection ? "收合練習題" : `展開 ${variants.length} 道練習題`}
                        <ChevronRight
                          className={`w-3.5 h-3.5 transition-transform ${
                            showSimilarSection ? "rotate-90" : ""
                          }`}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`確定要清除這 ${variants.length} 道已生成的練習題嗎？`)) {
                            onUpdateQuestion(question.id, { similarVariants: [] });
                          }
                        }}
                        className="p-1 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition"
                        title="清空本題所有已生成的練習題"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Generator Action Controls */}
                <div className="mt-3 flex flex-wrap items-center gap-2 pt-2 border-t border-amber-200/60">
                  {/* Variation Type Switcher */}
                  <div className="inline-flex rounded-xl bg-white p-0.5 border border-amber-200 text-[11px] shadow-2xs">
                    <button
                      type="button"
                      onClick={() => setVariationType("similar")}
                      className={`px-2.5 py-1 rounded-lg font-medium transition ${
                        variationType === "similar"
                          ? "bg-amber-600 text-white font-bold shadow-xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      🎯 同觀念變形題
                    </button>
                    <button
                      type="button"
                      onClick={() => setVariationType("easier")}
                      className={`px-2.5 py-1 rounded-lg font-medium transition ${
                        variationType === "easier"
                          ? "bg-emerald-600 text-white font-bold shadow-xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      🟢 基礎打底題
                    </button>
                    <button
                      type="button"
                      onClick={() => setVariationType("harder")}
                      className={`px-2.5 py-1 rounded-lg font-medium transition ${
                        variationType === "harder"
                          ? "bg-rose-600 text-white font-bold shadow-xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      🔴 進階挑戰題
                    </button>
                  </div>

                  {/* Trigger Generate Button */}
                  <button
                    type="button"
                    disabled={isGeneratingSimilar}
                    onClick={handleGenerateSimilar}
                    className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition disabled:opacity-50"
                  >
                    {isGeneratingSimilar ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        AI 命題審題中...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        {variants.length === 0 ? "產生第 1 題相似題" : "再產生一題變形題"}
                      </>
                    )}
                  </button>
                </div>

                {/* Error Banner */}
                {similarError && (
                  <div className="mt-2.5 p-2 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center justify-between">
                    <span>{similarError}</span>
                    <button
                      type="button"
                      onClick={() => setSimilarError(null)}
                      className="text-rose-500 hover:text-rose-800 text-[11px] font-bold"
                    >
                      關閉
                    </button>
                  </div>
                )}

                {/* List of Generated Variants */}
                {showSimilarSection && variants.length > 0 && (
                  <div className="mt-3.5 space-y-3 pt-2">
                    {variants.map((v, vIdx) => {
                      const isRevealed = revealedVariantAnswers[v.id];
                      const isAdded = addedVariantsMap[v.id];

                      return (
                        <div
                          key={v.id}
                          className="bg-white rounded-xl border border-amber-300/80 p-3.5 shadow-xs space-y-2.5 transition-all"
                        >
                          {/* Variant Card Header */}
                          <div className="flex items-center justify-between flex-wrap gap-2 pb-1.5 border-b border-slate-100">
                            <div className="flex items-center gap-1.5">
                              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-bold text-[10px]">
                                練習題 #{variants.length - vIdx}
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-semibold">
                                難度：{v.difficulty || "中等"}
                              </span>
                              {v.variationPoint && (
                                <span className="text-[10px] text-amber-800 font-medium">
                                  改編亮點：{v.variationPoint}
                                </span>
                              )}
                            </div>

                            {/* Add to Notebook / Exam Paper Action & Delete Action */}
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={isAdded}
                                onClick={() => handleAddVariantToNotebook(v)}
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 transition ${
                                  isAdded
                                    ? "bg-emerald-50 text-emerald-700 border border-emerald-300"
                                    : "bg-sky-50 text-sky-700 hover:bg-sky-100 border border-sky-200 shadow-2xs"
                                }`}
                                title="將此道練習題作為獨立題目加入錯題筆記清單中，方便一起列印考卷"
                              >
                                {isAdded ? (
                                  <>
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                    已加入試卷清單
                                  </>
                                ) : (
                                  <>
                                    <Plus className="w-3.5 h-3.5" />
                                    加入錯題本/考卷
                                  </>
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (window.confirm("確定要刪除這道生成的練習題嗎？")) {
                                    handleDeleteVariant(v.id);
                                  }
                                }}
                                className="p-1 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition"
                                title="刪除此道練習題"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Variant Question Text */}
                          <div className="text-xs text-slate-900 leading-relaxed whitespace-pre-line bg-slate-50/50 p-2.5 rounded-lg border border-slate-200/60 font-sans">
                            {v.questionText}
                          </div>

                          {/* Answer & Explanation Toggle */}
                          <div>
                            <button
                              type="button"
                              onClick={() => toggleVariantAnswer(v.id)}
                              className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                            >
                              {isRevealed ? (
                                <>
                                  <EyeOff className="w-3 h-3" /> 隱藏標準答案與詳解步驟
                                </>
                              ) : (
                                <>
                                  <Eye className="w-3 h-3" /> 查看練習題答案與詳細推導
                                </>
                              )}
                            </button>

                            {isRevealed && (
                              <div className="mt-2 p-2.5 bg-indigo-50/60 rounded-lg border border-indigo-200 text-xs space-y-1.5 animate-in fade-in duration-150">
                                <div className="flex items-baseline gap-1.5">
                                  <span className="font-bold text-emerald-800">
                                    【標準答案】：
                                  </span>
                                  <span className="font-semibold text-emerald-950">
                                    {v.answer}
                                  </span>
                                </div>
                                {v.explanation && (
                                  <div className="text-slate-700 pt-1 border-t border-indigo-100">
                                    <span className="font-bold text-indigo-950 block mb-0.5">
                                      【詳細解題步驟】：
                                    </span>
                                    <div className="whitespace-pre-line leading-relaxed text-slate-600">
                                      {v.explanation}
                                    </div>
                                  </div>
                                )}
                                {v.tips && (
                                  <div className="text-[10px] text-amber-800 bg-amber-50 p-1.5 rounded border border-amber-200/60">
                                    <span className="font-bold">思考點撥：</span>
                                    {v.tips}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
