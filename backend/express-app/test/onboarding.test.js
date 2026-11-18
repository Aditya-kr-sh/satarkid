const { test, before, after, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
process.env.DATABASE_URL = "postgresql://unused:unused@localhost:1/test";
process.env.PUBLIC_UPLOAD_URL = "http://localhost/uploads";
delete process.env.DATABASE_CA_FILE;
const service = require("../src/services/onboardingService");
const pool = require("../src/services/dbClient");
const settings = require("../src/services/settingsService");
const axios = require("axios");
const aiImages = require("../src/services/aiImageService");
const controller = require("../src/controllers/onboardingController");
let image;
let portrait;
before(async () => {
  process.env.LOCAL_UPLOAD_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "satarkid-tests-"));
  image = await sharp({ create: { width: 20, height: 20, channels: 3, background: "white" } }).jpeg().toBuffer();
  portrait = await sharp({ create: { width: 20, height: 20, channels: 3, background: "blue" } }).png().toBuffer();
});
afterEach(() => mock.restoreAll());
after(async () => { await pool.end(); await fs.rm(process.env.LOCAL_UPLOAD_DIR, { recursive: true }); });
function baseMocks(overrides = {}) {
  mock.method(aiImages, "analyzePortrait", async () => ({ status: "unavailable", images: [{ ai_score: null }] }));
  mock.method(service, "getSession", async () => ({ document_type: "Aadhaar", kyc_submission_id: "test", risk_flags: {}, ...overrides }));
  mock.method(settings, "getSettings", async () => ({ face_match_threshold: 0.5 }));
  mock.method(service, "_verifyLiveness", async () => ({ liveness_confirmed: true,
    challenge_result: "passed", face_detection_status: "detected", face_detected_frames: 16, sampled_frames: 16 }));
  return mock.method(pool, "query", async query => query.includes("AS liveness_challenge")
    ? { rows: [{ liveness_challenge: "turn_left" }], rowCount: 1 }
    : { rows: [], rowCount: 1 });
}
function response() {
  return { code: 200, body: null, status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }, set() { return this; } };
}
test("OCR and AI unavailability do not block face-ready uploads", async () => {
  const writes = baseMocks();
  mock.method(axios, "get", async () => ({ status: 200, data: { ocr_ready: false, ai_detector_ready: false } }));
  await service.assertReady();
  assert.equal(writes.mock.callCount(), 1);
});
test("unsupported document types fail before processing", async () => {
  const process = mock.method(service, "processDocument", async () => { throw new Error("must not process"); });
  const res = response();
  await controller.startWithDocument({ body: { documentType: "unsupported" } }, res);
  assert.equal(res.code, 400);
  assert.equal(process.mock.callCount(), 0);
});
test("selfie submission requires a separate uploaded analysis portrait", async () => {
  const process = mock.method(service, "processSelfie", async () => { throw new Error("must not process"); });
  const res = response();
  await controller.processSelfie({
    params: { sessionId: "00000000-0000-4000-8000-000000000000" },
    files: { selfie_front: [{ buffer: image }], liveness_video: [{ buffer: image, mimetype: "video/webm" }] },
  }, res);
  assert.equal(res.code, 400);
  assert.match(res.body.error, /uploaded portrait/i);
  assert.equal(process.mock.callCount(), 0);
});
test("liveness challenges are short-lived and server-selected", async () => {
  baseMocks();
  const challenge = await service.issueLivenessChallenge("test");
  assert.ok(["turn_left", "turn_right"].includes(challenge.challenge));
  assert.equal(challenge.expiresInSeconds, 120);
});
test("a live matching portrait replaces old findings without approving identity", async () => {
  const writes = baseMocks({ risk_flags: { face_mismatch: true, face_uncertain: true, no_face_in_selfie: true,
    liveness_confirmed: true, liveness_challenge: "turn_left", liveness_challenge_expires_at: "2025-01-01T00:00:00Z" } });
  const compare = mock.method(service, "_compareFaceToDocument", async () => ({ face_found: true, similarity_score: 0.5,
    face_detection_confidence: 0.97, face_region: [2, 3, 18, 19] }));
  const result = await service.processSelfie("test", {
    frontBuffer: image, portraitBuffer: portrait, livenessVideoBuffer: image, videoType: "video/webm",
  });
  assert.equal(compare.mock.calls[0].arguments[2], 0.5);
  assert.equal(compare.mock.calls[0].arguments[0], image);
  assert.equal(result.isMatch, true);
  assert.equal(result.outcome, "pending");
  assert.equal(result.status, "submitted");
  assert.equal(result.livenessConfirmed, true);
  assert.equal(result.riskFlags.liveness_confirmed, true);
  assert.equal(result.riskFlags.verification_mode, "active_liveness");
  assert.equal(result.riskFlags.liveness_challenge_completed, "turn_left");
  assert.equal(result.riskFlags.liveness_challenge_result, "passed");
  assert.equal(result.riskFlags.liveness_face_detected_frames, 16);
  assert.equal(result.riskFlags.liveness_sampled_frames, 16);
  assert.equal(result.riskFlags.portrait_face_detection_confidence, 0.97);
  assert.deepEqual(result.riskFlags.portrait_face_region, [2, 3, 18, 19]);
  assert.ok(result.riskFlags.liveness_verified_at);
  assert.equal(result.riskFlags.liveness_not_performed, undefined);
  assert.equal(result.riskFlags.liveness_challenge, undefined);
  assert.equal(result.riskFlags.liveness_challenge_expires_at, undefined);
  assert.deepEqual(aiImages.analyzePortrait.mock.calls[0].arguments, [portrait]);
  assert.deepEqual(service._verifyLiveness.mock.calls[0].arguments, [image, "video/webm", "turn_left"]);
  for (const key of ["face_mismatch", "face_uncertain", "no_face_in_selfie"]) assert.equal(result.riskFlags[key], undefined);
  const [sql, values] = writes.mock.calls.find(call => call.arguments[0].includes("SET selfie_url")).arguments;
  assert.equal(values[4], 0.5);
  assert.equal(JSON.parse(values[3]).portrait.images[0].ai_score, null);
  assert.ok(JSON.parse(values[3]).portrait.image_url.startsWith("http://localhost/uploads/"));
  assert.doesNotMatch(sql, /risk_score\s*=/);
});
test("failed liveness cannot store or submit a portrait", async () => {
  const writes = baseMocks();
  service._verifyLiveness.mock.mockImplementation(async () => ({
    liveness_confirmed: false, error: "The requested head turn was not detected.",
  }));
  await assert.rejects(service.processSelfie("test", {
    frontBuffer: image, portraitBuffer: portrait, livenessVideoBuffer: image, videoType: "video/webm",
  }), /head turn was not detected/);
  assert.equal(aiImages.analyzePortrait.mock.callCount(), 0);
  assert.equal(writes.mock.calls.filter(call => call.arguments[0].includes("SET selfie_url")).length, 0);
});
test("a still image cannot bypass the live camera challenge", async () => {
  baseMocks();
  await assert.rejects(service.processSelfie("test", { frontBuffer: image }), /liveness check/);
});
test("the uploaded portrait is required before consuming a liveness challenge", async () => {
  const writes = baseMocks();
  await assert.rejects(service.processSelfie("test", {
    frontBuffer: image, livenessVideoBuffer: image, videoType: "video/webm",
  }), /Upload a portrait photo/);
  assert.equal(writes.mock.callCount(), 0);
});
test("comparison failure or invalid scores cannot submit a successful result", async () => {
  const writes = baseMocks();
  const compare = mock.method(service, "_compareFaceToDocument", async () => null);
  for (const value of [null, { face_found: true, similarity_score: null }, { face_found: true, similarity_score: NaN }]) {
    compare.mock.mockImplementation(async () => value);
    await assert.rejects(service.processSelfie("test", {
      frontBuffer: image, portraitBuffer: portrait, livenessVideoBuffer: image, videoType: "video/webm",
    }), /comparison is unavailable/);
  }
  assert.equal(writes.mock.calls.filter(call => call.arguments[0].includes("SET selfie_url")).length, 0);
});
test("no face in a portrait is unknown rather than a zero-percent match", async () => {
  baseMocks();
  mock.method(service, "_compareFaceToDocument", async () => ({ face_found: false, similarity_score: null }));
  const result = await service.processSelfie("test", {
    frontBuffer: image, portraitBuffer: portrait, livenessVideoBuffer: image, videoType: "video/webm",
  });
  assert.equal(result.faceSimilarity, null);
  assert.equal(result.isMatch, null);
  assert.equal(result.riskFlags.no_face_in_selfie, true);
});
test("a document without a face still receives portrait AI analysis", async () => {
  baseMocks({ document_type: "PAN", kyc_submission_id: null });
  const compare = mock.method(service, "_compareFaceToDocument", async () => { throw new Error("must not compare"); });
  const result = await service.processSelfie("test", {
    frontBuffer: image, portraitBuffer: portrait, livenessVideoBuffer: image, videoType: "video/webm",
  });
  assert.equal(result.isMatch, null);
  assert.equal(result.riskFlags.face_comparison_skipped, true);
  assert.equal(compare.mock.callCount(), 0);
  assert.equal(aiImages.analyzePortrait.mock.callCount(), 1);
});
test("analysis rejects malformed and missing IDs without exposing records", async () => {
  const get = mock.method(service, "getSession", async () => null);
  let res = response();
  await controller.getAnalysis({ params: { sessionId: "not-an-id" } }, res);
  assert.equal(res.code, 400);
  assert.equal(get.mock.callCount(), 0);
  res = response();
  await controller.getAnalysis({ params: { sessionId: "00000000-0000-4000-8000-000000000000" } }, res);
  assert.equal(res.code, 404);
});
