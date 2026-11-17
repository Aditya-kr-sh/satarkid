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
before(async () => {
  process.env.LOCAL_UPLOAD_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "satarkid-tests-"));
  image = await sharp({ create: { width: 20, height: 20, channels: 3, background: "white" } }).jpeg().toBuffer();
});
afterEach(() => mock.restoreAll());
after(async () => { await pool.end(); await fs.rm(process.env.LOCAL_UPLOAD_DIR, { recursive: true }); });
function baseMocks(overrides = {}) {
  mock.method(aiImages, "analyzePortrait", async () => ({ status: "unavailable", images: [{ ai_score: null }] }));
  mock.method(service, "getSession", async () => ({ document_type: "Aadhaar", kyc_submission_id: "test", risk_flags: {}, ...overrides }));
  mock.method(settings, "getSettings", async () => ({ face_match_threshold: 0.5 }));
  return mock.method(pool, "query", async () => ({ rows: [] }));
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
test("a matching still portrait replaces old findings without approving identity", async () => {
  const writes = baseMocks({ risk_flags: { face_mismatch: true, face_uncertain: true, no_face_in_selfie: true, liveness_confirmed: true } });
  const compare = mock.method(service, "_compareFaceToDocument", async () => ({ face_found: true, similarity_score: 0.5 }));
  const result = await service.processSelfie("test", { frontBuffer: image, livenessIsLive: true });
  assert.equal(compare.mock.calls[0].arguments[2], 0.5);
  assert.equal(result.isMatch, true);
  assert.equal(result.outcome, "pending");
  assert.equal(result.status, "submitted");
  assert.equal(result.riskFlags.liveness_not_performed, true);
  for (const key of ["face_mismatch", "face_uncertain", "no_face_in_selfie", "liveness_confirmed"]) assert.equal(result.riskFlags[key], undefined);
  const [sql, values] = writes.mock.calls[0].arguments;
  assert.equal(values[4], 0.5);
  assert.equal(JSON.parse(values[3]).portrait.images[0].ai_score, null);
  assert.doesNotMatch(sql, /risk_score\s*=/);
});
test("comparison failure or invalid scores cannot submit a successful result", async () => {
  const writes = baseMocks();
  const compare = mock.method(service, "_compareFaceToDocument", async () => null);
  for (const value of [null, { face_found: true, similarity_score: null }, { face_found: true, similarity_score: NaN }]) {
    compare.mock.mockImplementation(async () => value);
    await assert.rejects(service.processSelfie("test", { frontBuffer: image }), /comparison is unavailable/);
  }
  assert.equal(writes.mock.callCount(), 0);
});
test("no face in a portrait is unknown rather than a zero-percent match", async () => {
  baseMocks();
  mock.method(service, "_compareFaceToDocument", async () => ({ face_found: false, similarity_score: null }));
  const result = await service.processSelfie("test", { frontBuffer: image });
  assert.equal(result.faceSimilarity, null);
  assert.equal(result.isMatch, null);
  assert.equal(result.riskFlags.no_face_in_selfie, true);
});
test("a document without a face still receives portrait AI analysis", async () => {
  baseMocks({ document_type: "PAN", kyc_submission_id: null });
  const compare = mock.method(service, "_compareFaceToDocument", async () => { throw new Error("must not compare"); });
  const result = await service.processSelfie("test", { frontBuffer: image });
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
