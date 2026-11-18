const display = (value) => value == null || value === "" ? "Unavailable" : String(value);
const maskedNumber = (value) => value ? `ending ${String(value).slice(-4)}` : "Unavailable";

function aiLines(label, result) {
  if (!result) return [`${label}: Not analyzed.`];
  const lines = [
    `${label}: ${result.status || "Unavailable"}`,
    `Model: ${result.model_id || "Community Forensics"}; version: ${result.model_version || result.revision || "not recorded"}`,
    `ONNX Runtime: ${result.model_status?.runtime || "not recorded"} ${result.model_status?.runtime_version || ""}; provider: ${result.model_status?.execution_provider || "not recorded"}`,
  ];
  (result.images || []).forEach((image, index) => {
    lines.push(image.ai_score == null
      ? `Image ${index + 1}: unavailable (${image.error_code || image.status || "no result"}).`
      : `Image ${index + 1}: score ${Number(image.ai_score).toFixed(2)}/100; raw logit ${display(image.raw_logit)}; decision ${display(image.decision)}; inference ${display(image.inference_ms)} ms.`);
    (image.view_scores || []).forEach(view => {
      lines.push(`  ${view.view}: ${view.ai_score == null ? "unavailable" : `${Number(view.ai_score).toFixed(2)}/100`} (logit ${display(view.raw_logit)}).`);
    });
  });
  lines.push(`Limitations: ${result.limitation || "Experimental signal; not a calibrated probability."}`);
  return lines;
}

export function createVerificationReportSections(data = {}, assessment = {}) {
  const checks = data.documentChecks || {};
  const fields = data.fields || {};
  const ocr = data.ocr || {};
  const lines = ocr.lines || [];
  const meanConfidence = lines.length
    ? lines.reduce((sum, line) => sum + Number(line.confidence || 0), 0) / lines.length
    : null;
  const missingFields = ["full_name", "document_number", "date_of_birth", "year_of_birth", "gender"]
    .filter(field => !fields[field]);
  const ocrFields = ocr.fields || {};
  const forgery = data.forgery;
  const ai = data.aiImageAnalysis || {};

  return [
    { heading: "Verification summary", lines: [
      `Assessment: ${assessment.label || "Manual review required"}`,
      assessment.explanation || "Missing or unimplemented checks are not treated as successful.",
      `Submission: ${display(data.id)}`,
      `Created: ${display(data.createdAt)}`,
      `Generated: ${new Date().toISOString()}`,
      `Document: ${display(data.documentType)}; number ${maskedNumber(data.documentNumber)}`,
      `Overall status: ${display(data.status)}; analysis is not identity approval.`,
    ] },
    { heading: "Extracted identity fields", lines: [
      `Name: ${display(fields.full_name)}`,
      `OCR name: ${display(ocrFields.full_name)}`,
      `OCR document number: ${maskedNumber(ocrFields.document_number)}`,
      `Address (Aadhaar back page): ${display(fields.address || ocrFields.address)}`,
      `Date of birth: ${display(fields.date_of_birth || fields.year_of_birth)}`,
      `OCR date of birth / year: ${display(ocrFields.date_of_birth || ocrFields.year_of_birth)}`,
      `Gender: ${display(fields.gender)}`,
      `OCR gender: ${display(ocrFields.gender)}`,
      `Missing core fields: ${missingFields.length ? missingFields.join(", ") : "None"}`,
      `Format validation: ${checks.number_format_valid == null ? "Not checked" : checks.number_format_valid ? "Passed" : "Failed"}`,
      `Checksum validation: ${checks.checksum_valid == null ? "Not checked" : checks.checksum_valid ? "Passed" : "Failed"}`,
      `Document type check: ${checks.document_type_matches == null ? "Not checked" : checks.document_type_matches ? "Passed" : "Failed"}`,
      `Government issuance: ${checks.authority_verified === true ? "Verified" : "Not verified"}`,
      `OCR: ${display(ocr.status)}; provider ${display(ocr.provider)}; OCR lines ${lines.length}; average line confidence ${meanConfidence == null ? "unavailable" : `${(meanConfidence * 100).toFixed(1)}%`}.`,
      `OCR confidence is line-level only; it is not field-specific.`,
    ] },
    { heading: "Face comparison", lines: [
      `Face similarity: ${data.faceSimilarity == null ? "Unavailable" : `${(Number(data.faceSimilarity) * 100).toFixed(2)}%`}`,
      `Configured threshold: ${data.faceMatchThreshold == null ? "Unavailable" : `${(Number(data.faceMatchThreshold) * 100).toFixed(2)}%`}`,
      `Interpretation: ${data.faceSimilarity == null ? "No result" : data.faceIsMatch ? "Meets configured threshold" : "Below configured threshold"}; similarity is not an identity probability.`,
      `Document face detection confidence: ${display(data.faceEvidence?.document?.detectionConfidence)}`,
      `Portrait face detection confidence: ${display(data.faceEvidence?.portrait?.detectionConfidence)}`,
    ] },
    { heading: "Image checks", lines: [
      `Experimental heuristic decision: ${display(forgery?.decision)}`,
      `Heuristic score: ${forgery?.forgery_score == null ? "Unavailable" : `${Number(forgery.forgery_score).toFixed(2)}/100 (not calibrated confidence)`}`,
      `Heuristic processing time: ${display(forgery?.processing_time_ms)} ms`,
      ...Object.entries(forgery?.details || {}).map(([key, value]) => `${key}: ${typeof value === "number" ? value : JSON.stringify(value)}`),
    ] },
    { heading: "AI-generation analysis", lines: [
      ...aiLines("Document", ai.document),
      ...aiLines("Portrait", ai.portrait),
      "AI-generation outputs are experimental model signals, not calibrated probabilities and not issuer verification.",
    ] },
    { heading: "Risk findings and limitations", lines: [
      ...(assessment.hardFailures || []).map(value => `Validation failure: ${value}`),
      ...(assessment.reviewSignals || []).map(value => `Review signal: ${value}`),
      ...(assessment.missingChecks || []).map(value => `Unavailable check: ${value}`),
      "No arbitrary weighted total is used for this assessment. A missing check is not a pass.",
      "This report does not verify government issuance or certify identity. Review the original document and all available evidence.",
      "Generated locally in the browser. Handle this report as sensitive personal information.",
    ] },
  ];
}
