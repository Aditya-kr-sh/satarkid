
// Address is the printed block from an Aadhaar back page; raw OCR text, device and
// IP data are still never returned by this endpoint.
const CORE_FIELDS = ["full_name", "document_number", "address", "date_of_birth", "year_of_birth", "dob_precision", "gender"];
function coreFields(fields = {}) {
  return Object.fromEntries(CORE_FIELDS.map(key => [key, fields[key] ?? null]));
}

function finiteNumber(value) {
  const number = Number(value);
  return value == null || !Number.isFinite(number) ? null : number;
}

function boxValues(value) {
  const values = Array.isArray(value) ? value
    : value && typeof value === "object" ? ["x1", "y1", "x2", "y2"].map(key => value[key])
      : null;
  if (!values || values.length !== 4 || values.some(value => finiteNumber(value) == null)) return null;
  const [x1, y1, x2, y2] = values.map(Number);
  return x2 > x1 && y2 > y1 ? { x1, y1, x2, y2 } : null;
}

function ocrLines(lines = []) {
  if (!Array.isArray(lines)) return [];
  return lines.flatMap(line => {
    const box = boxValues(line?.box);
    const page = Number(line?.page);
    const confidence = finiteNumber(line?.confidence);
    if (!box || !Number.isInteger(page) || page < 0 || confidence == null) return [];
    return [{ box, page, confidence }];
  });
}

function mapAnalysis(row, threshold) {
  const mapped = {
    id: row.id, name: row.full_name || row.ocr_name || "Your document analysis", dbStatus: row.status,
    createdAt: row.created_at, documentType: row.document_type, documentNumber: row.document_number,
    indianFields: row.indian_fields || {}, documentChecks: row.document_checks || {}, riskFlags: row.risk_flags || {},
    ocrData: row.ocr_result ? { status: row.ocr_result.status, provider: row.ocr_result.provider,
      message: row.ocr_result.message, extractedFields: row.ocr_result.extracted_fields || {},
      confidenceScore: row.ocr_result.confidence_score ?? null, validation: row.ocr_result.validation || {},
      lines: ocrLines(row.ocr_result.lines) } : null,
    documentUrl: row.document_url, documentBackUrl: row.document_back_url, documentFaceUrl: row.document_face_url,
    selfieUrl: row.selfie_url, faceSimilarity: row.face_similarity ?? null,
    faceIsMatch: row.face_similarity == null ? null : Number(row.face_similarity) >= threshold,
    comparisonThresholdUsed: row.face_match_threshold, forgeryDetails: row.forgery_result || null,
    aiImageAnalysis: row.ai_image_result || {},
  };
  const livenessStatus = mapped.riskFlags.liveness_confirmed
    ? "confirmed"
    : mapped.riskFlags.liveness_not_performed ? "not_performed" : "not_recorded";
  // Interpret old and new comparisons at the displayed threshold. Keep saved
  // risk scores/history unchanged; this evidence view makes no approval decision.
  const flags = { ...mapped.riskFlags };
  delete flags.face_mismatch;
  delete flags.face_uncertain;
  if (mapped.faceSimilarity != null) {
    if (mapped.faceSimilarity < Math.max(threshold - 0.15, 0.35)) flags.face_mismatch = true;
    else if (mapped.faceSimilarity < threshold) flags.face_uncertain = true;
  }
  return {
    id: mapped.id, name: mapped.name, status: mapped.dbStatus, createdAt: mapped.createdAt,
    documentType: mapped.documentType, documentNumber: mapped.documentNumber,
    fields: coreFields(mapped.indianFields), documentChecks: mapped.documentChecks,
    ocr: mapped.ocrData ? { status: mapped.ocrData.status, provider: mapped.ocrData.provider,
      message: mapped.ocrData.message, fields: coreFields(mapped.ocrData.extractedFields),
      confidenceScore: finiteNumber(mapped.ocrData.confidenceScore),
      validation: mapped.ocrData.validation, lines: mapped.ocrData.lines } : null,
    documentUrl: mapped.documentUrl, documentBackUrl: mapped.documentBackUrl,
    documentFaceUrl: mapped.documentFaceUrl, portraitUrl: mapped.selfieUrl,
    livenessStatus,
    liveness: {
      status: livenessStatus,
      method: mapped.riskFlags.verification_mode === "active_liveness"
        ? "InsightFace 3D-landmark head-turn challenge" : null,
      challenge: mapped.riskFlags.liveness_challenge_completed || null,
      challengeResult: mapped.riskFlags.liveness_challenge_result || null,
      faceDetectionStatus: mapped.riskFlags.liveness_face_detection_status || null,
      faceDetectedFrames: finiteNumber(mapped.riskFlags.liveness_face_detected_frames),
      sampledFrames: finiteNumber(mapped.riskFlags.liveness_sampled_frames),
      verifiedAt: mapped.riskFlags.liveness_verified_at || null,
      confidence: null,
    },
    faceEvidence: {
      document: {
        detectionConfidence: finiteNumber(row.document_face_detection_confidence),
        region: boxValues(row.document_face_region),
      },
      portrait: {
        detectionConfidence: finiteNumber(mapped.riskFlags.portrait_face_detection_confidence),
        region: boxValues(mapped.riskFlags.portrait_face_region),
      },
    },
    faceSimilarity: mapped.faceSimilarity, faceIsMatch: mapped.faceIsMatch,
    faceMatchThreshold: threshold, comparisonThresholdUsed: mapped.comparisonThresholdUsed,
    forgery: mapped.forgeryDetails, aiImageAnalysis: mapped.aiImageAnalysis,
    findings: Object.fromEntries(Object.entries(flags).filter(([, value]) => value === true)),
  };
}
module.exports = { mapAnalysis, coreFields };
