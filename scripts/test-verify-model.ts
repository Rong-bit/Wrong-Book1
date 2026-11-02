/**
 * Failed key tests must still name the model that was called.
 * Run: npx tsx scripts/test-verify-model.ts
 */
import {
  failedVerificationModel,
  formatErrorMessage,
  generateContentWithRetry,
  isBillingError,
  isTransientError,
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

const depletedMessage =
  '{"error":{"code":402,"message":"Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing. Learn more at https://ai.google.dev/gemini-api/docs/billing#prepay. ","status":"RESOURCE_EXHAUSTED"}}';
const depleted: any = new Error(depletedMessage);
depleted.status = 402;

assert(isBillingError(depleted), "402 prepay depletion is a billing error");
assert(!isTransientError(depleted), "402 must not be treated as a demand spike");
const billingText = formatErrorMessage(depleted);
assert(billingText.isBillingProblem, "formatErrorMessage flags billing");
assert(!billingText.isTransient, "billing is not transient");
assert(!billingText.message.includes("503"), `billing text must not say 503: ${billingText.message}`);
assert(billingText.message.includes("402"), "billing text names HTTP 402");
assert(billingText.message.includes("預付"), "billing text tells the user the prepay balance is empty");

const rateLimited: any = new Error(
  '{"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota).","status":"RESOURCE_EXHAUSTED"}}'
);
rateLimited.status = 429;
assert(!isBillingError(rateLimited), "429 quota is not a prepay billing error");
assert(isTransientError(rateLimited), "429 remains retryable");

let billingCalls = 0;
const billingAi = {
  models: {
    generateContent: async () => {
      billingCalls++;
      const error: any = new Error(depletedMessage);
      error.status = 402;
      throw error;
    },
  },
} as any;

try {
  await generateContentWithRetry(billingAi, "gemini-3.1-flash-lite", {
    contents: "Reply with the exact word 'PONG'",
  });
  console.error("FAIL: expected depleted prepay call to throw");
  process.exit(1);
} catch (error: any) {
  assert(billingCalls === 1, `402 must not switch models or retry, calls=${billingCalls}`);
  assert(
    failedVerificationModel(error, "gemini-3.1-flash-lite") === "gemini-3.1-flash-lite",
    "402 still names the model that was called"
  );
  assert(!formatErrorMessage(error).message.includes("503"), "thrown 402 is not relabeled 503");
}

console.log("ok: failed key test keeps a model id");
console.log("ok: 402 prepay depletion is not shown as 503");
