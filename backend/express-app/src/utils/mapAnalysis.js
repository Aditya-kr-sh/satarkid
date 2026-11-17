
const CORE_FIELDS = ["full_name", "document_number", "date_of_birth", "year_of_birth", "dob_precision", "gender"];
function coreFields(fields = {}) {
  return Object.fromEntries(CORE_FIELDS.map(key => [key, fields[key] ?? null]));
}

function mapAnalysis(row, threshold) {
  const mapped = {
    id: row.id, name: row.full_name || row.ocr_name || "Your document analysis", dbStatus: row.status,
    createdAt: row.created_at, documentType: row.document_type, documentNumber: row.document_number,
    indianFields: row.indian_fields || {}, documentChecks: row.document_checks || {}, riskFlags: row.risk_flags || {},
    ocrData: row.ocr_result ? { status: row.ocr_result.status, provider: row.ocr_result.provider,
      message: row.ocr_result.message, extractedFields: row.ocr_result.extracted_fields || {} } : null,
    documentUrl: row.document_url, documentBackUrl: row.document_back_url, documentFaceUrl: row.document_face_url,
    selfieUrl: row.selfie_url, faceSimilarity: row.face_similarity ?? null,
    faceIsMatch: row.face_similarity == null ? null : Number(row.face_similarity) >= threshold,
    comparisonThresholdUsed: row.face_match_threshold, forgeryDetails: row.forgery_result || null,
    aiImageAnalysis: row.ai_image_result || {},
  };
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
      message: mapped.ocrData.message, fields: coreFields(mapped.ocrData.extractedFields) } : null,
    documentUrl: mapped.documentUrl, documentBackUrl: mapped.documentBackUrl,
    documentFaceUrl: mapped.documentFaceUrl, portraitUrl: mapped.selfieUrl,
    faceSimilarity: mapped.faceSimilarity, faceIsMatch: mapped.faceIsMatch,
    faceMatchThreshold: threshold, comparisonThresholdUsed: mapped.comparisonThresholdUsed,
    forgery: mapped.forgeryDetails, aiImageAnalysis: mapped.aiImageAnalysis,
    findings: Object.fromEntries(Object.entries(flags).filter(([, value]) => value === true)),
  };
}
module.exports = { mapAnalysis, coreFields };
