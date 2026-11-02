/**
 * Failed key tests must still name the model that was called.
 * Run: npx tsx scripts/test-verify-model.ts
 */
import {
  failedVerificationModel,
  generateContentWithRetry,
} from "../src/services/geminiCore";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

assert(
  failedVerificationModel({ modelUsed: "gemini-3.8-flash" }, "gemini-3.1-flash-lite") ===
    "gemini-3.8-flash",
  "prefer the model attached to the error"
);
assert(
  failedVerificationModel(undefined, "gemini-3.1-pro-preview") === "gemini-3.1-pro-preview",
  "fall back to the requested model when the error has none"
);
assert(
  failedVerificationModel({}, "not-a-real-model") === "gemini-3.1-flash-lite",
  "unknown requested model resolves to the default"
);

function unavailable(model: string) {
  const error: any = new Error(
    `{"error":{"code":503,"message":"high demand","status":"UNAVAILABLE"}}`
  );
  error.status = 503;
  error.testedModel = model;
  return error;
}

const ai = {
  models: {
    generateContent: async ({ model }: { model: string }) => {
      throw unavailable(model);
    },
  },
} as any;

try {
  await generateContentWithRetry(ai, "gemini-3.1-pro-preview", {
    contents: "Reply with the exact word 'PONG'",
  });
  console.error("FAIL: expected generateContentWithRetry to throw");
  process.exit(1);
} catch (error: any) {
  const shown = failedVerificationModel(error, "gemini-3.1-pro-preview");
  assert(Boolean(shown), "failed verification must name a model");
  assert(
    shown === "gemini-3.8-flash",
    `last attempted model should be shown, got ${shown}`
  );
}

const invalid = {
  models: {
    generateContent: async () => {
      const error: any = new Error('{"error":{"code":400,"message":"API key not valid","status":"INVALID_ARGUMENT"}}');
      error.status = 400;
      throw error;
    },
  },
} as any;

try {
  await generateContentWithRetry(invalid, "gemini-3.1-flash-lite", {
    contents: "Reply with the exact word 'PONG'",
  });
  console.error("FAIL: expected invalid-key call to throw");
  process.exit(1);
} catch (error: any) {
  assert(
    failedVerificationModel(error, "gemini-3.1-flash-lite") === "gemini-3.1-flash-lite",
    "non-transient failure still names the requested model"
  );
}

console.log("ok: failed key test keeps a model id");
