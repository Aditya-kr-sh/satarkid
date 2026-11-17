const pool = require("./dbClient");
const settingsService = require("./settingsService");
const { uploadBuffer } = require("./storageService");
const { randomInt } = require("node:crypto");
const FormData = require("form-data");
const axios = require("axios");
const documents = require("./indianDocumentService");
const aiImages = require("./aiImageService");
const ML_URL = process.env.ML_SERVICE_URL || "http://127.0.0.1:8000";

class OnboardingService {
  async assertReady() {
    try {
      const response = await axios.get(`${ML_URL}/api/v1/ready`, { timeout: 5000, validateStatus: () => true });
      if (response.status !== 200) throw new Error("Document analysis is not ready. Check the database, storage, face model and liveness model.");
      await pool.query("SELECT 1 FROM onboarding_sessions LIMIT 1");
    } catch (error) {
      throw Object.assign(new Error(error.response ? "Analysis service is unavailable." : error.message), { statusCode: 503 });
    }
  }

  async createSessionShell() {
    const { rows } = await pool.query("INSERT INTO onboarding_sessions (full_name, risk_score, risk_flags, status) VALUES ('', 0, '{}'::jsonb, 'step_1_document') RETURNING id");
    return rows[0].id;
  }

  async getSession(id) {
    const { rows } = await pool.query("SELECT * FROM onboarding_sessions WHERE id=$1", [id]);
    return rows[0] || null;
  }

  async issueLivenessChallenge(id) {
    const session = await this.getSession(id);
    if (!session) throw Object.assign(new Error("Submission not found."), { statusCode: 404 });
    if (!documents.isIndian(session.document_type)) throw Object.assign(new Error("Upload a document first."), { statusCode: 409 });
    const challenge = randomInt(2) === 0 ? "turn_left" : "turn_right";
    const { rowCount } = await pool.query(`UPDATE onboarding_sessions
      SET risk_flags=COALESCE(risk_flags, '{}'::jsonb) || jsonb_build_object(
        'liveness_challenge', $1::text,
        'liveness_challenge_expires_at', to_jsonb(now() + INTERVAL '2 minutes'))
      WHERE id=$2`, [challenge, id]);
    if (!rowCount) throw Object.assign(new Error("Submission not found."), { statusCode: 404 });
    return { challenge, expiresInSeconds: 120 };
  }

  async consumeLivenessChallenge(id) {
    const { rows } = await pool.query(`WITH challenge AS (
      SELECT id, risk_flags->>'liveness_challenge' AS value
      FROM onboarding_sessions
      WHERE id=$1
        AND risk_flags->>'liveness_challenge' IN ('turn_left', 'turn_right')
        AND (risk_flags->>'liveness_challenge_expires_at')::timestamptz > now()
      FOR UPDATE
    )
    UPDATE onboarding_sessions AS session
    SET risk_flags=COALESCE(session.risk_flags, '{}'::jsonb)
      - 'liveness_challenge' - 'liveness_challenge_expires_at'
    FROM challenge
    WHERE session.id=challenge.id
    RETURNING challenge.value AS liveness_challenge`, [id]);
    if (!rows[0]) {
      throw Object.assign(new Error("Liveness challenge expired. Start a new check and try again."), { statusCode: 409 });
    }
    return rows[0].liveness_challenge;
  }

  async processDocument(id, payload) {
    if (!documents.isIndian(payload.documentType)) throw Object.assign(new Error("Select Aadhaar or PAN."), { statusCode: 400 });
    return documents.processDocument(id, payload);
  }

  async submitPersonalInfo(id, form) {
    const session = await this.getSession(id);
    if (!session) throw Object.assign(new Error("Submission not found."), { statusCode: 404 });
    if (!documents.isIndian(session.document_type)) throw Object.assign(new Error("Upload an Aadhaar or PAN document first."), { statusCode: 409 });
    return documents.submitReview(session, form);
  }

  async _compareFaceToDocument(buffer, submissionId, threshold) {
    const form = new FormData();
    form.append("selfie_image", buffer, { filename: "portrait.jpg", contentType: "image/jpeg" });
    form.append("submission_id", submissionId);
    form.append("match_threshold", String(threshold));
    try {
      const { data } = await axios.post(`${ML_URL}/api/v1/face/compare`, form, { headers: form.getHeaders(), timeout: 120000 });
      return data;
    } catch { return null; }
  }

  async _verifyLiveness(videoBuffer, videoType, challenge) {
    const form = new FormData();
    const extension = videoType === "video/mp4" ? "mp4" : videoType === "video/quicktime" ? "mov" : "webm";
    form.append("video", videoBuffer, { filename: `liveness.${extension}`, contentType: videoType });
    form.append("challenge", challenge);
    try {
      const { data, status } = await axios.post(`${ML_URL}/api/v1/face/liveness`, form, {
        headers: form.getHeaders(), timeout: 90000, validateStatus: () => true,
      });
      if (status >= 500) throw Object.assign(new Error("Liveness analysis service is unavailable."), { statusCode: 502 });
      return data;
    } catch (error) {
      if (error.statusCode) throw error;
      throw Object.assign(new Error("Liveness analysis service is unavailable."), { statusCode: 502 });
    }
  }

  async processSelfie(id, { frontBuffer, livenessVideoBuffer, videoType }) {
    if (!frontBuffer || !livenessVideoBuffer) {
      throw Object.assign(new Error("Complete the camera liveness check before submitting a portrait."), { statusCode: 400 });
    }
    const session = await this.getSession(id);
    if (!session) throw Object.assign(new Error("Submission not found."), { statusCode: 404 });
    if (!documents.isIndian(session.document_type)) throw Object.assign(new Error("Upload a document first."), { statusCode: 409 });
    const challenge = await this.consumeLivenessChallenge(id);
    const liveness = await this._verifyLiveness(livenessVideoBuffer, videoType, challenge);
    if (!liveness?.liveness_confirmed) {
      throw Object.assign(new Error(liveness?.error || "Liveness could not be confirmed. Please try again."), { statusCode: 422 });
    }
    const { face_match_threshold: threshold } = await settingsService.getSettings();
    const [selfieUrl, portraitAi, comparison] = await Promise.all([
      uploadBuffer(frontBuffer), aiImages.analyzePortrait(frontBuffer),
      session.kyc_submission_id ? this._compareFaceToDocument(frontBuffer, session.kyc_submission_id, threshold) : Promise.resolve(null),
    ]);
    if (session.kyc_submission_id && (!comparison || (comparison.face_found && !Number.isFinite(comparison.similarity_score)))) {
      throw Object.assign(new Error("Face comparison is unavailable. Check the analysis service and saved embedding."), { statusCode: 502 });
    }
    const similarity = comparison?.similarity_score ?? null;
    const flags = { ...session.risk_flags, liveness_confirmed: true, verification_mode: "active_liveness" };
    // Replacing a portrait must replace its findings instead of accumulating them.
    for (const key of ["face_similarity", "face_mismatch", "face_uncertain", "no_face_in_selfie",
      "face_comparison_skipped", "liveness_not_performed", "liveness_challenge",
      "liveness_challenge_expires_at"]) delete flags[key];
    if (similarity != null) {
      flags.face_similarity = similarity;
      if (similarity < Math.max(threshold - 0.15, 0.35)) flags.face_mismatch = true;
      else if (similarity < threshold) flags.face_uncertain = true;
    } else if (!session.kyc_submission_id) flags.face_comparison_skipped = true;
    else flags.no_face_in_selfie = true;
    await pool.query(`UPDATE onboarding_sessions SET selfie_url=$1, face_similarity=$2, risk_flags=$3::jsonb,
      ai_image_result=COALESCE(ai_image_result,'{}'::jsonb) || $4::jsonb, face_match_threshold=$5, status='submitted' WHERE id=$6`,
      [selfieUrl, similarity, JSON.stringify(flags), JSON.stringify({ portrait: portraitAi }), threshold, id]);
    return { selfieUrl, faceSimilarity: similarity, livenessConfirmed: true, isMatch: similarity == null ? null : similarity >= threshold,
      riskFlags: flags, outcome: "pending", status: "submitted" };
  }
}
module.exports = new OnboardingService();
