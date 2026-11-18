const knownFalse = (value) => value === false;

export function assessVerification(data = {}) {
  const checks = data.documentChecks || {};
  const hardFailures = [];
  const reviewSignals = [];
  const missingChecks = [];

  if (knownFalse(checks.number_format_valid)) hardFailures.push("Document number format validation failed.");
  if (knownFalse(checks.checksum_valid)) hardFailures.push("Aadhaar checksum validation failed.");
  if (knownFalse(checks.document_type_matches)) hardFailures.push("Detected document type does not match the selected type.");
  if (checks.inconsistent_pages === true) hardFailures.push("Document pages contain inconsistent identity data.");

  if (data.faceSimilarity != null && data.faceIsMatch === false) {
    reviewSignals.push("Face similarity is below the configured comparison threshold.");
  }
  if (["suspicious", "forged"].includes(data.forgery?.decision)) {
    reviewSignals.push(`Existing experimental image heuristics returned "${data.forgery.decision}".`);
  }
  if (data.findings?.manually_entered_identity_fields === true) {
    reviewSignals.push("One or more identity fields were manually entered or edited.");
  }
  if (data.documentChecks?.is_test_document === true) {
    reviewSignals.push("The document is marked as a synthetic test fixture.");
  }

  if (data.documentChecks?.authority_verified !== true) {
    missingChecks.push("Government issuance was not verified.");
  }
  if (data.ocr?.status !== "complete") {
    missingChecks.push(`OCR is ${data.ocr?.status || "unavailable"}; review extracted fields.`);
  }
  if (data.faceSimilarity == null) missingChecks.push("Face comparison is unavailable.");
  if (!data.forgery) missingChecks.push("Document image heuristic analysis is unavailable.");
  const level = hardFailures.length ? "high"
    : missingChecks.length ? "manual_review"
      : reviewSignals.length ? "medium" : "low";
  const labels = {
    high: "High review priority",
    medium: "Medium risk",
    low: "Low risk",
    manual_review: "Manual review required",
  };
  const explanations = {
    high: "One or more deterministic validation checks failed. This is a review priority, not proof of fraud.",
    medium: "All required checks are present, but one or more review signals require human assessment.",
    low: "All configured checks are present and no review signals were returned. This is not an identity guarantee.",
    manual_review: "One or more verification components are unavailable or unimplemented; missing checks are not treated as passes.",
  };

  return { level, label: labels[level], explanation: explanations[level], hardFailures, reviewSignals, missingChecks };
}

export function verificationFindings(data = {}) {
  const checks = data.documentChecks || {};
  const items = [];
  const push = (component, status, explanation) => items.push({ component, status, explanation });
  const formatStatus = checks.number_format_valid == null ? "Not checked"
    : checks.number_format_valid ? "Passed" : "Needs review";

  push("Document validation", formatStatus, checks.number_format_valid === false
    ? "The extracted document number did not meet the expected format."
    : "Format checks validate structure only; they do not verify issuer authenticity.");
  push("OCR", data.ocr?.status || "Unavailable", data.ocr?.message || "OCR details are not available.");

  if (data.faceSimilarity == null) {
    push("Face comparison", "Unavailable", "No usable comparison score was returned.");
  } else {
    push("Face comparison", data.faceIsMatch ? "Meets configured threshold" : "Below configured threshold",
      `${Number(data.faceSimilarity * 100).toFixed(2)}% cosine similarity; this is not an identity probability.`);
  }

  const aiResults = ["document", "portrait"].flatMap(kind => {
    const result = data.aiImageAnalysis?.[kind];
    return (result?.images || []).map((image, index) => ({
      component: `AI generation (${kind}, ${index + 1})`,
      status: image.status || "Unavailable",
      explanation: image.ai_score == null
        ? image.error_message || "No score was returned."
        : `${Number(image.ai_score).toFixed(2)} / 100 experimental signal; not calibrated and excluded from the risk tier.`,
    }));
  });
  items.push(...aiResults);
  if (!aiResults.length) {
    push("AI generation", "Unavailable", "No model output was recorded; this experimental check is not an authenticity verdict.");
  }

  const heuristicScore = Number(data.forgery?.forgery_score);
  push("Image checks", data.forgery ? data.forgery.decision || "Analyzed" : "Unavailable",
    data.forgery
      ? `Experimental image heuristics returned ${data.forgery.forgery_score == null || !Number.isFinite(heuristicScore) ? "no score" : `${heuristicScore.toFixed(2)} / 100`}; this is not calibrated confidence.`
      : "No heuristic result was recorded.");
  if (checks.authority_verified !== true) {
    push("Issuer verification", "Not performed", "No government authority lookup is implemented.");
  }
  return items;
}
