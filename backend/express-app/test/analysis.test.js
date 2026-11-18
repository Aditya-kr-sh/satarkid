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
test("analysis returns the Aadhaar back-page address but never raw OCR text or device data", () => {
  const address = "C/o Sample Parent, Plot No-679, Patna, Bihar - 801105";
  const result = mapAnalysis({ indian_fields: { full_name: "Sample", address, father_name: "Parent" },
    ocr_result: { raw_text: "private raw text", extracted_fields: { address } },
    ip_address: "private IP", user_agent: "private agent", status: "submitted" }, 0.5);
  assert.equal(result.fields.full_name, "Sample");
  assert.equal(result.fields.address, address);
  assert.equal(result.ocr.fields.address, address);
  assert.equal(result.fields.father_name, undefined);
  assert.equal(result.ocr.rawText, undefined);
  assert.equal(result.ipAddress, undefined);
  assert.equal(JSON.stringify(result).includes("private raw text"), false);
  assert.equal(JSON.stringify(result).includes("private IP"), false);
});
test("missing face data remains unknown and AI failures preserve null scores", () => {
  const result = mapAnalysis({ face_similarity: null, ai_image_result: { portrait: { status: "unavailable", images: [{ ai_score: null }] } } }, 0.5);
  assert.equal(result.faceIsMatch, null);
  assert.equal(result.aiImageAnalysis.portrait.images[0].ai_score, null);
});
test("analysis distinguishes confirmed liveness from older unchecked sessions", () => {
  const confirmed = mapAnalysis({ risk_flags: { liveness_confirmed: true, verification_mode: "active_liveness",
    liveness_challenge_completed: "turn_left", liveness_challenge_result: "passed",
    liveness_face_detection_status: "detected", liveness_face_detected_frames: 15,
    liveness_sampled_frames: 16, liveness_verified_at: "2025-01-01T00:00:00Z" } }, 0.5);
  const old = mapAnalysis({ risk_flags: { liveness_not_performed: true } }, 0.5);
  assert.equal(confirmed.livenessStatus, "confirmed");
  assert.equal(confirmed.liveness.challenge, "turn_left");
  assert.equal(confirmed.liveness.faceDetectedFrames, 15);
  assert.equal(confirmed.liveness.sampledFrames, 16);
  assert.equal(confirmed.liveness.confidence, null);
  assert.equal(old.livenessStatus, "not_performed");
});
test("analysis exposes OCR line boxes and face metadata without OCR source text", () => {
  const result = mapAnalysis({
    ocr_result: { raw_text: "private OCR text", lines: [
      { text: "private OCR text", confidence: 0.91, box: [1, 2, 20, 12], page: 0 },
      { text: "invalid box", confidence: 0.8, box: [1, 2], page: 0 },
    ] },
    document_face_detection_confidence: 0.96,
    document_face_region: { x1: 2, y1: 3, x2: 40, y2: 50 },
    risk_flags: { portrait_face_detection_confidence: 0.88, portrait_face_region: [4, 5, 40, 50] },
  }, 0.5);
  assert.equal(result.ocr.lines.length, 1);
  assert.equal(result.ocr.lines[0].confidence, 0.91);
  assert.equal(result.faceEvidence.document.region.x2, 40);
  assert.equal(result.faceEvidence.portrait.detectionConfidence, 0.88);
  assert.equal(JSON.stringify(result).includes("private OCR text"), false);
});
