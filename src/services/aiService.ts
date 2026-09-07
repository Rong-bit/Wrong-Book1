export interface AIAnalysisResult {
  科目: string;
  冊別?: string;
  章節?: string;
  單元: string;
  題目文字: string;
  題型?: string;
  答案?: string;
  核心考點?: string;
  易錯陷阱?: string;
  詳解步驟: string;
  關鍵技巧?: string;
}

const STORAGE_KEY_BYOK = "custom_gemini_api_key";
const STORAGE_KEY_MODEL = "custom_gemini_model_preference";

export const AVAILABLE_MODELS = [
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash (推薦)",
    badge: "速度與多模態平衡",
    description: "適合絕大多數中學與高中各學科考題，速度極快，考點歸納精準",
  },
  {
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro Preview",
    badge: "深層推導與高等數理",
    description: "適合難度較高之奧數、競賽題、多重步驟物理幾何推導",
  },
  {
    id: "gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite",
    badge: "極致響應與低延遲",
    description: "輕量化多模態模型，適合快速大量匯入題目",
  },
];

export function getStoredApiKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(STORAGE_KEY_BYOK) || "";
}

export function saveStoredApiKey(key: string): void {
  if (typeof window === "undefined") return;
  if (!key.trim()) {
    localStorage.removeItem(STORAGE_KEY_BYOK);
  } else {
    localStorage.setItem(STORAGE_KEY_BYOK, key.trim());
  }
}

export function getStoredModel(): string {
  if (typeof window === "undefined") return "gemini-3.8-flash";
  return localStorage.getItem(STORAGE_KEY_MODEL) || "gemini-3.8-flash";
}

export function saveStoredModel(model: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY_MODEL, model);
}

export function getMaskedKey(key: string): string {
  if (!key || key.length < 8) return "";
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

export async function checkServerConfig(): Promise<{ hasServerKey: boolean }> {
  try {
    const res = await fetch("/api/config");
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    console.warn("Could not fetch /api/config:", e);
  }
  return { hasServerKey: false };
}

export interface KeyVerificationResponse {
  valid: boolean;
  message: string;
  latencyMs?: number;
  model?: string;
  error?: string;
}

export async function verifyApiKey(
  apiKey: string,
  model?: string
): Promise<KeyVerificationResponse> {
  try {
    const res = await fetch("/api/verify-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: apiKey.trim(),
        model: model || getStoredModel(),
      }),
    });

    const data = await res.json();
    if (res.ok && data.valid) {
      return {
        valid: true,
        message: data.message || "連線測試成功！",
        latencyMs: data.latencyMs,
        model: data.model,
      };
    } else {
      return {
        valid: false,
        message: data.error || "金鑰驗證未通過",
        latencyMs: data.latencyMs,
        error: data.error,
      };
    }
  } catch (err: any) {
    return {
      valid: false,
      message: "無法連線至後端驗證服務：" + (err?.message || "網路異常"),
    };
  }
}

export async function analyzeQuestionImage(
  imageBase64: string,
  subjectHint?: string
): Promise<AIAnalysisResult> {
  const customApiKey = getStoredApiKey();
  const selectedModel = getStoredModel();

  // Extract mime type
  const mimeMatch = imageBase64.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";

  const response = await fetch("/api/analyze-question", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      imageBase64,
      mimeType,
      customApiKey,
      selectedModel,
      subjectHint,
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    const message = errData.error || `伺服器回應錯誤 (${response.status})`;
    const error: any = new Error(message);
    error.isKeyProblem = errData.isKeyProblem;
    error.needKey = errData.needKey;
    throw error;
  }

  const result = await response.json();
  if (!result.success || !result.data) {
    throw new Error("AI 分析回傳格式異常，請再試一次。");
  }

  return result.data as AIAnalysisResult;
}

export interface GenerateSimilarQuestionParams {
  questionText: string;
  subject?: string;
  gradeLevel?: string;
  chapter?: string;
  unit?: string;
  answer?: string;
  coreConcepts?: string;
  variationType?: "similar" | "easier" | "harder";
  difficulty?: "基礎" | "中等" | "挑戰";
}

export interface AISimilarQuestionResult {
  題目文字: string;
  答案: string;
  核心考點?: string;
  變形設計重點: string;
  詳解步驟: string;
  解題技巧提示?: string;
  難度?: "基礎" | "中等" | "挑戰";
}

export async function generateSimilarQuestion(
  params: GenerateSimilarQuestionParams
): Promise<AISimilarQuestionResult> {
  const customApiKey = getStoredApiKey();
  const selectedModel = getStoredModel();

  const response = await fetch("/api/generate-similar-questions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...params,
      customApiKey,
      selectedModel,
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    const message = errData.error || `生成相似題失敗 (${response.status})`;
    const error: any = new Error(message);
    error.needKey = errData.needKey;
    throw error;
  }

  const result = await response.json();
  if (!result.success || !result.data) {
    throw new Error("AI 生成格式異常，請重試。");
  }

  return result.data as AISimilarQuestionResult;
}
