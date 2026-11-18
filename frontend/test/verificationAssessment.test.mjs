import { test } from "node:test";
import assert from "node:assert/strict";
import { assessVerification } from "../lib/verificationAssessment.mjs";
import { createVerificationReportSections } from "../lib/verificationReport.mjs";

const complete = {
  id: "submission-id",
  status: "submitted",
  documentType: "PAN",
  documentNumber: "ABCDE1234F",
  documentChecks: { number_format_valid: true, document_type_matches: true, authority_verified: true },
  ocr: { status: "complete", fields: { full_name: "Test" }, lines: [{ confidence: 0.9 }] },
  faceSimilarity: 0.8,
  faceIsMatch: true,
  forgery: { decision: "genuine", forgery_score: 10, details: {} },
};

test("risk assessment distinguishes low, medium, high and incomplete evidence", () => {
  assert.equal(assessVerification(complete).level, "low");
  assert.equal(assessVerification({ ...complete, faceIsMatch: false }).level, "medium");
  assert.equal(assessVerification({ ...complete, documentChecks: { ...complete.documentChecks, number_format_valid: false } }).level, "high");
  const incomplete = assessVerification({ ...complete, faceSimilarity: null });
  assert.equal(incomplete.level, "manual_review");
  assert.ok(incomplete.missingChecks.some(item => item.includes("Face comparison")));
});

test("verification report masks document number and does not include raw OCR text", () => {
  const sections = createVerificationReportSections({
    ...complete,
    ocr: { ...complete.ocr, rawText: "private OCR text" },
  }, assessVerification(complete));
  const text = sections.flatMap(section => [section.heading, ...section.lines]).join("\n");
  assert.match(text, /ending 234F/);
  assert.doesNotMatch(text, /ABCDE1234F|private OCR text/);
  assert.doesNotMatch(text, /DocTamper|heatmap/);
});
