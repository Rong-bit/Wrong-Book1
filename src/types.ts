export interface ImageSettings {
  zoom: number; // 40 - 200 percentage
  rotation: number; // 0, 90, 180, 270 degrees
  align: "left" | "center" | "right";
  includeInExport: boolean;
}

export interface SimilarQuestionVariant {
  id: string;
  questionText: string;
  answer: string;
  coreConcepts?: string;
  variationPoint?: string; // 變形設計重點
  explanation: string;
  tips?: string;
  difficulty?: "基礎" | "中等" | "挑戰";
  createdAt: number;
}

export interface QuestionItem {
  id: string;
  imageBase64: string;
  imageSettings: ImageSettings;
  subject: string;
  gradeLevel?: string; // 年級與冊別，例如：國二上 (第3冊)、高一 (第1冊)
  chapter?: string; // 章節名稱，例如：第2章 平方根與商高定理
  unit: string; // 小節或單元名稱，例如：2-1 平方根的意義
  questionText: string;
  questionType?: string;
  answer?: string;
  coreConcepts?: string;
  commonPitfalls?: string;
  explanation: string;
  tips?: string;
  difficulty?: "基礎" | "中等" | "挑戰";
  myNotes?: string;
  createdAt: number;
  status: "analyzing" | "ready" | "error";
  errorMessage?: string;
  similarVariants?: SimilarQuestionVariant[];
  isSimilarVariant?: boolean;
  parentQuestionId?: string;
  variationPoint?: string;
}

export type PaperSize = "B5" | "A4";
export type QuestionDisplayMode = "both" | "imageOnly" | "textOnly";

export interface PaperSettings {
  title: string;
  subtitle: string;
  school: string;
  gradeClass: string;
  studentName: string;
  seatNumber: string;
  paperSize: PaperSize;
  orientation: "portrait" | "landscape";
  mode: "cornell" | "notebook" | "exam"; // "cornell" (康乃爾雙欄手寫訂正本) vs "notebook" (含解析筆記) vs "exam" (挖空作答卷)
  questionDisplayMode: QuestionDisplayMode; // "both" (文字與截圖) | "imageOnly" (僅截圖照片沒文字) | "textOnly" (僅文字無截圖)
  questionsPerPage: 1 | 2; // 康乃爾模式每頁題數 (1 或 2 題)
  showGrid: boolean; // 是否顯示 5mm 數學微網格手寫背景
  showCheckboxes: boolean; // 是否包含 8 大錯誤原因分析核取框
  showReviewTrack: boolean; // 是否包含艾賓浩斯 5 次複習打卡檢核
  includeAnswerSheet: boolean; // 末頁附上解答與解析
  includeImages: boolean; // 考卷是否顯示原題截圖
  includeSimilarPractice?: boolean; // 匯出時是否附加各題之 AI 相似題練習
  leaveBlankHeight: number; // 留白計算區域高度 (px: 60, 120, 180)
  columns: 1 | 2; // 單欄或雙欄排版
}

export type ViewLayout = "notebook" | "paper" | "grid";
