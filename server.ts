import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// High payload limit for camera photos in Base64
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true, limit: "30mb" }));

// Check configuration status
app.get("/api/config", (req, res) => {
  res.json({
    hasServerKey: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0),
  });
});

// Verify API Key (BYOK testing endpoint)
app.post("/api/verify-key", async (req, res) => {
  const startTime = Date.now();
  try {
    const { apiKey, model = "gemini-3.8-flash" } = req.body;
    const testKey = (apiKey && typeof apiKey === "string" && apiKey.trim().length > 0)
      ? apiKey.trim()
      : process.env.GEMINI_API_KEY;

    if (!testKey) {
      return res.status(400).json({
        valid: false,
        error: "未提供金鑰以供測試，且伺服器未配置預設金鑰。",
      });
    }

    const validModels = ["gemini-3.8-flash", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite"];
    const targetModel = validModels.includes(model) ? model : "gemini-3.8-flash";

    const ai = new GoogleGenAI({
      apiKey: testKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    // Send a lightweight connectivity ping
    const testResponse = await ai.models.generateContent({
      model: targetModel,
      contents: "Reply with the exact word 'PONG'",
    });

    const latencyMs = Date.now() - startTime;
    const replyText = testResponse.text || "";

    return res.json({
      valid: true,
      model: targetModel,
      latencyMs,
      message: "金鑰連線測試成功！可正常調用 Gemini API。",
      sampleReply: replyText.trim(),
    });
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    const errMsg = error?.message || "金鑰驗證失敗";
    let friendlyMessage = "連線驗證失敗：" + errMsg;

    if (errMsg.includes("API_KEY_INVALID") || errMsg.includes("invalid API key") || errMsg.includes("403")) {
      friendlyMessage = "API Key 無效或尚未啟用 Gemini 服務，請至 Google AI Studio 檢查金鑰。";
    } else if (errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("quota") || errMsg.includes("429")) {
      friendlyMessage = "API 調用頻率已超額或配額已用盡 (429 Quota Exceeded)。";
    }

    return res.status(400).json({
      valid: false,
      latencyMs,
      error: friendlyMessage,
      rawError: errMsg,
    });
  }
});

// AI analysis route for question image
app.post("/api/analyze-question", async (req, res) => {
  try {
    const { imageBase64, mimeType = "image/jpeg", customApiKey, subjectHint, selectedModel } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: "未提供題目圖片數據" });
    }

    const isUsingCustomKey = Boolean(customApiKey && typeof customApiKey === "string" && customApiKey.trim().length > 0);
    const effectiveApiKey = isUsingCustomKey
      ? (customApiKey as string).trim()
      : process.env.GEMINI_API_KEY;

    if (!effectiveApiKey) {
      return res.status(400).json({
        error: "未檢測到有效 Gemini API Key。請在右上角「自備金鑰 (BYOK)」填入您的 API Key，或於伺服器配置 GEMINI_API_KEY。",
        needKey: true,
      });
    }

    const validModels = ["gemini-3.8-flash", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite"];
    const targetModel = validModels.includes(selectedModel) ? selectedModel : "gemini-3.8-flash";

    // Initialize Gemini SDK server-side
    const ai = new GoogleGenAI({
      apiKey: effectiveApiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    // Remove data:image/...;base64, prefix if present
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");

    const promptText = `你是一位精通中學與高中課綱（包含台灣 108 課綱與各版本教科書如翰林、康軒、南一）的資深名師與考題分析專家。
請仔細辨識分析這張圖片中的考題/練習題/筆記。
${subjectHint ? `使用者補充科目線索：${subjectHint}` : ""}

請務必依據題目脈絡與課綱體系，精確推論並辨識：
1. 【科目】：數學、物理、化學、生物、地球科學、國文、英文、歷史、地理、公民 等。
2. 【冊別】：精確指出年級與冊別，例如：「國一上 (第1冊)」、「國二上 (第3冊)」、「國三會考複習」、「高一 (第1冊)」、「高二選修物理(上)」。
3. 【章節】：精確指出所屬章節名稱，例如：「第2章 平方根與畢氏定理」、「第1章 乘法公式與多項式」、「第三章 一元二次方程式」、「第二章 牛頓運動定律」。
4. 【單元】：精確指出所屬小節或主題，例如：「2-1 平方根的意義與估算」、「1-2 多項式的四則運算」、「3-2 配方法與公式解」。

請務必嚴格輸出合法的繁體中文 JSON 格式，不要加入額外 Markdown 外框或解釋：
{
  "科目": "數學/物理/化學/生物/地科/國文/英文/歷史/地理/公民 等",
  "冊別": "例如：國二上 (第3冊) 或 高一 (第1冊) 或 國三會考複習",
  "章節": "例如：第2章 平方根與畢氏定理 或 第3章 一元二次方程式",
  "單元": "例如：2-1 平方根的意義與近似值 或 3-2 公式解",
  "題目文字": "完整、精確辨識出的題目題幹、選項（若有A、B、C、D請分行條列）及條件數據",
  "題型": "單選題/多選題/填空題/計算題/綜合題",
  "答案": "正確標準答案（例如：(C) 或 x = 3 或 80 J）",
  "核心考點": "本題考核的核心公式、定理或觀念定義",
  "易錯陷阱": "學生作答此題最容易犯錯的陷阱、盲點或概念混淆處",
  "詳解步驟": "清晰條理、逐步推導的完整解題詳解",
  "關鍵技巧": "解題關鍵口訣、速解法或審題注意點"
}`;

    const response = await ai.models.generateContent({
      model: targetModel,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType || "image/jpeg",
              data: cleanBase64,
            },
          },
          {
            text: promptText,
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
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
            詳解步驟: { type: Type.STRING, description: "詳細解題流程" },
            關鍵技巧: { type: Type.STRING, description: "答題技巧" },
          },
          required: ["科目", "單元", "題目文字", "詳解步驟"],
        },
      },
    });

    const responseText = response.text || "{}";
    let parsedData;
    try {
      parsedData = JSON.parse(responseText.trim());
    } catch {
      // Fallback clean markdown code blocks
      const cleaned = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
      parsedData = JSON.parse(cleaned);
    }

    return res.json({
      success: true,
      data: parsedData,
      keySource: isUsingCustomKey ? "custom_byok" : "server_default",
      modelUsed: targetModel,
    });
  } catch (error: any) {
    console.error("AI Analysis error:", error);
    const errMsg = error?.message || "AI 辨識過程中發生錯誤";
    const isKeyProblem = errMsg.includes("API_KEY_INVALID") || errMsg.includes("quota") || errMsg.includes("403") || errMsg.includes("429");
    return res.status(500).json({
      error: errMsg,
      isKeyProblem,
    });
  }
});

// AI generate similar practice question endpoint (舉一反三 · 相似題型生成)
app.post("/api/generate-similar-questions", async (req, res) => {
  try {
    const {
      questionText,
      subject,
      gradeLevel,
      chapter,
      unit,
      answer,
      coreConcepts,
      difficulty = "中等",
      variationType = "similar", // "similar" (同觀念情境改編) | "easier" (基礎觀念打底) | "harder" (進階挑戰深化)
      customApiKey,
      selectedModel = "gemini-3.8-flash",
    } = req.body;

    if (!questionText && !coreConcepts) {
      return res.status(400).json({ error: "需提供原始題目內容或核心考點" });
    }

    const isUsingCustomKey = Boolean(
      customApiKey && typeof customApiKey === "string" && customApiKey.trim().length > 0
    );
    const effectiveApiKey = isUsingCustomKey
      ? customApiKey.trim()
      : process.env.GEMINI_API_KEY;

    if (!effectiveApiKey) {
      return res.status(401).json({
        error: "未配置 Gemini API Key。請點擊右上角「自備金鑰 BYOK」設定您的 API Key。",
        needKey: true,
      });
    }

    const validModels = ["gemini-3.8-flash", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite"];
    const targetModel = validModels.includes(selectedModel) ? selectedModel : "gemini-3.8-flash";

    const ai = new GoogleGenAI({
      apiKey: effectiveApiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    const variationPrompt =
      variationType === "easier"
        ? "生成 1 道「基礎鞏固練習題」：適度簡化原始題目的數字計算或簡化情境，強調最核心概念的直觀應用，幫助學生打底基礎。"
        : variationType === "harder"
        ? "生成 1 道「進階挑戰練習題」：在相同核心考點下，增加一道逆向推導步驟或多重條件限制，引導學生挑戰深層解題思維。"
        : "生成 1 道「同觀念高擬真變形題（舉一反三）」：保持與原題完全相同的核心考點與解題步驟架構，但徹底改換情境主角、物理背景或數字數據，確保學生能學以致用。";

    const promptText = `你是一位經驗豐富的高中與國中學科頂尖命題專家與升學指導名師。
請根據以下學生做錯的題目內容，為學生設計出一道原創、高質量的「相似練習題（舉一反三題型）」：

【原始錯題資料】
- 科目：${subject || "未指定"}
- 年級教材冊別：${gradeLevel || "未指定"}
- 章節與單元：${chapter || ""} ${unit || ""}
- 核心考點：${coreConcepts || "請由題目判斷"}
- 原始題目內容：
${questionText || "（無題幹文字，請依據上述考點與科目設計經典考題）"}
- 原始答案參考：${answer || "無"}

【命題原則】
1. ${variationPrompt}
2. 題目文字必須完整明確，如果是選擇題請提供 (A)(B)(C)(D) 選項；如果是計算題或填充題請明確交代求解目標與單位。
3. 使用標準台灣繁體中文，專業學科術語必須符合教育部課綱標準。
4. 務必提供標準答案，並附上邏輯嚴謹、步驟清晰完整的「詳細推導與解題過程」。
5. 請提供「變形重點說明」，用簡短的一兩句話向學生指出這道練習題與原本錯題有什麼異同（例如：「數字由整數改為帶分數，並反轉未知數的位置」）。`;

    const response = await ai.models.generateContent({
      model: targetModel,
      contents: promptText,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            題目文字: { type: Type.STRING, description: "原創新題幹與選項" },
            答案: { type: Type.STRING, description: "本練習題標準答案" },
            核心考點: { type: Type.STRING, description: "對應的核心知識點" },
            變形設計重點: { type: Type.STRING, description: "與原錯題的差異與改編方向說明" },
            詳解步驟: { type: Type.STRING, description: "循序漸進的詳細推導算式或論述" },
            解題技巧提示: { type: Type.STRING, description: "下筆關鍵思維點撥" },
            難度: { type: Type.STRING, description: "基礎、中等 或 挑戰" },
          },
          required: ["題目文字", "答案", "詳解步驟", "變形設計重點"],
        },
      },
    });

    const responseText = response.text || "{}";
    let parsedData;
    try {
      parsedData = JSON.parse(responseText.trim());
    } catch {
      const cleaned = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
      parsedData = JSON.parse(cleaned);
    }

    return res.json({
      success: true,
      data: parsedData,
      modelUsed: targetModel,
    });
  } catch (error: any) {
    console.error("Generate similar question error:", error);
    const errMsg = error?.message || "生成相似題型時發生錯誤";
    return res.status(500).json({
      error: errMsg,
    });
  }
});

// Vite middleware for dev / static for prod
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
