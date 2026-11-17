const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mapAnalysis } = require("../src/utils/mapAnalysis");

test("analysis uses the 50% boundary and removes stale face alerts", () => {
  for (const [similarity, matches] of [[0.4999, false], [0.5, true], [0.5998, true], [null, null]]) {
    const result = mapAnalysis({ face_similarity: similarity, risk_flags: { face_uncertain: true } }, 0.5);
    assert.equal(result.faceIsMatch, matches);
    assert.equal(result.faceMatchThreshold, 0.5);
    if (matches) assert.equal(result.findings.face_uncertain, undefined);
  }
});
test("analysis exposes only core fields and never returns address or device data", () => {
  const result = mapAnalysis({ indian_fields: { full_name: "Sample", address: "private address", father_name: "Parent" },
    ocr_result: { raw_text: "private address", extracted_fields: { address: "private address" } },
    ip_address: "private IP", user_agent: "private agent", status: "submitted" }, 0.5);
  assert.equal(result.fields.full_name, "Sample");
  assert.equal(result.fields.address, undefined);
  assert.equal(result.ocr.rawText, undefined);
  assert.equal(result.ipAddress, undefined);
  assert.equal(JSON.stringify(result).includes("private address"), false);
});
test("missing face data remains unknown and AI failures preserve null scores", () => {
  const result = mapAnalysis({ face_similarity: null, ai_image_result: { portrait: { status: "unavailable", images: [{ ai_score: null }] } } }, 0.5);
  assert.equal(result.faceIsMatch, null);
  assert.equal(result.aiImageAnalysis.portrait.images[0].ai_score, null);
});
test("analysis distinguishes confirmed liveness from older unchecked sessions", () => {
  const confirmed = mapAnalysis({ risk_flags: { liveness_confirmed: true } }, 0.5);
  const old = mapAnalysis({ risk_flags: { liveness_not_performed: true } }, 0.5);
  assert.equal(confirmed.livenessStatus, "confirmed");
  assert.equal(old.livenessStatus, "not_performed");
});
