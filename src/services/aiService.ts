import {
  buildAnalyzePrompt,
  buildSimilarPrompt,
  createGeminiClient,
  formatErrorMessage,
  generateContentWithRetry,
  getAnalyzeResponseSchema,
  getSimilarResponseSchema,
  parseJsonResponse,
  resolveModel,
} from "./geminiCore";

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
const MISSING_KEY_MESSAGE =
  "未檢測到有效 Gemini API Key。請在右上角「自備金鑰 (BYOK)」填入您的 API Key。";

export const AVAILABLE_MODELS = [
  {
    id: "gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite (穩定首選)",
    badge: "極致響應與尖峰抗塞",
    description: "輕量高吞吐多模態模型，連線極速穩定，不受雲端尖峰負載影響",
  },
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    badge: "速度與多模態平衡",
    description: "適合絕大多數中學與高中各學科考題，速度極快，考點歸納精準",
  },
  {
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro Preview",
    badge: "深層推導與高等數理",
    description: "適合難度較高之奧數、競賽題、多重步驟物理幾何推導",
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
  if (typeof window === "undefined") return "gemini-3.1-flash-lite";
  return localStorage.getItem(STORAGE_KEY_MODEL) || "gemini-3.1-flash-lite";
}

export function saveStoredModel(model: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY_MODEL, model);
}

export function getMaskedKey(key: string): string {
  if (!key || key.length < 8) return "";
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

function isBackendUnavailable(response?: Response | null): boolean {
  if (!response) return true;
  if (response.status === 404 || response.status === 405) return true;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return true;
  return false;
}

function throwNeedKey(message = MISSING_KEY_MESSAGE): never {
  const error: any = new Error(message);
  error.needKey = true;
  throw error;
}

function throwFormatted(error: any): never {
  const { message, isKeyProblem, isTransient } = formatErrorMessage(error);
  const wrapped: any = new Error(message);
  wrapped.isKeyProblem = isKeyProblem;
  wrapped.isTransient = isTransient;
  wrapped.needKey = isKeyProblem;
  throw wrapped;
}

export async function checkServerConfig(): Promise<{ hasServerKey: boolean }> {
  try {
    const res = await fetch("/api/config");
    if (res.ok && !isBackendUnavailable(res)) {
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

async function verifyApiKeyOnClient(
  apiKey: string,
  model?: string
): Promise<KeyVerificationResponse> {
  const startTime = Date.now();
  const testKey = apiKey.trim();
  if (!testKey) {
    return {
      valid: false,
      message: "未提供金鑰以供測試。",
    };
  }

  try {
    const ai = createGeminiClient(testKey);
    const { response: testResponse, modelUsed } = await generateContentWithRetry(
      ai,
      resolveModel(model),
      { contents: "Reply with the exact word 'PONG'" }
    );
    return {
      valid: true,
      message: "金鑰連線測試成功！可正常調用 Gemini API。",
      latencyMs: Date.now() - startTime,
      model: modelUsed,
    };
  } catch (error: any) {
    const { message } = formatErrorMessage(error);
    return {
      valid: false,
      message,
      latencyMs: Date.now() - startTime,
      error: message,
    };
  }
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

    if (isBackendUnavailable(res)) {
      return verifyApiKeyOnClient(apiKey, model);
    }

    const data = await res.json();
    if (res.ok && data.valid) {
      return {
        valid: true,
        message: data.message || "連線測試成功！",
        latencyMs: data.latencyMs,
        model: data.model,
      };
    }
    return {
      valid: false,
      message: data.error || "金鑰驗證未通過",
      latencyMs: data.latencyMs,
      error: data.error,
    };
  } catch (err: any) {
    return verifyApiKeyOnClient(apiKey, model);
  }
}

function parseServerError(errData: any, fallback: string, status: number) {
  let message = errData.error || fallback;
  const isTransient =
    Boolean(errData.isTransient) ||
    status === 503 ||
    message.includes("503") ||
    message.includes("high demand") ||
    message.includes("Spikes in demand");

  if (isTransient && !errData.error) {
    message = "Google AI 雲端服務目前處於尖峰高負載 (503)，請稍候 5~10 秒後再次嘗試。";
  }

  const error: any = new Error(message);
  error.isKeyProblem = errData.isKeyProblem;
  error.needKey = errData.needKey;
  error.isTransient = isTransient;
  return error;
}

async function analyzeQuestionImageOnClient(
  imageBase64: string,
  subjectHint?: string
): Promise<AIAnalysisResult> {
  const customApiKey = getStoredApiKey();
  if (!customApiKey) {
    throwNeedKey();
  }

  const mimeMatch = imageBase64.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");

  try {
    const ai = createGeminiClient(customApiKey);
    const { response } = await generateContentWithRetry(ai, resolveModel(getStoredModel()), {
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: cleanBase64,
            },
          },
          {
            text: buildAnalyzePrompt(subjectHint),
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: getAnalyzeResponseSchema(),
      },
    });

    return parseJsonResponse(response.text || "{}") as AIAnalysisResult;
  } catch (error: any) {
    if (error?.needKey) throw error;
    throwFormatted(error);
  }
}

export async function analyzeQuestionImage(
  imageBase64: string,
  subjectHint?: string
): Promise<AIAnalysisResult> {
  const customApiKey = getStoredApiKey();
  const selectedModel = getStoredModel();
  const mimeMatch = imageBase64.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";

  try {
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

    if (isBackendUnavailable(response)) {
      return analyzeQuestionImageOnClient(imageBase64, subjectHint);
    }

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw parseServerError(errData, `伺服器回應錯誤 (${response.status})`, response.status);
    }

    const result = await response.json();
    if (!result.success || !result.data) {
      throw new Error("AI 分析回傳格式異常，請再試一次。");
    }

    return result.data as AIAnalysisResult;
  } catch (error: any) {
    if (error?.needKey || error?.isKeyProblem || error?.isTransient) {
      throw error;
    }
    if (error instanceof Error && error.message.includes("AI 分析回傳格式異常")) {
      throw error;
    }
    return analyzeQuestionImageOnClient(imageBase64, subjectHint);
  }
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

async function generateSimilarQuestionOnClient(
  params: GenerateSimilarQuestionParams
): Promise<AISimilarQuestionResult> {
  const customApiKey = getStoredApiKey();
  if (!customApiKey) {
    throwNeedKey("未配置 Gemini API Key。請點擊右上角「自備金鑰 BYOK」設定您的 API Key。");
  }

  try {
    const ai = createGeminiClient(customApiKey);
    const { response } = await generateContentWithRetry(ai, resolveModel(getStoredModel()), {
      contents: buildSimilarPrompt(params),
      config: {
        responseMimeType: "application/json",
        responseSchema: getSimilarResponseSchema(),
      },
    });

    return parseJsonResponse(response.text || "{}") as AISimilarQuestionResult;
  } catch (error: any) {
    if (error?.needKey) throw error;
    throwFormatted(error);
  }
}

export async function generateSimilarQuestion(
  params: GenerateSimilarQuestionParams
): Promise<AISimilarQuestionResult> {
  const customApiKey = getStoredApiKey();
  const selectedModel = getStoredModel();

  try {
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

    if (isBackendUnavailable(response)) {
      return generateSimilarQuestionOnClient(params);
    }

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw parseServerError(errData, `生成相似題失敗 (${response.status})`, response.status);
    }

    const result = await response.json();
    if (!result.success || !result.data) {
      throw new Error("AI 生成格式異常，請重試。");
    }

    return result.data as AISimilarQuestionResult;
  } catch (error: any) {
    if (error?.needKey || error?.isKeyProblem || error?.isTransient) {
      throw error;
    }
    if (error instanceof Error && error.message.includes("AI 生成格式異常")) {
      throw error;
    }
    return generateSimilarQuestionOnClient(params);
  }
}
