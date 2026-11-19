/**
 * Node-side checks for releaseTextScreenshot / getTextOnlyFigureSrc.
 * Run: npx tsx scripts/test-release-text-screenshot.ts
 */
import assert from "node:assert/strict";
import {
  canReleaseTextScreenshot,
  getQuestionPreviewSrc,
  getTextOnlyFigureSrc,
  releaseTextScreenshot,
} from "../src/utils/questionExport";

const baseSettings = {
  zoom: 100,
  rotation: 0,
  align: "center" as const,
  includeInExport: true,
};

function okReady(over: Record<string, unknown> = {}) {
  return {
    status: "ready" as const,
    questionText: "如圖，甲地年雨量？",
    imageBase64: "data:image/jpeg;base64,STEM",
    figureImageBase64: "data:image/jpeg;base64,FIG",
    imageSettings: baseSettings,
    ...over,
  };
}

// Release when ready + text + figure field is a string
{
  const q = okReady();
  assert.equal(canReleaseTextScreenshot(q), true);
  const next = releaseTextScreenshot(q);
  assert.equal(next.imageBase64, "");
  assert.equal(next.figureImageBase64, "data:image/jpeg;base64,FIG");
}

// Explicit empty figure still releases stem
{
  const q = okReady({ figureImageBase64: "" });
  assert.equal(canReleaseTextScreenshot(q), true);
  assert.equal(releaseTextScreenshot(q).imageBase64, "");
  assert.equal(releaseTextScreenshot(q).figureImageBase64, "");
}

// Do not release legacy (undefined figure)
{
  const q = okReady({ figureImageBase64: undefined });
  assert.equal(canReleaseTextScreenshot(q), false);
  assert.equal(releaseTextScreenshot(q).imageBase64, "data:image/jpeg;base64,STEM");
}

// Do not release while analyzing / error / empty text
{
  assert.equal(canReleaseTextScreenshot(okReady({ status: "analyzing" })), false);
  assert.equal(canReleaseTextScreenshot(okReady({ status: "error" })), false);
  assert.equal(canReleaseTextScreenshot(okReady({ questionText: "  " })), false);
}

// Preview prefers stem, else figure
{
  assert.equal(
    getQuestionPreviewSrc(okReady()),
    "data:image/jpeg;base64,STEM"
  );
  assert.equal(
    getQuestionPreviewSrc(okReady({ imageBase64: "" })),
    "data:image/jpeg;base64,FIG"
  );
  assert.equal(
    getQuestionPreviewSrc(okReady({ imageBase64: "", figureImageBase64: "" })),
    null
  );
}

// Export figure: dedicated fig, explicit none, legacy fallback
{
  assert.equal(
    getTextOnlyFigureSrc(okReady({ imageBase64: "" })),
    "data:image/jpeg;base64,FIG"
  );
  assert.equal(
    getTextOnlyFigureSrc(okReady({ imageBase64: "", figureImageBase64: "" })),
    null
  );
  assert.equal(
    getTextOnlyFigureSrc(
      okReady({ figureImageBase64: undefined, imageBase64: "data:image/jpeg;base64,LEGACY" })
    ),
    "data:image/jpeg;base64,LEGACY"
  );
  assert.equal(
    getTextOnlyFigureSrc(
      okReady({
        imageSettings: { ...baseSettings, includeInExport: false },
      })
    ),
    null
  );
}

console.log("test-release-text-screenshot: all passed");
