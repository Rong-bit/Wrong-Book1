import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
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
} from "./src/services/geminiCore";

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
    const { apiKey, model = "gemini-3.1-flash-lite" } = req.body;
    const testKey = (apiKey && typeof apiKey === "string" && apiKey.trim().length > 0)
      ? apiKey.trim()
      : process.env.GEMINI_API_KEY;

    if (!testKey) {
      return res.status(400).json({
        valid: false,
        error: "未提供金鑰以供測試，且伺服器未配置預設金鑰。",
      });
    }

    const targetModel = resolveModel(model);
    const ai = createGeminiClient(testKey);

    const { response: testResponse, modelUsed } = await generateContentWithRetry(ai, targetModel, {
      contents: "Reply with the exact word 'PONG'",
    });

    const latencyMs = Date.now() - startTime;
    const replyText = testResponse.text || "";

    return res.json({
      valid: true,
      model: modelUsed,
      latencyMs,
      message: "金鑰連線測試成功！可正常調用 Gemini API。",
      sampleReply: replyText.trim(),
    });
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    const { message: friendlyMessage } = formatErrorMessage(error);

    return res.status(400).json({
      valid: false,
      latencyMs,
      error: friendlyMessage,
      rawError: error?.message,
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

    const targetModel = resolveModel(selectedModel);
    const ai = createGeminiClient(effectiveApiKey);
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");

    const { response, modelUsed, attempts, fallbackUsed } = await generateContentWithRetry(
      ai,
      targetModel,
      {
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: mimeType || "image/jpeg",
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
      }
    );

    const parsedData = parseJsonResponse(response.text || "{}");

    return res.json({
      success: true,
      data: parsedData,
      keySource: isUsingCustomKey ? "custom_byok" : "server_default",
      modelUsed,
      attempts,
      fallbackUsed,
    });
  } catch (error: any) {
    console.error("AI Analysis error:", error);
    const { message: friendlyMessage, isKeyProblem, isTransient } = formatErrorMessage(error);
    return res.status(isTransient ? 503 : 500).json({
      error: friendlyMessage,
      isKeyProblem,
      isTransient,
      rawError: error?.message,
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
      variationType = "similar",
      customApiKey,
      selectedModel = "gemini-3.1-flash-lite",
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

    const targetModel = resolveModel(selectedModel);
    const ai = createGeminiClient(effectiveApiKey);

    const { response, modelUsed, attempts, fallbackUsed } = await generateContentWithRetry(
      ai,
      targetModel,
      {
        contents: buildSimilarPrompt({
          questionText,
          subject,
          gradeLevel,
          chapter,
          unit,
          answer,
          coreConcepts,
          variationType,
        }),
        config: {
          responseMimeType: "application/json",
          responseSchema: getSimilarResponseSchema(),
        },
      }
    );

    const parsedData = parseJsonResponse(response.text || "{}");

    return res.json({
      success: true,
      data: parsedData,
      modelUsed,
      attempts,
      fallbackUsed,
    });
  } catch (error: any) {
    console.error("Generate similar question error:", error);
    const { message: friendlyMessage, isKeyProblem, isTransient } = formatErrorMessage(error);
    return res.status(isTransient ? 503 : 500).json({
      error: friendlyMessage,
      isKeyProblem,
      isTransient,
      rawError: error?.message,
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
