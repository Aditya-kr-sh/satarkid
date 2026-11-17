const service = require("../services/onboardingService");
const settings = require("../services/settingsService");
const { mapAnalysis } = require("../utils/mapAnalysis");

const validId = id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || "");
const failure = (res, error) => res.status(error.statusCode || 503).json({ success: false, error: error.message || "Analysis is unavailable." });

async function startWithDocument(req, res) {
  try {
    if (!["aadhaar", "pan"].includes(String(req.body.documentType || "").toLowerCase())) return res.status(400).json({ success: false, error: "SatarkID supports Aadhaar and individual PAN." });
    const front = req.files?.frontImage?.[0];
    if (!front) return res.status(400).json({ success: false, error: "Upload a document." });
    await service.assertReady();
    const id = await service.createSessionShell();
    const result = await service.processDocument(id, { documentType: req.body.documentType, frontBuffer: front.buffer, backBuffer: req.files?.backImage?.[0]?.buffer });
    return res.status(201).json({ success: true, sessionId: id, ...result });
  } catch (error) { return failure(res, error); }
}
async function submitPersonalInfo(req, res) {
  if (!validId(req.params.sessionId)) return res.status(400).json({ error: "Invalid submission ID." });
  try { return res.json({ success: true, ...await service.submitPersonalInfo(req.params.sessionId, req.body) }); }
  catch (error) { return failure(res, error); }
}
async function issueLivenessChallenge(req, res) {
  if (!validId(req.params.sessionId)) return res.status(400).json({ success: false, error: "Invalid submission ID." });
  try { return res.json({ success: true, ...await service.issueLivenessChallenge(req.params.sessionId) }); }
  catch (error) { return failure(res, error); }
}
async function processSelfie(req, res) {
  if (!validId(req.params.sessionId)) return res.status(400).json({ error: "Invalid submission ID." });
  const selfie = req.files?.selfie_front?.[0];
  const portrait = req.files?.portrait_image?.[0];
  const video = req.files?.liveness_video?.[0];
  if (!selfie || !portrait || !video) {
    return res.status(400).json({ error: "An uploaded portrait, live camera portrait, and liveness video are required." });
  }
  try { return res.json({ success: true, ...await service.processSelfie(req.params.sessionId, {
    frontBuffer: selfie.buffer, portraitBuffer: portrait.buffer,
    livenessVideoBuffer: video.buffer, videoType: video.mimetype,
  }) }); }
  catch (error) { return failure(res, error); }
}
async function getAnalysis(req, res) {
  if (!validId(req.params.sessionId)) return res.status(400).json({ error: "Invalid submission ID." });
  try {
    const row = await service.getSession(req.params.sessionId);
    if (!row) return res.status(404).json({ error: "Submission not found." });
    const { face_match_threshold } = await settings.getSettings();
    res.set("Cache-Control", "no-store");
    return res.json({ analysis: mapAnalysis(row, face_match_threshold) });
  } catch { return res.status(503).json({ error: "Analysis could not be loaded. Please retry." }); }
}
module.exports = { startWithDocument, submitPersonalInfo, issueLivenessChallenge, processSelfie, getAnalysis };
