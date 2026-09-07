import React, { useState } from "react";
import {
  Calculator,
  ChevronDown,
  ChevronUp,
  Sparkles,
  BookOpen,
} from "lucide-react";
import { MathRenderer } from "./MathRenderer";

interface MathSymbolItem {
  label: string;
  latex: string;
  displayLatex?: string; // used for preview button
  tooltip: string;
}

interface MathToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (newValue: string) => void;
  className?: string;
}

const COMMON_SYMBOLS: MathSymbolItem[] = [
  { label: "分數", latex: "\\frac{a}{b}", displayLatex: "\\frac{a}{b}", tooltip: "分數 \\frac{a}{b}" },
  { label: "根號", latex: "\\sqrt{x}", displayLatex: "\\sqrt{x}", tooltip: "開根號 \\sqrt{x}" },
  { label: "n 次方根", latex: "\\sqrt[n]{x}", displayLatex: "\\sqrt[3]{x}", tooltip: "n 次方根 \\sqrt[n]{x}" },
  { label: "次方/指數", latex: "x^{2}", displayLatex: "x^2", tooltip: "上標/次方 x^{2}" },
  { label: "下標", latex: "a_{n}", displayLatex: "a_n", tooltip: "下標 a_{n}" },
  { label: "乘號", latex: "\\times", displayLatex: "\\times", tooltip: "乘號 \\times" },
  { label: "除號", latex: "\\div", displayLatex: "\\div", tooltip: "除號 \\div" },
  { label: "正負號", latex: "\\pm", displayLatex: "\\pm", tooltip: "正負號 \\pm" },
  { label: "圓周率", latex: "\\pi", displayLatex: "\\pi", tooltip: "圓周率 \\pi" },
  { label: "度數", latex: "^{\\circ}", displayLatex: "30^\\circ", tooltip: "度數 ^{\\circ}" },
  { label: "角度", latex: "\\angle A", displayLatex: "\\angle A", tooltip: "角 \\angle A" },
  { label: "三角形", latex: "\\triangle ABC", displayLatex: "\\triangle", tooltip: "三角形 \\triangle" },
];

const RELATIONS_SYMBOLS: MathSymbolItem[] = [
  { label: "小於等於", latex: "\\le", displayLatex: "\\le", tooltip: "小於等於 \\le" },
  { label: "大於等於", latex: "\\ge", displayLatex: "\\ge", tooltip: "大於等於 \\ge" },
  { label: "不等於", latex: "\\ne", displayLatex: "\\ne", tooltip: "不等於 \\ne" },
  { label: "約等於", latex: "\\approx", displayLatex: "\\approx", tooltip: "約等於 \\approx" },
  { label: "平行", latex: "\\parallel", displayLatex: "\\parallel", tooltip: "平行 \\parallel" },
  { label: "垂直", latex: "\\perp", displayLatex: "\\perp", tooltip: "垂直 \\perp" },
  { label: "相似", latex: "\\sim", displayLatex: "\\sim", tooltip: "相似 \\sim" },
  { label: "全等", latex: "\\cong", displayLatex: "\\cong", tooltip: "全等 \\cong" },
  { label: "包含於", latex: "\\in", displayLatex: "\\in", tooltip: "屬於 \\in" },
  { label: "子集", latex: "\\subset", displayLatex: "\\subset", tooltip: "子集 \\subset" },
];

const ADVANCED_SYMBOLS: MathSymbolItem[] = [
  { label: "線段", latex: "\\overline{AB}", displayLatex: "\\overline{AB}", tooltip: "線段 \\overline{AB}" },
  { label: "向量", latex: "\\vec{v}", displayLatex: "\\vec{v}", tooltip: "向量 \\vec{v}" },
  { label: "絕對值/模", latex: "|x|", displayLatex: "|x|", tooltip: "絕對值 |x|" },
  {
    label: "聯立方程",
    latex: "\\begin{cases} 2x + y = 7 \\\\ x - y = 2 \\end{cases}",
    displayLatex: "\\begin{cases} a \\\\ b \\end{cases}",
    tooltip: "聯立方程組 \\begin{cases} ... \\end{cases}",
  },
  { label: "求和", latex: "\\sum_{i=1}^{n} a_i", displayLatex: "\\sum", tooltip: "Sigma 求和 \\sum" },
  { label: "極限", latex: "\\lim_{x \\to 0}", displayLatex: "\\lim", tooltip: "極限 \\lim" },
  { label: "微分", latex: "\\frac{dy}{dx}", displayLatex: "\\frac{dy}{dx}", tooltip: "導數 \\frac{dy}{dx}" },
  { label: "積分", latex: "\\int_{a}^{b} f(x)\\,dx", displayLatex: "\\int", tooltip: "定積分 \\int" },
  { label: "alpha", latex: "\\alpha", displayLatex: "\\alpha", tooltip: "\\alpha" },
  { label: "beta", latex: "\\beta", displayLatex: "\\beta", tooltip: "\\beta" },
  { label: "theta", latex: "\\theta", displayLatex: "\\theta", tooltip: "\\theta" },
  { label: "Delta", latex: "\\Delta", displayLatex: "\\Delta", tooltip: "判別式 \\Delta" },
];

const FORMULA_PRESETS: { title: string; latex: string }[] = [
  {
    title: "一元二次公式解",
    latex: "$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$",
  },
  {
    title: "判別式",
    latex: "$\\Delta = b^2 - 4ac$",
  },
  {
    title: "畢氏定理",
    latex: "$a^2 + b^2 = c^2$",
  },
  {
    title: "平方和差公式",
    latex: "$(a + b)^2 = a^2 + 2ab + b^2$",
  },
  {
    title: "圓面積與周長",
    latex: "$A = \\pi r^2,\\quad C = 2\\pi r$",
  },
  {
    title: "平面兩點距離",
    latex: "$d = \\sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}$",
  },
  {
    title: "三角恆等式",
    latex: "$\\sin^2\\theta + \\cos^2\\theta = 1$",
  },
  {
    title: "等差數列第 n 項",
    latex: "$a_n = a_1 + (n - 1)d$",
  },
];

export const MathToolbar: React.FC<MathToolbarProps> = ({
  textareaRef,
  value,
  onChange,
  className = "",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"common" | "relations" | "advanced" | "presets">("common");

  const insertSnippet = (snippet: string, wrapInDollar = true) => {
    const textarea = textareaRef.current;
    const toInsert = wrapInDollar ? `$${snippet}$` : snippet;

    if (!textarea) {
      onChange(value ? `${value} ${toInsert}` : toInsert);
      return;
    }

    const start = textarea.selectionStart ?? value.length;
    const end = textarea.selectionEnd ?? value.length;
    const before = value.substring(0, start);
    const after = value.substring(end);

    const updated = before + toInsert + after;
    onChange(updated);

    // Set cursor right after the inserted text or inside
    setTimeout(() => {
      textarea.focus();
      const newCursorPos = start + toInsert.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 10);
  };

  return (
    <div className={`border border-sky-200 rounded-xl bg-sky-50/50 overflow-hidden text-xs ${className}`}>
      {/* Header bar */}
      <div className="px-3 py-1.5 flex items-center justify-between gap-2 border-b border-sky-100 bg-sky-100/50">
        <div className="flex items-center gap-1.5 font-semibold text-sky-900">
          <Calculator className="w-3.5 h-3.5 text-sky-600" />
          <span>數學方程式編輯工具列 (KaTeX)</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => insertSnippet("x", true)}
            className="px-2 py-0.5 rounded bg-white hover:bg-sky-50 text-sky-700 border border-sky-200 font-mono text-[11px] shadow-2xs transition"
            title="插入行內公式 $...$"
          >
            $行內公式$
          </button>
          <button
            type="button"
            onClick={() => insertSnippet("\\frac{a}{b}", false)}
            className="px-2 py-0.5 rounded bg-white hover:bg-sky-50 text-sky-700 border border-sky-200 font-mono text-[11px] shadow-2xs transition"
            title="插入獨立置中公式 $$...$$"
          >
            $$獨立區塊$$
          </button>
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="p-1 rounded text-sky-700 hover:bg-sky-200/60 transition flex items-center gap-0.5 font-medium ml-1"
          >
            {isOpen ? "收合符號盤" : "展開符號盤"}
            {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Expandable Symbols & Presets Panel */}
      {isOpen && (
        <div className="p-3 bg-white space-y-2.5">
          {/* Category Tabs */}
          <div className="flex items-center gap-1 border-b border-slate-100 pb-1.5">
            <button
              type="button"
              onClick={() => setActiveTab("common")}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                activeTab === "common"
                  ? "bg-sky-600 text-white shadow-2xs"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              常用符號
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("relations")}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                activeTab === "relations"
                  ? "bg-sky-600 text-white shadow-2xs"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              幾何與關係
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("advanced")}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                activeTab === "advanced"
                  ? "bg-sky-600 text-white shadow-2xs"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              向量與進階
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("presets")}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition flex items-center gap-1 ${
                activeTab === "presets"
                  ? "bg-amber-600 text-white shadow-2xs"
                  : "text-amber-700 hover:bg-amber-50"
              }`}
            >
              <Sparkles className="w-3 h-3" />
              經典公式範本
            </button>
          </div>

          {/* Symbol Buttons Grid */}
          {activeTab === "common" && (
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
              {COMMON_SYMBOLS.map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => insertSnippet(s.latex, true)}
                  className="flex flex-col items-center justify-center p-2 rounded-lg border border-slate-200 hover:border-sky-400 hover:bg-sky-50/60 transition group text-slate-800"
                  title={s.tooltip}
                >
                  <div className="h-6 flex items-center justify-center text-sm font-serif">
                    <MathRenderer content={`$${s.displayLatex || s.latex}$`} />
                  </div>
                  <span className="text-[10px] text-slate-500 mt-1">{s.label}</span>
                </button>
              ))}
            </div>
          )}

          {activeTab === "relations" && (
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5">
              {RELATIONS_SYMBOLS.map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => insertSnippet(s.latex, true)}
                  className="flex flex-col items-center justify-center p-2 rounded-lg border border-slate-200 hover:border-sky-400 hover:bg-sky-50/60 transition group text-slate-800"
                  title={s.tooltip}
                >
                  <div className="h-6 flex items-center justify-center text-sm font-serif">
                    <MathRenderer content={`$${s.displayLatex || s.latex}$`} />
                  </div>
                  <span className="text-[10px] text-slate-500 mt-1">{s.label}</span>
                </button>
              ))}
            </div>
          )}

          {activeTab === "advanced" && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
              {ADVANCED_SYMBOLS.map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => insertSnippet(s.latex, true)}
                  className="flex flex-col items-center justify-center p-2 rounded-lg border border-slate-200 hover:border-sky-400 hover:bg-sky-50/60 transition group text-slate-800"
                  title={s.tooltip}
                >
                  <div className="h-6 flex items-center justify-center text-sm font-serif">
                    <MathRenderer content={`$${s.displayLatex || s.latex}$`} />
                  </div>
                  <span className="text-[10px] text-slate-500 mt-1 truncate max-w-full">{s.label}</span>
                </button>
              ))}
            </div>
          )}

          {activeTab === "presets" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
              {FORMULA_PRESETS.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => insertSnippet(p.latex, false)}
                  className="p-2.5 rounded-xl border border-amber-200/80 bg-amber-50/40 hover:bg-amber-100/60 hover:border-amber-400 text-left transition flex flex-col gap-1"
                >
                  <span className="text-[11px] font-bold text-amber-900 flex items-center gap-1">
                    <BookOpen className="w-3 h-3 text-amber-600" />
                    {p.title}
                  </span>
                  <div className="text-xs text-slate-900 font-serif overflow-x-auto py-0.5">
                    <MathRenderer content={p.latex} />
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Quick Tip Footer */}
          <div className="text-[10px] text-slate-500 bg-slate-50 p-2 rounded-lg border border-slate-100 flex items-center justify-between">
            <span>
              💡 提示：前後加上 <code>$算式$</code> 即會自動排版為行內公式；加上 <code>$$算式$$</code> 則會居中獨立顯示。
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
