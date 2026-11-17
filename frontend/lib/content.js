/** SatarkID implemented capabilities, not accuracy claims. */
export const STATS = [
  { label: "Indian document types", value: 2, display: "2", suffix: "" },
  { label: "Analysis steps", value: 3, display: "3", suffix: "" },
  { label: "External OCR API calls", value: 0, display: "0", suffix: "", static: true },
  { label: "Review before decisions", value: 100, display: "Manual", suffix: "", static: true },
];
export const FEATURES = [
  { title: "Local document OCR", desc: "PaddleOCR reads printed English fields on Aadhaar and PAN. Review uncertain text and keep unreadable fields blank.", icon: "file-search", accent: "from-sky-400 to-brand-500" },
  { title: "Independent face analysis", desc: "Extract and compare document portraits locally, even when OCR is incomplete or unavailable.", icon: "scan-face", accent: "from-brand-400 to-sky-500" },
  { title: "Image-analysis findings", desc: "Inspect experimental compression, metadata and image checks. These signals do not establish authenticity.", icon: "shield-check", accent: "from-brand-500 to-brand-700" },
  { title: "Indian document fields", desc: "Handle masked Aadhaar, year-only birth dates, PAN syntax and Aadhaar checksum checks.", icon: "fingerprint", accent: "from-brand-500 to-blue-500" },
  { title: "Manual correction", desc: "Correct OCR fields or continue with missing text. Original extraction and manual edits remain distinguishable.", icon: "sparkles", accent: "from-brand-600 to-blue-600" },
  { title: "Case review", desc: "See document, face and OCR findings together. All cases require manual review; video and liveness are outside this prototype.", icon: "check-circle", accent: "from-sky-500 to-brand-600" },
];
export const HOW_IT_WORKS = [
  { step: "01", title: "Upload evidence", desc: "Select Aadhaar or PAN and upload an image or unlocked PDF of up to two pages.", icon: "file-search" },
  { step: "02", title: "Review extracted text", desc: "Review local OCR and the independently extracted document face. Leave unreadable details blank.", icon: "shield-check" },
  { step: "03", title: "Compare a portrait", desc: "Upload a reference portrait for local face comparison. A still image does not establish liveness.", icon: "scan-face" },
  { step: "04", title: "Inspect the findings", desc: "Review saved evidence and limitations. A matching face does not establish official authority or a legitimate demand.", icon: "check-circle" },
];
export const WHY_CHOOSE = [
  { title: "Built for Indian documents", desc: "Aadhaar and individual PAN fields, PDFs and masked-number support.", icon: "file-search" },
  { title: "Local inference", desc: "OCR and face models run on this machine after model download, without a cloud inference API.", icon: "shield-check" },
  { title: "Visible uncertainty", desc: "Missing OCR and absent document faces remain explicit findings rather than successful checks.", icon: "sparkles" },
  { title: "Research foundation", desc: "A document and face evidence module for studying digital-arrest fraud prevention.", icon: "check-circle" },
];
export const ENGINES = [
  { title: "Community Forensics", desc: "Experimental local AI-generation scores for document pages and the uploaded portrait.", icon: "sparkles" },
  { title: "PaddleOCR", desc: "Local text recognition and deterministic field parsing, with manual fallback.", icon: "file-search" },
  { title: "InsightFace", desc: "Document-face detection and portrait similarity, independent of OCR success.", icon: "scan-face" },
  { title: "Image heuristics", desc: "Experimental image checks presented for review, without claiming government verification.", icon: "shield-check" },
];
