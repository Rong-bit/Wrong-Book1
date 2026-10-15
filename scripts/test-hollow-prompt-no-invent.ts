/**
 * Prompt smoke test: #54-style hollow prompt must forbid inventing figures.
 * Run: npx tsx scripts/test-hollow-prompt-no-invent.ts
 */
import { buildRemoveHandwritingPrompt } from "../src/services/geminiCore";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

const prompt = buildRemoveHandwritingPrompt();
assert(prompt.includes("不發明圖"), "prompt must include 不發明圖");
assert(
  prompt.includes("禁止新增") || prompt.includes("不可"),
  "prompt must forbid adding new figures"
);
assert(
  prompt.includes("空白") &&
    (prompt.includes("奇怪圖形") || prompt.includes("補圖")),
  "prompt must forbid inventing on blank paper"
);
assert(!prompt.includes("8Ω"), "prompt must not prime 8Ω");
assert(!prompt.includes("$X_L$"), "prompt must not prime $X_L$");
assert(
  prompt.includes("紙張平整") || prompt.includes("去陰影"),
  "prompt should keep #54 flatten/shadow guidance"
);

console.log("OK: hollow prompt forbids inventing figures; no 8Ω/$X_L$ priming");
