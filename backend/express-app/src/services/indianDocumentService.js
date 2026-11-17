const pool = require("./dbClient");
const axios = require("axios");
const FormData = require("form-data");

const isIndian = (type) => ["aadhaar", "pan"].includes(String(type || "").toLowerCase());
const clean = (value) => value == null ? "" : String(value).trim();
const normalizeNumber = (value) => clean(value).replace(/[\s-]/g, "").toUpperCase();

async function processDocument(sessionId, payload) {
  const body = new FormData();
  body.append("front_image", payload.frontBuffer, { filename: "document", contentType: "application/octet-stream" });
  if (payload.backBuffer) body.append("back_image", payload.backBuffer, { filename: "back", contentType: "application/octet-stream" });
  body.append("document_type", payload.documentType.toLowerCase());
  let data;
  try {
    const response = await axios.post(`${process.env.ML_SERVICE_URL || "http://127.0.0.1:8000"}/api/v1/documents/analyze-indian`, body,
      { headers: body.getHeaders(), timeout: 150000 });
    data = response.data;
  } catch (error) {
    throw Object.assign(new Error(error.response?.data?.detail || "Indian document processing failed. Please retry."),
      { statusCode: error.response?.status || 502 });
  }
  const fields = data.ocr.extracted_fields;
  const checks = data.ocr.validation;
  const riskFlags = { authority_verification_not_performed: true,
    document_format_issue: checks.number_format_valid === false,
    document_type_mismatch: checks.document_type_matches === false,
    inconsistent_document_pages: checks.inconsistent_pages,
    ocr_unavailable: data.ocr.status === "unavailable",
    ocr_incomplete: data.ocr.status !== "complete",
    aadhaar_checksum_issue: checks.checksum_valid === false,
    masked_document: checks.masked, synthetic_test_document: checks.is_test_document,
    document_face_unavailable: !data.face.embedding_saved,
    document_source_format: data.source_format, document_page_count: data.page_count,
  };
  if (data.face.is_duplicate) riskFlags.verified_face_exists = true;
  if (data.forgery.decision === "forged") riskFlags.forgery_detected = true;
  if (data.forgery.decision === "suspicious") riskFlags.forgery_suspicious = true;
  const riskScore = Math.min(100, (checks.number_format_valid === false ? 20 : 0) + (checks.checksum_valid === false ? 20 : 0)
    + (data.face.is_duplicate ? 40 : 0) + (data.forgery.decision === "forged" ? 50 : data.forgery.decision === "suspicious" ? 20 : 0));
  await pool.query(`UPDATE onboarding_sessions SET document_type=$1, document_number=$2,
    document_url=$3, document_back_url=$4, document_face_url=$5, ocr_result=$6::jsonb,
    forgery_result=$7::jsonb, ocr_name=$8, ocr_document_number=$2, risk_score=$9,
    risk_flags=$10::jsonb, kyc_submission_id=$11, indian_fields=$12::jsonb,
    document_checks=$13::jsonb, ai_image_result=$15::jsonb, status='step_2_complete' WHERE id=$14`,
    [payload.documentType, fields.document_number, data.document_url, data.document_back_url,
      data.face.face_image_url, JSON.stringify(data.ocr), JSON.stringify(data.forgery), fields.full_name || null,
      riskScore, JSON.stringify(riskFlags), data.face.embedding_saved ? data.face.submission_id : null,
      JSON.stringify(fields), JSON.stringify(checks), sessionId, JSON.stringify({ document: data.ai_images })]);
  return { ocrData: { name: fields.full_name, documentNumber: fields.document_number,
    documentType: data.ocr.document_type, extractedFields: fields, validation: checks,
    status: data.ocr.status, provider: data.ocr.provider, message: data.ocr.message },
    prefill: { fullName: fields.full_name || "", documentNumber: fields.document_number || "",
      dob: fields.date_of_birth || "", yearOfBirth: fields.year_of_birth ? String(fields.year_of_birth) : "",
      gender: fields.gender || "" },
    forgeryDecision: data.forgery.decision, forgeryScore: data.forgery.forgery_score,
    forgeryDetails: data.forgery, documentUrl: data.document_url, documentBackUrl: data.document_back_url,
    documentFaceUrl: data.face.face_image_url, riskFlags, riskScore };
}

function validateReview(form, documentType) {
  const number = normalizeNumber(form.documentNumber);
  const pattern = documentType.toLowerCase() === "aadhaar" ? /^(?:[2-9][0-9]{11}|[X*]{8}[0-9]{4})$/ : /^[A-Z]{3}P[A-Z][0-9]{4}[A-Z]$/;
  if (number && !pattern.test(number)) throw Object.assign(new Error("Enter a valid document-number format, or leave an unreadable number blank."), { statusCode: 422 });
  const dob = clean(form.dob);
  if (dob && (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || !Number.isFinite(Date.parse(dob)) || new Date(dob).toISOString().slice(0, 10) !== dob || Date.parse(dob) > Date.now())) {
    throw Object.assign(new Error("Enter a valid date of birth, or leave it blank when only the birth year is known."), { statusCode: 422 });
  }
  const year = clean(form.yearOfBirth);
  if (year && (!/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > new Date().getFullYear())) {
    throw Object.assign(new Error("Enter a valid birth year."), { statusCode: 422 });
  }
  return { number, dob, year };
}

async function submitReview(session, form) {
  const { number, dob, year } = validateReview(form, session.document_type);
  const original = session.ocr_result?.extracted_fields || {};
  const edited = { full_name: clean(form.fullName), document_number: number,
    date_of_birth: dob || null, year_of_birth: year ? Number(year) : null,
    dob_precision: dob ? "day" : year ? "year" : "unknown", gender: clean(form.gender) };
  const changed = number !== normalizeNumber(original.document_number) || clean(form.fullName).toLowerCase() !== clean(original.full_name).toLowerCase();
  const flags = { ...session.risk_flags, indian_identity_fields_edited: changed, authority_verification_not_performed: true,
    identity_fields_incomplete: !edited.full_name || !number,
    manually_entered_identity_fields: changed || session.ocr_result?.status !== "complete" };
  await pool.query(`UPDATE onboarding_sessions SET full_name=$1, dob=$2, gender=$3,
    document_number=$4, indian_fields=$5::jsonb, risk_flags=$6::jsonb, status='step_2_complete'
    WHERE id=$7`, [edited.full_name, dob || null, edited.gender || null, number, JSON.stringify(edited), JSON.stringify(flags), session.id]);
  return { riskFlags: flags, riskScore: session.risk_score, editComparison: { flags: { indian_identity_fields_edited: changed }, score: 0 } };
}
module.exports = { isIndian, processDocument, submitReview, validateReview };
