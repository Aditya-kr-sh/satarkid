const { afterEach, mock, test } = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");
const { analyzePortrait } = require("../src/services/aiImageService");

afterEach(() => mock.restoreAll());

test("portrait analysis preserves detector diagnostics from the ML service", async () => {
  const response = {
    status: "unavailable",
    model_status: { state: "error", error_code: "model_load_failed" },
    images: [{ status: "unavailable", ai_score: null, error_code: "model_load_failed" }],
  };
  mock.method(axios, "post", async () => ({ data: response }));

  assert.deepEqual(await analyzePortrait(Buffer.from("portrait")), response);
});

test("portrait analysis exposes service connection failures instead of hiding them", async () => {
  const failure = Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
  mock.method(axios, "post", async () => { throw failure; });
  mock.method(console, "error", () => {});

  const result = await analyzePortrait(Buffer.from("portrait"));
  assert.equal(result.status, "unavailable");
  assert.equal(result.images[0].ai_score, null);
  assert.equal(result.images[0].error_code, "ml_service_unavailable");
  assert.match(result.images[0].error_message, /could not be reached/);
});
