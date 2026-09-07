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
 * Parses raw text into text and LaTeX math blocks ($...$ or $$...$$)
 */
function parseMathSegments(text: string): Segment[] {
  if (!text) return [];

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
  try {
    return katex.renderToString(latex, {
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
    return <span className={`whitespace-pre-line ${className}`}>{content}</span>;
  }

  return (
    <span className={`inline-math-container leading-relaxed ${className}`}>
      {segments.map((seg, idx) => {
        if (seg.type === "block-math") {
          const html = renderKatexHtml(seg.value, true);
          return (
            <span
              key={`math-block-${idx}`}
              className="block my-2.5 overflow-x-auto text-center"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }

        if (seg.type === "inline-math") {
          const html = renderKatexHtml(seg.value, false);
          return (
            <span
              key={`math-inline-${idx}`}
              className="inline-block mx-0.5 align-middle"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }

        // Plain text with line breaks preserved
        return (
          <span key={`text-${idx}`} className="whitespace-pre-line">
            {seg.value}
          </span>
        );
      })}
    </span>
  );
};
