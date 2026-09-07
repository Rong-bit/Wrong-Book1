import React, { useState, useEffect } from "react";
import {
  Key,
  CheckCircle,
  X,
  ShieldCheck,
  ExternalLink,
  Trash2,
  Eye,
  EyeOff,
  Cpu,
  Zap,
  Loader2,
  AlertTriangle,
  ClipboardPaste,
  HelpCircle,
  Info,
} from "lucide-react";
import {
  getStoredApiKey,
  saveStoredApiKey,
  getStoredModel,
  saveStoredModel,
  checkServerConfig,
  verifyApiKey,
  AVAILABLE_MODELS,
  KeyVerificationResponse,
} from "../services/aiService";

interface ByokModalProps {
  isOpen: boolean;
  onClose: () => void;
  onKeyUpdated: () => void;
}

export const ByokModal: React.FC<ByokModalProps> = ({
  isOpen,
  onClose,
  onKeyUpdated,
}) => {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [selectedModel, setSelectedModel] = useState("gemini-3.1-flash-lite");
  const [hasServerKey, setHasServerKey] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [testResult, setTestResult] = useState<KeyVerificationResponse | null>(null);
  const [activeTab, setActiveTab] = useState<"settings" | "guide">("settings");

  useEffect(() => {
    if (isOpen) {
      setApiKey(getStoredApiKey());
      setSelectedModel(getStoredModel());
      checkServerConfig().then((res) => setHasServerKey(res.hasServerKey));
      setSavedSuccess(false);
      setTestResult(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleVerify = async () => {
    setIsVerifying(true);
    setTestResult(null);
    try {
      const res = await verifyApiKey(apiKey, selectedModel);
      setTestResult(res);
    } catch (err: any) {
      setTestResult({
        valid: false,
        message: err?.message || "測試失敗",
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setApiKey(text.trim());
      }
    } catch (e) {
      console.warn("Clipboard access denied or unavailable", e);
    }
  };

  const handleSave = () => {
    saveStoredApiKey(apiKey);
    saveStoredModel(selectedModel);
    setSavedSuccess(true);
    onKeyUpdated();
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 800);
  };

  const handleClear = () => {
    setApiKey("");
    saveStoredApiKey("");
    setTestResult(null);
    onKeyUpdated();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200 relative flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-200 shadow-2xs">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">
                  BYOK (Bring Your Own Key) 自備金鑰
                </h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                  Gemini API
                </span>
              </div>
              <p className="text-xs text-slate-500">
                本機安全加密儲存 · 支援自訂模型與即時連線測試
              </p>
            </div>
          </div>
          <button
            id="close-byok-modal-btn"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60 transition"
            title="關閉"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switcher: Settings vs Guide */}
        <div className="px-6 pt-3 border-b border-slate-100 flex gap-4 text-xs font-semibold text-slate-500 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab("settings")}
            className={`pb-2.5 transition border-b-2 ${
              activeTab === "settings"
                ? "text-sky-600 border-sky-600"
                : "border-transparent hover:text-slate-800"
            }`}
          >
            金鑰與模型配置
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("guide")}
            className={`pb-2.5 transition border-b-2 flex items-center gap-1 ${
              activeTab === "guide"
                ? "text-sky-600 border-sky-600"
                : "border-transparent hover:text-slate-800"
            }`}
          >
            <HelpCircle className="w-3.5 h-3.5" />
            如何免費獲取 Key
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto space-y-4 text-xs">
          {activeTab === "guide" ? (
            <div className="space-y-3.5 leading-relaxed text-slate-600">
              <div className="p-3 bg-sky-50 rounded-xl border border-sky-200 text-sky-900">
                <p className="font-semibold mb-1 flex items-center gap-1.5 text-sky-800">
                  <Info className="w-4 h-4" /> 什麼是 BYOK (Bring Your Own Key)？
                </p>
                <p className="text-[11px] text-sky-800/90 leading-normal">
                  BYOK 允許您直接使用自己向 Google 申請的免費 Gemini API Key。您的金鑰享有獨立的個人請求配額（通常每分鐘可達 15 次免費請求），且不受公用伺服器並行使用限制。
                </p>
              </div>

              <h4 className="font-bold text-slate-800 text-sm pt-1">
                三步驟免費獲取個人金鑰：
              </h4>
              <ol className="space-y-2.5 list-decimal pl-5 text-slate-700">
                <li>
                  前往{" "}
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-600 font-bold hover:underline inline-flex items-center gap-1"
                  >
                    Google AI Studio (aistudio.google.com)
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  ，使用您的 Google 帳號免費登入。
                </li>
                <li>
                  點擊頁面上的{" "}
                  <strong className="text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                    Get API key
                  </strong>{" "}
                  或「Create API key」，並選取或新建一個專案。
                </li>
                <li>
                  複製開頭為{" "}
                  <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono text-slate-800">
                    AIzaSy...
                  </code>{" "}
                  的一串密鑰文字，回到本系統貼上即可使用！
                </li>
              </ol>

              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-900 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-normal">
                  <strong className="block text-emerald-800">隱私與安全保證：</strong>
                  您的 API Key 儲存在瀏覽器的安全 LocalStorage 中，每次分析請求透過 HTTPS 進行直連傳遞，絕不會儲存在任何第三方伺服器資料庫。
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setActiveTab("settings")}
                  className="px-4 py-2 bg-slate-900 text-white font-semibold rounded-xl hover:bg-slate-800 transition"
                >
                  返回金鑰輸入
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Server Key Banner */}
              {hasServerKey ? (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-2.5 text-xs text-emerald-800">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">伺服器預設金鑰正常運作中：</span>
                    {apiKey ? (
                      <span>已啟用自備金鑰（系統將優先採用您指定的個人 API Key）。</span>
                    ) : (
                      <span>尚未設定自備金鑰，系統目前自動使用後端預設服務金鑰。</span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2.5 text-xs text-amber-800">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">尚未配置伺服器預設金鑰：</span>
                    請務必在此填入個人的 Gemini API Key，即可啟用題目自動辨識與考卷生成功能。
                  </div>
                </div>
              )}

              {/* API Key Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-bold text-slate-800 flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-slate-600" />
                    自備 Google Gemini API Key
                  </label>
                  <button
                    type="button"
                    onClick={handlePasteClipboard}
                    className="text-[11px] text-sky-600 hover:text-sky-700 hover:underline flex items-center gap-1 font-medium"
                  >
                    <ClipboardPaste className="w-3 h-3" />
                    從剪貼簿貼上
                  </button>
                </div>

                <div className="relative">
                  <input
                    id="byok-api-key-input"
                    type={showKey ? "text" : "password"}
                    placeholder="貼上 AIzaSy 開頭的 Gemini API 金鑰..."
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setTestResult(null);
                    }}
                    className="w-full pl-3.5 pr-20 py-2.5 text-xs font-mono rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-sky-500 focus:border-sky-500 bg-slate-50 focus:bg-white transition"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/50 transition"
                      title={showKey ? "隱藏金鑰" : "顯示金鑰"}
                    >
                      {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    {apiKey && (
                      <button
                        type="button"
                        onClick={() => {
                          setApiKey("");
                          setTestResult(null);
                        }}
                        className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition"
                        title="清空文字"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Model Choice Selection */}
              <div>
                <label className="block font-bold text-slate-800 mb-1.5 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-slate-600" />
                  偏好 Gemini 模型 (Model)
                </label>
                <div className="space-y-1.5">
                  {AVAILABLE_MODELS.map((m) => {
                    const isSelected = selectedModel === m.id;
                    return (
                      <div
                        key={m.id}
                        onClick={() => setSelectedModel(m.id)}
                        className={`p-2.5 rounded-xl border cursor-pointer transition flex items-start justify-between gap-3 ${
                          isSelected
                            ? "bg-sky-50/80 border-sky-400 ring-1 ring-sky-300"
                            : "bg-slate-50/60 border-slate-200 hover:bg-slate-100/60"
                        }`}
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="gemini-model"
                              checked={isSelected}
                              onChange={() => setSelectedModel(m.id)}
                              className="text-sky-600 focus:ring-sky-500 w-3.5 h-3.5"
                            />
                            <span className="font-bold text-slate-900">{m.name}</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-200 text-slate-700 font-semibold">
                              {m.badge}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 pl-5.5">{m.description}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Verify / Test Button & Result */}
              <div className="pt-1">
                <div className="flex items-center justify-between">
                  <button
                    id="verify-key-btn"
                    type="button"
                    disabled={isVerifying || (!apiKey && !hasServerKey)}
                    onClick={handleVerify}
                    className="px-3 py-1.5 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-300 rounded-xl transition flex items-center gap-1.5 disabled:opacity-50 shadow-2xs"
                  >
                    {isVerifying ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        測試連線中...
                      </>
                    ) : (
                      <>
                        <Zap className="w-3.5 h-3.5 text-sky-600" />
                        測試此金鑰與模型連線
                      </>
                    )}
                  </button>

                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-slate-500 hover:text-sky-600 hover:underline font-medium text-[11px]"
                  >
                    獲取免費 Key
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                {/* Test Feedback banner */}
                {testResult && (
                  <div
                    className={`mt-2.5 p-2.5 rounded-xl border text-xs flex items-start gap-2 ${
                      testResult.valid
                        ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                        : "bg-rose-50 border-rose-300 text-rose-800"
                    }`}
                  >
                    {testResult.valid ? (
                      <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1">
                      <div className="font-bold">
                        {testResult.valid ? "連線測試成功！" : "連線測試未通過"}
                      </div>
                      <div className="text-[11px] mt-0.5 opacity-90">{testResult.message}</div>
                      {testResult.latencyMs && (
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          響應延遲：{testResult.latencyMs} ms · 模型：{testResult.model}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <div>
            {apiKey && (
              <button
                type="button"
                onClick={handleClear}
                className="text-xs text-rose-600 hover:text-rose-700 hover:underline flex items-center gap-1 font-semibold"
              >
                <Trash2 className="w-3.5 h-3.5" /> 清除自備金鑰
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-xl transition"
            >
              取消
            </button>
            <button
              id="save-byok-key-btn"
              type="button"
              onClick={handleSave}
              className="px-4 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 active:scale-95 rounded-xl shadow-xs transition flex items-center gap-1.5"
            >
              {savedSuccess ? (
                <>
                  <CheckCircle className="w-4 h-4 text-white" /> 已儲存配置
                </>
              ) : (
                "儲存並套用"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
