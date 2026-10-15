import { GoogleGenAI, Type } from "@google/genai";

export const VALID_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.1-pro-preview",
] as const;

/** Models that can return edited images (text+image → image). */
export const IMAGE_EDIT_MODELS = [
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image",
  "gemini-nano-banana-2.1",
  "gemini-3.1-flash-lite-image",
] as const;

export function resolveModel(model?: string): string {
  return VALID_MODELS.includes(model as (typeof VALID_MODELS)[number])
    ? (model as string)
    : "gemini-3.1-flash-lite";
}

export function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

export function isTransientError(error: any): boolean {
  const msg = (error?.message || "").toLowerCase();
  const status = String(error?.status || "");
  const code = String(error?.code || "");
  return (
    status === "UNAVAILABLE" ||
    code === "503" ||
    msg.includes("503") ||
    msg.includes("high demand") ||
    msg.includes("temporarily unavailable") ||
    msg.includes("spikes in demand") ||
    msg.includes("overloaded") ||
    msg.includes("resource_exhausted") ||
    msg.includes("rate limit") ||
    code === "429"
  );
}

export function getFallbackModel(currentModel: string): string {
  if (currentModel === "gemini-3.8-flash") {
    return "gemini-3.1-flash-lite";
  }
  if (currentModel === "gemini-3.1-flash-lite") {
    return "gemini-3.8-flash";
  }
  if (currentModel === "gemini-3.1-pro-preview") {
    return "gemini-3.1-flash-lite";
  }
  return "gemini-3.1-flash-lite";
}

export function getImageEditFallbackModel(currentModel: string): string {
  const idx = IMAGE_EDIT_MODELS.indexOf(
    currentModel as (typeof IMAGE_EDIT_MODELS)[number]
  );
  if (idx >= 0 && idx < IMAGE_EDIT_MODELS.length - 1) {
    return IMAGE_EDIT_MODELS[idx + 1];
  }
  if (idx === IMAGE_EDIT_MODELS.length - 1) {
    return IMAGE_EDIT_MODELS[0];
  }
  return IMAGE_EDIT_MODELS[0];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface GenerateResult {
  response: any;
  modelUsed: string;
  attempts: number;
  fallbackUsed: boolean;
}

export async function generateContentWithRetry(
  ai: GoogleGenAI,
  initialModel: string,
  params: {
    contents: any;
    config?: any;
  }
): Promise<GenerateResult> {
  let modelToUse = initialModel;
  let attempts = 0;
  const maxAttempts = 3;
  let fallbackUsed = false;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const response = await ai.models.generateContent({
        model: modelToUse,
        contents: params.contents,
        config: params.config,
      });
      return { response, modelUsed: modelToUse, attempts, fallbackUsed };
    } catch (error: any) {
      const isTransient = isTransientError(error);

      if (isTransient && attempts < maxAttempts) {
        const fallback = getFallbackModel(modelToUse);
        if (fallback !== modelToUse) {
          console.log(
            `[Gemini API] Switching from ${modelToUse} to fallback model ${fallback} due to demand spike`
          );
          modelToUse = fallback;
          fallbackUsed = true;
          await sleep(500);
          continue;
        } else {
          await sleep(1000);
          continue;
        }
      }

      console.warn(
        `[Gemini API] Attempt ${attempts}/${maxAttempts} failed on model ${modelToUse}:`,
        error?.message || error
      );
      throw error;
    }
  }

  throw new Error("無法取得 AI 回應，請稍候重試。");
}

/**
 * Image-edit generateContent with fallback across IMAGE_EDIT_MODELS only.
 * Does not fall back to text-only models.
 */
export async function generateImageContentWithRetry(
  ai: GoogleGenAI,
  initialModel: string,
  params: {
    contents: any;
    config?: any;
  }
): Promise<GenerateResult> {
  let modelToUse = IMAGE_EDIT_MODELS.includes(
    initialModel as (typeof IMAGE_EDIT_MODELS)[number]
  )
    ? initialModel
    : IMAGE_EDIT_MODELS[0];
  let attempts = 0;
  const maxAttempts = 4;
  let fallbackUsed = false;
  const tried = new Set<string>();

  while (attempts < maxAttempts) {
    attempts++;
    tried.add(modelToUse);
    try {
      const response = await ai.models.generateContent({
        model: modelToUse,
        contents: params.contents,
        config: params.config,
      });
      return { response, modelUsed: modelToUse, attempts, fallbackUsed };
    } catch (error: any) {
      const msg = (error?.message || "").toLowerCase();
      const notFound =
        msg.includes("not found") ||
        msg.includes("is not supported") ||
        msg.includes("unknown model") ||
        String(error?.status || "") === "404";
      const isTransient = isTransientError(error);

      if ((isTransient || notFound) && attempts < maxAttempts) {
        let next = getImageEditFallbackModel(modelToUse);
        // Prefer an untried model
        for (let i = 0; i < IMAGE_EDIT_MODELS.length; i++) {
          if (!tried.has(IMAGE_EDIT_MODELS[i])) {
            next = IMAGE_EDIT_MODELS[i];
            break;
          }
        }
        if (next !== modelToUse) {
          console.log(
            `[Gemini Image] Switching from ${modelToUse} to ${next}`
          );
          modelToUse = next;
          fallbackUsed = true;
          await sleep(notFound ? 200 : 600);
          continue;
        }
        await sleep(800);
        continue;
      }

      console.warn(
        `[Gemini Image] Attempt ${attempts}/${maxAttempts} failed on ${modelToUse}:`,
        error?.message || error
      );
      throw error;
    }
  }

  throw new Error("無法取得 AI 去手寫結果，請稍候重試。");
}

/** Pull the first inline image from a generateContent response as a data URL. */
export function extractInlineImageDataUrl(response: any): string | null {
  const parts =
    response?.candidates?.[0]?.content?.parts ||
    response?.parts ||
    [];
  for (const part of parts) {
    const inline = part?.inlineData || part?.inline_data;
    const data = inline?.data;
    if (!data) continue;
    const mime =
      inline?.mimeType || inline?.mime_type || "image/png";
    return `data:${mime};base64,${data}`;
  }
  return null;
}

export function buildRemoveHandwritingPrompt(): string {
  return `你是考卷影像修復專家。請編輯這張考卷／習作照片。

【首要任務＝徹底去掉手寫與貼圖】
必須清除所有學生／老師筆跡與非印刷疊加物，不可殘留：
- 藍筆／紅筆／黑筆／鉛筆的圈選、打叉、劃線、註記、分數
- 空白處手寫字母、數字（如 A、C、D）與塗鴉
- 選項旁或題號旁的手畫圓圈
- 社群／截圖上的紅色「圖」「圖一」方塊貼圖、數位浮水印與非印刷標籤

【作法＝局部清除，禁止整頁重畫】
- 只把手寫／陰影處用紙色填補；不要重繪印刷字、線條或整頁版面
- 可順便減輕摺痕與不均勻陰影，但不可因此洗掉或改寫印刷內容
- 構圖、比例、對齊必須與原圖一致（禁止平移、旋轉、裁切造成錯位）

【同時保留＝原圖已有的印刷內容】
- 印刷題幹、選項、題號
- 原圖已有的印刷圖（電路圖、接線圖、地圖、圖表、插圖）及其印刷標註—不要當成手寫刪掉
- 若原圖沒有圖形或標註，絕對不要自行「補上」

【嚴禁幻覺】
- 禁止新增原圖沒有的線條、元件、文字、符號、圖案、答案或浮水印
- 禁止把印刷字改寫成其他字，也禁止發明電路圖或技術符號

【輸出】
- 手寫處用紙色自然補上；印刷內容保持原樣清晰
- 只輸出一張清晰編輯後照片`;
}

export function formatErrorMessage(error: any): {
  message: string;
  isKeyProblem: boolean;
  isTransient: boolean;
} {
  const errMsg = error?.message || "AI 服務暫時無法回應";
  const isKeyProblem =
    errMsg.includes("API_KEY_INVALID") ||
    errMsg.includes("invalid API key") ||
    errMsg.includes("403") ||
    errMsg.includes("PERMISSION_DENIED");
  const isTransient = isTransientError(error);

  let friendlyMessage = errMsg;
  if (isTransient) {
    friendlyMessage =
      "Google AI 雲端模型目前正處於瞬間全球流量尖峰 (503 / High Demand)，系統已嘗試自動重試。請稍候 5~10 秒後再次點擊即可！";
  } else if (isKeyProblem) {
    friendlyMessage =
      "Gemini API 金鑰無效或尚未開通 (403/API_KEY_INVALID)，請檢查右上角「自備金鑰 BYOK」設定。";
  }

  return { message: friendlyMessage, isKeyProblem, isTransient };
}

export function parseJsonResponse(responseText: string): any {
  const raw = responseText || "{}";
  try {
    return JSON.parse(raw.trim());
  } catch {
    const cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned);
  }
}

export function buildAnalyzePrompt(subjectHint?: string, existingLabelsText?: string): string {
  return `你是一位精通中學與高中課綱（包含台灣 108 課綱與各版本教科書如翰林、康軒、南一）的資深名師與考題分析專家。
請仔細辨識分析這張圖片中的考題/練習題/筆記。
${subjectHint ? `使用者補充科目線索：${subjectHint}` : ""}

請務必依據題目脈絡與課綱體系，精確推論並辨識：
1. 【科目】：必須依題目內容判定（數學、物理、化學、生物、地球科學、國文、英文、歷史、地理、公民 等）。地理題不可標成數學，物理題不可標成化學。若使用者有提供科目線索且與題目相符，請優先採用。
2. 【冊別】：精確指出年級與冊別，例如：「國一上 (第1冊)」、「國二上 (第3冊)」、「國三會考複習」、「高一 (第1冊)」、「高二選修物理(上)」。
3. 【章節】：必須使用「該科目」教科書的章名，例如數學「第1章 整數的運算」、地理「第1章 地圖」、物理「第2章 牛頓運動定律」。禁止把其他科目的章名套到本題。
4. 【單元】：必須使用「該科目」的小節名，例如數學「1-2 整數的加減運算」、地理「1-1 地圖的要素」。
5. 【分類必須一致（僅限同科目）】翰林、康軒、南一的章名與 1-1 小節名常不同。本錯題本在「同一科目＋同一冊＋同一章號」只能用一種章名，「同一科目＋同一章號／小節號」只能用一種單元名，禁止自創近義變體。例如數學國一上不可同時出現「第1章 數與數線」與「第1章 基本數系與數線」。若下方已有標籤，本題僅可沿用「相同科目」且「相同冊別」下既有的章名／單元名；絕對不可跨科目套用（例如已有數學「第1章 整數的運算」時，地理題仍須使用地理章名，不可改成整數的運算）。
${existingLabelsText ? `本錯題本既有標籤（格式：科目 / 冊別 / 章節 / 單元）：\n${existingLabelsText}` : "本錯題本尚無既有標籤。若本題為國中數學國一上第1章且無既有數學標籤，預設使用「第1章 數與數線」；其他科目請依該科課綱命名，勿套用數學預設。"}
6. 【數學與科學公式規範】：
   - 若題目題幹、選項或推導步驟包含數學式、物理符號或方程式，請一律使用標準 LaTeX 格式並以 $...$（行內公式）或 $$...$$（獨立置中公式）包裹（例如 $x^2 - 4x + 3 = 0$、$\\frac{a}{b}$、$\\sqrt{x}$、$\\Delta = b^2 - 4ac$、$\\pm$ 等）。
   - 帶分數請明確寫為標準 LaTeX，例如 $-7\\frac{6}{9}$、$\\frac{5}{9}$，並務必以 $...$ 包裹。
   - 若有選項，請標準格式排列，例如：(A) $-7\\frac{6}{9}$ (B) $-7\\frac{5}{9}$ (C) $-7\\frac{4}{9}$ (D) $-7\\frac{3}{9}$。
   - JSON 字串中所有反斜線請務必合法雙重轉義（例如 \\\\frac{a}{b}），切勿寫成裸露未轉義反斜線。

請務必嚴格輸出合法的繁體中文 JSON 格式，不要加入額外 Markdown 外框或解釋：
{
  "科目": "數學/物理/化學/生物/地科/國文/英文/歷史/地理/公民 等",
  "冊別": "例如：國二上 (第3冊) 或 高一 (第1冊) 或 國三會考複習",
  "章節": "例如：第2章 平方根與畢氏定理 或 第3章 一元二次方程式",
  "單元": "例如：2-1 平方根的意義與近似值 或 3-2 公式解",
  "題目文字": "完整、精確辨識出的題目題幹、選項（若有A、B、C、D請分行條列並以 $...$ 包裹分數式）及條件數據",
  "題型": "單選題/多選題/填空題/計算題/綜合題",
  "答案": "正確標準答案（例如：(C) 或 x = 3 或 80 J）",
  "核心考點": "本題考核的核心公式、定理或觀念定義",
  "易錯陷阱": "學生作答此題最容易犯錯的陷阱、盲點或概念混淆處",
  "詳解步驟": "清晰條理、逐步推導的完整解題詳解（每個步驟必須換行，禁止「1、……。2、……」黏在同一行）",
  "關鍵技巧": "解題關鍵口訣、速解法或審題注意點"
}

【詳解步驟格式】
- 使用 1、2、3、（或 1. 2. 3.）條列，每一步結束後必須換行，下一步從新行開始。
- 禁止把「2、」緊接在「1、」那段的句尾同一行。`;
}

export function getAnalyzeResponseSchema() {
  return {
    type: Type.OBJECT,
    properties: {
      科目: { type: Type.STRING, description: "學科科目，如數學、物理、化學等" },
      冊別: { type: Type.STRING, description: "年級與教材冊別，例如：國二上 (第3冊) 或 高一 (第1冊)" },
      章節: { type: Type.STRING, description: "章節名稱，例如：第2章 平方根與畢氏定理" },
      單元: { type: Type.STRING, description: "對應小節或單元名稱，例如：2-1 平方根" },
      題目文字: { type: Type.STRING, description: "辨識出的完整題幹與選項文字" },
      題型: { type: Type.STRING, description: "題型種類" },
      答案: { type: Type.STRING, description: "本題標準答案" },
      核心考點: { type: Type.STRING, description: "關鍵知識點" },
      易錯陷阱: { type: Type.STRING, description: "學生常錯痛點" },
      詳解步驟: {
        type: Type.STRING,
        description:
          "詳細解題流程；以 1、2、3、分步，每步結束必須換行，不可把下一步黏在同一行",
      },
      關鍵技巧: { type: Type.STRING, description: "答題技巧" },
    },
    required: ["科目", "單元", "題目文字", "詳解步驟"],
  };
}

export interface SimilarPromptParams {
  questionText?: string;
  subject?: string;
  gradeLevel?: string;
  chapter?: string;
  unit?: string;
  answer?: string;
  coreConcepts?: string;
  variationType?: "similar" | "easier" | "harder";
}

export function buildSimilarPrompt(params: SimilarPromptParams): string {
  const variationPrompt =
    params.variationType === "easier"
      ? "生成 1 道「基礎鞏固練習題」：適度簡化原始題目的數字計算或簡化情境，強調最核心概念的直觀應用，幫助學生打底基礎。"
      : params.variationType === "harder"
      ? "生成 1 道「進階挑戰練習題」：在相同核心考點下，增加一道逆向推導步驟或多重條件限制，引導學生挑戰深層解題思維。"
      : "生成 1 道「同觀念高擬真變形題（舉一反三）」：保持與原題完全相同的核心考點與解題步驟架構，但徹底改換情境主角、物理背景或數字數據，確保學生能學以致用。";

  return `你是一位經驗豐富的高中與國中學科頂尖命題專家與升學指導名師。
請根據以下學生做錯的題目內容，為學生設計出一道原創、高質量的「相似練習題（舉一反三題型）」：

【原始錯題資料】
- 科目：${params.subject || "未指定"}
- 年級教材冊別：${params.gradeLevel || "未指定"}
- 章節與單元：${params.chapter || ""} ${params.unit || ""}
- 核心考點：${params.coreConcepts || "請由題目判斷"}
- 原始題目內容：
${params.questionText || "（無題幹文字，請依據上述考點與科目設計經典考題）"}
- 原始答案參考：${params.answer || "無"}

【命題原則】
1. ${variationPrompt}
2. 題目文字必須完整明確，如果是選擇題請提供 (A)(B)(C)(D) 選項；如果是計算題或填充題請明確交代求解目標與單位。
3. 使用標準台灣繁體中文，專業學科術語必須符合教育部課綱標準。
4. 務必提供標準答案，並附上邏輯嚴謹、步驟清晰完整的「詳細推導與解題過程」。
5. 詳解步驟以 1、2、3、條列，每一步結束後必須換行；禁止「1、……。2、……」黏在同一行。
6. 若題目或詳解包含數學式或方程式，請一律使用標準 LaTeX 格式並以 $...$ 或 $$...$$ 包裹。
7. 請提供「變形重點說明」，用簡短的一兩句話向學生指出這道練習題與原本錯題有什麼異同（例如：「數字由整數改為帶分數，並反轉未知數的位置」）。`;
}

export function getSimilarResponseSchema() {
  return {
    type: Type.OBJECT,
    properties: {
      題目文字: { type: Type.STRING, description: "原創新題幹與選項" },
      答案: { type: Type.STRING, description: "本練習題標準答案" },
      核心考點: { type: Type.STRING, description: "對應的核心知識點" },
      變形設計重點: { type: Type.STRING, description: "與原錯題的差異與改編方向說明" },
      詳解步驟: {
        type: Type.STRING,
        description:
          "循序漸進的詳細推導；1、2、3、分步且每步換行，不可黏在同一行",
      },
      解題技巧提示: { type: Type.STRING, description: "下筆關鍵思維點撥" },
      難度: { type: Type.STRING, description: "基礎、中等 或 挑戰" },
    },
    required: ["題目文字", "答案", "詳解步驟", "變形設計重點"],
  };
}

export interface RewriteExplanationParams {
  questionText: string;
  answer: string;
  subject?: string;
  gradeLevel?: string;
  chapter?: string;
  unit?: string;
  previousExplanation?: string;
}

export function buildRewriteExplanationPrompt(params: RewriteExplanationParams): string {
  return `你是一位精通中學與高中課綱的資深名師。學生已手動訂正「標準答案」，請依題幹與該指定答案，重寫一份能推導到該答案的完整詳解。

【題目資料】
- 科目：${params.subject || "未指定"}
- 年級教材冊別：${params.gradeLevel || "未指定"}
- 章節與單元：${params.chapter || ""} ${params.unit || ""}
- 題目文字：
${params.questionText || "（無題幹）"}
- 【使用者指定的正確答案】（必須視為 ground truth，禁止改寫或否定）：
${params.answer}
${params.previousExplanation ? `- 先前詳解（僅供參考，請依指定答案重寫，勿原樣照抄）：\n${params.previousExplanation}` : ""}

【寫作原則】
1. 詳解步驟必須邏輯嚴謹、逐步推導，最終結論必須與「使用者指定的正確答案」一致。
2. 絕對不可自行更改、質疑或替換使用者指定的答案；輸出中不要另給不同答案。
3. 若題幹與指定答案明顯矛盾，仍依指定答案撰寫推導，並在詳解開頭用一句話簡短標註「題幹與指定答案可能不一致，以下依指定答案說明」。
4. 數學式與科學符號一律使用標準 LaTeX，以 $...$ 或 $$...$$ 包裹；JSON 字串中反斜線需合法雙重轉義。
5. 使用台灣繁體中文。
6. 詳解步驟以 1、2、3、條列，每一步結束後必須換行；禁止「1、……。2、……」黏在同一行。

請嚴格輸出合法 JSON（不要 Markdown 外框）：
{
  "詳解步驟": "能推導至指定答案的完整逐步詳解（每步換行）",
  "核心考點": "本題核心公式、定理或觀念",
  "易錯陷阱": "學生最容易犯錯的盲點",
  "關鍵技巧": "解題關鍵口訣或審題注意點"
}`;
}

export function getRewriteExplanationResponseSchema() {
  return {
    type: Type.OBJECT,
    properties: {
      詳解步驟: {
        type: Type.STRING,
        description:
          "依指定答案重寫的詳細解題流程；1、2、3、分步且每步換行",
      },
      核心考點: { type: Type.STRING, description: "關鍵知識點" },
      易錯陷阱: { type: Type.STRING, description: "學生常錯痛點" },
      關鍵技巧: { type: Type.STRING, description: "答題技巧" },
    },
    required: ["詳解步驟"],
  };
}
