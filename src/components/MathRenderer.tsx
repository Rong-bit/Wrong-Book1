import React, { useMemo } from "react";
import katex from "katex";

interface MathRendererProps {
  content: string;
  className?: string;
}

interface Segment {
  type: "text" | "inline-math" | "block-math";
  value: string;
}

/**
 * Normalizes math text by:
 * 1. Repairing corrupted control characters (e.g. \x0c -> \f from JSON escaping, \x08 -> \b)
 * 2. Unifying unicode minus signs (− -> -) in math contexts
 * 3. Auto-detecting and wrapping unwrapped LaTeX formulas (e.g. mixed fractions `-7 \frac{6}{9}`, `\frac{a}{b}`, `\sqrt{x}`) in $...$
 */
export function normalizeMathText(raw: string): string {
  if (!raw) return "";

  let text = raw;

  // 1. Repair control characters caused by unescaped backslashes in JSON serialization:
  // \x0c is Form Feed (0x0C) which happens when JSON parser interprets "\frac" as "\f" + "rac"
  text = text.replace(/\x0c([a-zA-Z]+)/g, "\\f$1");
  text = text.replace(/\x0crac/g, "\\frac");
  text = text.replace(/\x0c/g, "\\frac");

  // \x08 is Backspace (0x08) from "\beta", "\binom", "\bar"
  text = text.replace(/\x08([a-zA-Z]+)/g, "\\b$1");

  // \t (Tab) from "\text", "\theta", "\tau", "\times", "\tan", "\to", "\triangle"
  text = text.replace(/\t(ext|heta|au|imes|an|riangle|o)\b/g, "\\t$1");

  // \r (CR) from "\rho", "\right", "\rangle"
  text = text.replace(/\r(ho|ight|angle)\b/g, "\\r$1");

  // \n (NL) from "\nu", "\neq", "\neg", "\nabla"
  text = text.replace(/(?<!\n)\n(u|eq|eg|abla)\b/g, "\\n$1");

  // 2. Protect existing math blocks ($$...$$ and $...$) so we don't double-wrap or alter them
  const mathPlaceholders: string[] = [];
  const placeholderPrefix = "___MATH_TOKEN_";

  const protectedText = text.replace(/\$\$[\s\S]+?\$\$|\$[^\$\n]+?\$/g, (match) => {
    const idx = mathPlaceholders.length;
    mathPlaceholders.push(match);
    return `${placeholderPrefix}${idx}___`;
  });

  // 3. On the non-math portions, auto-wrap unwrapped mixed fractions and standard fractions:
  // Supports:
  // - Mixed fractions: `-7 \frac{6}{9}`, `−7 \frac{6}{9}`, `7 \frac{1}{2}`, `-7\frac{5}{9}`
  // - Simple fractions: `\frac{6}{9}`, `-\frac{6}{9}`, `\dfrac{a}{b}`, `\tfrac{1}{3}`
  let enriched = protectedText.replace(
    /((?:[+-−]?\s*\d+\s*)?\\(?:d|t)?frac\{[^{}]+\}\{[^{}]+\})/g,
    (match) => {
      // Normalize unicode minus to standard ASCII minus in math mode
      const normalizedMath = match.trim().replace(/−/g, "-");
      return `$${normalizedMath}$`;
    }
  );

  // Auto-wrap standalone \sqrt{...} or \sqrt[n]{...}
  enriched = enriched.replace(
    /(\\sqrt(?:\[[^\]]+\])?\{[^{}]+\})/g,
    (match) => `$${match.trim().replace(/−/g, "-")}$`
  );

  // 4. Restore the protected math blocks
  enriched = enriched.replace(new RegExp(`${placeholderPrefix}(\\d+)___`, "g"), (_, idxStr) => {
    const idx = parseInt(idxStr, 10);
    return mathPlaceholders[idx] ?? "";
  });

  return enriched;
}

/**
 * Parses raw text into text and LaTeX math blocks ($...$ or $$...$$)
 */
function parseMathSegments(rawText: string): Segment[] {
  if (!rawText) return [];

  const text = normalizeMathText(rawText);
  const segments: Segment[] = [];
  // Regex to match $$block math$$ or $inline math$
  // $$[\s\S]+?$$ matches display mode formulas
  // \$([^\$\n]+?)\$ matches inline formulas on the same line
  const regex = /\$\$([\s\S]+?)\$\$|\$([^\$\n]+?)\$/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Plain text before math
    if (match.index > lastIndex) {
      segments.push({
        type: "text",
        value: text.substring(lastIndex, match.index),
      });
    }

    if (match[1] !== undefined) {
      // Block math ($$...$$)
      segments.push({
        type: "block-math",
        value: match[1].trim(),
      });
    } else if (match[2] !== undefined) {
      // Inline math ($...$)
      segments.push({
        type: "inline-math",
        value: match[2].trim(),
      });
    }

    lastIndex = regex.lastIndex;
  }

  // Trailing text
  if (lastIndex < text.length) {
    segments.push({
      type: "text",
      value: text.substring(lastIndex),
    });
  }

  return segments;
}

/**
 * Safely renders LaTeX via KaTeX
 */
function renderKatexHtml(latex: string, displayMode: boolean): string {
  // Clean any remaining control characters or unicode minus
  const cleanLatex = latex
    .replace(/\x0c([a-zA-Z]+)/g, "\\f$1")
    .replace(/\x0crac/g, "\\frac")
    .replace(/\x0c/g, "\\frac")
    .replace(/\x08([a-zA-Z]+)/g, "\\b$1")
    .replace(/−/g, "-");

  try {
    return katex.renderToString(cleanLatex, {
      displayMode,
      throwOnError: false,
      output: "htmlAndMathml",
      strict: false,
    });
  } catch {
    return latex;
  }
}

export const MathRenderer: React.FC<MathRendererProps> = ({ content, className = "" }) => {
  const segments = useMemo(() => parseMathSegments(content), [content]);

  if (!content) return null;

  // If there are no math segments (pure text), still preserve line breaks
  if (segments.length === 1 && segments[0].type === "text") {
    return (
      <span className={`block max-w-full min-w-0 whitespace-pre-line break-words ${className}`}>
        {content}
      </span>
    );
  }

  return (
    <span className={`block max-w-full min-w-0 break-words leading-relaxed ${className}`}>
      {segments.map((seg, idx) => {
        if (seg.type === "block-math") {
          const html = renderKatexHtml(seg.value, true);
          return (
            <span
              key={`math-block-${idx}`}
              className="block my-2 overflow-x-auto text-center"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }

        if (seg.type === "inline-math") {
          const html = renderKatexHtml(seg.value, false);
          return (
            <span
              key={`math-inline-${idx}`}
              className="inline-block max-w-full overflow-x-auto align-middle mx-0.5"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }

        return (
          <span key={`text-${idx}`} className="whitespace-pre-line break-words">
            {seg.value}
          </span>
        );
      })}
    </span>
  );
};
