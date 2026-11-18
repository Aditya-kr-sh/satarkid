"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { API_BASE_URL } from "@/lib/api";
import { aiScorePercent, aiScoreWidth } from "@/lib/aiImageScore.mjs";
import { assessVerification, verificationFindings } from "@/lib/verificationAssessment.mjs";
import { createVerificationReportSections } from "@/lib/verificationReport.mjs";
import Logo from "../../components/ui/Logo";
import ThemeToggle from "../../components/ThemeToggle";

const FIELD_NAMES = { full_name: "Full name", document_number: "Document number", address: "Address (Aadhaar back page)",
  date_of_birth: "Date of birth", year_of_birth: "Year of birth", gender: "Gender" };
const IMAGE_CHECKS = [
  ["ela_score", "Compression differences", "Uneven JPEG compression can come from edits, scans or repeated saving."],
  ["edge_inconsistency_score", "Edge variation", "Text, portraits and borders naturally have different edges."],
  ["noise_score", "Noise pattern", "Noise changes can reflect capture quality or image processing."],
  ["exif_anomaly_score", "Image metadata", "Normalization and PDF rendering can strip metadata."],
  ["copy_move_score", "Repeated image regions", "Repeated patterns may be ordinary document design."],
  ["font_consistency_score", "Text-size variation", "Different languages and headings can trigger this signal."],
];
const percent = value => Number.isFinite(Number(value)) && value != null ? `${(Number(value) * 100).toFixed(1)}%` : "Unavailable";
const fieldValue = value => value == null || value === "" ? "Not provided" : String(value);

function Card({ title, children, className = "" }) {
  return <section className={`rounded-2xl border border-slate-200 bg-white p-6 shadow-sm ${className}`}>
    <h2 className="mb-4 text-base font-semibold text-slate-900">{title}</h2>{children}
  </section>;
}
function FieldList({ fields = {} }) {
  const rows = Object.entries(FIELD_NAMES).filter(([key]) => key !== "address" || fields.address);
  return <dl className="space-y-3">{rows.map(([key, label]) =>
    <div key={key} className="flex justify-between gap-6 border-b border-slate-100 pb-3 text-sm last:border-0">
      <dt className="text-slate-500">{label}</dt><dd className="text-right font-medium break-words">{fields[key] || "Not provided"}</dd>
    </div>)}</dl>;
}
function EvidenceImage({ title, url, regions = [], coordinateMode = "xyxy", page = 0 }) {
  const [dimensions, setDimensions] = useState(null);
  return <Card title={title}>{url ? <>
    <div className="relative w-full overflow-hidden rounded-lg bg-slate-50"
      style={{ aspectRatio: dimensions ? `${dimensions.width} / ${dimensions.height}` : "4 / 3" }}>
      <Image src={url} alt={title} fill sizes="(max-width: 768px) 100vw, 50vw" unoptimized
        className="object-contain" onLoad={event => setDimensions({
          width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight,
        })} />
      {dimensions && regions.filter(region => region.page == null || region.page === page).slice(0, 200).map((region, index) => {
        const values = Array.isArray(region.box) ? region.box
          : region.box && ["x1", "y1", "x2", "y2"].map(key => region.box[key]);
        if (!values || values.length !== 4 || values.some(value => !Number.isFinite(Number(value)))) return null;
        const [x, y, x2, y2] = values.map(Number);
        const right = coordinateMode === "xywh" ? x + x2 : x2;
        const bottom = coordinateMode === "xywh" ? y + y2 : y2;
        if (right <= x || bottom <= y) return null;
        return <span key={`${region.label || "region"}-${index}`} role="img"
          aria-label={region.label || `Evidence region ${index + 1}`}
          title={region.label || `Evidence region ${index + 1}`}
          className={`absolute border-2 ${region.kind === "tamper" ? "border-amber-500" : region.kind === "face" ? "border-emerald-500" : "border-sky-500"}`}
          style={{ left: `${x / dimensions.width * 100}%`, top: `${y / dimensions.height * 100}%`,
            width: `${(right - x) / dimensions.width * 100}%`, height: `${(bottom - y) / dimensions.height * 100}%` }} />;
      })}
    </div>
    <a className="mt-3 block text-xs text-blue-700" href={url} target="_blank" rel="noreferrer">Open image</a>
  </> : <p className="text-sm text-slate-500">No image available.</p>}</Card>;
}
function FaceSummary({ data }) {
  const available = data.faceSimilarity != null;
  const threshold = data.faceMatchThreshold == null ? null : Number(data.faceMatchThreshold);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-4xl font-semibold">{percent(data.faceSimilarity)}</p>
      <span className={`rounded-full px-3 py-1 text-sm ${!available ? "bg-slate-100" : data.faceIsMatch ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-900"}`}>
        {!available ? "Comparison unavailable" : data.faceIsMatch ? "Meets match threshold" : "Below match threshold"}
      </span>
    </div>
    <div className="relative h-3 rounded-full bg-slate-100">
      {available && <div className={`h-3 rounded-full ${data.faceIsMatch ? "bg-blue-500" : "bg-amber-400"}`} style={{ width: `${Math.min(100, Math.max(0, data.faceSimilarity * 100))}%` }} />}
      {threshold != null && Number.isFinite(threshold) && <div className="absolute inset-y-0 border-l-2 border-dashed border-slate-600" style={{ left: `${Math.min(100, Math.max(0, threshold * 100))}%` }} />}
    </div>
    <p className="text-sm text-slate-600">Match threshold: <strong>{percent(data.faceMatchThreshold)}</strong></p>
    <div className="grid gap-2 text-sm sm:grid-cols-2">
      <p>Document face detection confidence: <strong>{percent(data.faceEvidence?.document?.detectionConfidence)}</strong></p>
      <p>Portrait face detection confidence: <strong>{percent(data.faceEvidence?.portrait?.detectionConfidence)}</strong></p>
    </div>
    <p className="text-sm text-slate-600">Image-quality metrics: unavailable; this pipeline does not calculate them.</p>
    <p className="text-xs leading-relaxed text-slate-500">InsightFace cosine similarity is a comparison score, not the probability of identity. The 50% threshold is an experimental setting, not a calibrated accuracy claim.</p>
  </div>;
}
function AiSection({ analysis }) {
  const groups = [["Document", analysis?.document], ["Portrait", analysis?.portrait]];
  const source = groups.find(([, result]) => result?.model_url || result?.model_status || result?.model_version)?.[1];
  return <div className="space-y-5">
    <div className="rounded-xl border border-violet-200 bg-violet-50 p-5 text-sm leading-relaxed text-violet-950">
      <strong>Experimental AI-generation signal.</strong>{" "}Scores describe the model&apos;s response, not a calibrated probability that an image was AI-generated. Aadhaar/PAN scans are outside its validated use. A low score does not prove authenticity. These results add no fraud-risk points.
    </div>
    <div className="grid gap-5 md:grid-cols-2">{groups.map(([label, result]) =>
      <Card key={label} title={`${label} AI-image analysis`}>
        {!result?.images?.length ? <p className="text-sm text-slate-500">Not analyzed for this submission. Submit a new case to run this check.</p> :
          <>
            {label === "Portrait" && result.image_url ? <a href={result.image_url} target="_blank" rel="noreferrer">
              <Image src={result.image_url} alt="Portrait analyzed for AI-generation signals" width={640} height={480} unoptimized
                className="mb-4 max-h-80 w-full rounded-lg bg-slate-50 object-contain" />
              <span className="mb-4 block text-xs text-blue-700">Open analyzed photo</span>
            </a> : label === "Portrait" && <p className="mb-4 text-sm text-slate-500">
              The source photo was not saved for this older result.
            </p>}
            {result.model_status && result.model_status.state !== "ready" && <p role="status" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              AI detector {result.model_status.state}: {result.model_status.message || "No score is available; other analysis continues."}
            </p>}
            {result.images.map((item, index) => {
              const score = aiScorePercent(item.ai_score);
              const scoreIsValid = score !== null;
              const [uncertainLow, uncertainHigh] = result.uncertain_score_range || [45, 55];
              const decision = item.decision || (score >= uncertainLow && score <= uncertainHigh
                ? "uncertain" : score > uncertainHigh ? "higher_ai_signal" : "lower_ai_signal");
              const decisionText = decision === "uncertain"
                ? "Uncertain: near the model's 50-point decision threshold"
                : decision === "higher_ai_signal" ? "Higher model signal" : "Lower model signal; this does not prove authenticity";
              return <div key={index} className="mb-5 last:mb-0">
                <p className="text-sm text-slate-500">{label === "Document" ? `Document page ${index + 1}` : "Uploaded portrait"}</p>
                {item.status === "complete" && scoreIsValid ? <>
                  <p className="mt-2 text-4xl font-semibold text-violet-700">{score < 0.01 ? "<0.01" : score > 99.99 ? ">99.99" : score.toFixed(2)}<span className="text-lg text-slate-400"> / 100</span></p>
                  <p className="mt-1 text-xs text-slate-600">{item.view_scores?.length ? "Highest AI-generation signal across up to five document views" : "AI-generation model score"}</p>
                  <p className="mt-1 text-xs text-slate-600">{decisionText}</p>
                  {item.raw_logit != null && Number.isFinite(Number(item.raw_logit)) && <p className="mt-1 text-xs text-slate-500">Raw model logit: {Number(item.raw_logit).toFixed(4)}</p>}
                  {item.inference_ms != null && Number.isFinite(Number(item.inference_ms)) && <p className="mt-1 text-xs text-slate-500">Preprocessing + inference: {Number(item.inference_ms).toFixed(0)} ms</p>}
                  {item.view_scores?.length > 0 && <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    View scores: {item.view_scores.map(view => `${view.view.replaceAll("_", " ")} ${Number(view.ai_score).toFixed(2)}`).join(" · ")}
                  </p>}
                  <div className="mt-3 h-2 rounded-full bg-slate-200" role="progressbar" aria-label="AI-generation signal score"
                    aria-valuemin={0} aria-valuemax={100} aria-valuenow={score}>
                    <div className="h-2 rounded-full bg-violet-500" style={{ width: aiScoreWidth(score) }} />
                  </div>
                </> : <p role="status" className="mt-2 text-sm text-amber-800">
                  {item.error_message || (item.status === "complete"
                    ? "The detector returned an invalid score; no result was assigned."
                    : "Detector unavailable. No score was assigned; other analysis continues.")}
                  {item.error_code && <span className="ml-1 text-xs text-amber-700">({item.error_code})</span>}
                </p>}
              </div>;
            })}
          </>}
      </Card>)}</div>
    <Card title="Model and interpretation">
      <p className="text-sm text-slate-600">Community Forensics · Vision Transformer (ViT) · local ONNX FP32. Each document page and the separately uploaded portrait are scored independently.</p>
      <p className="mt-2 text-sm text-slate-600">Model version: {source?.model_version || source?.revision || "not recorded"}</p>
      <p className="mt-2 text-sm text-slate-600">Runtime: {source?.model_status?.runtime || "ONNX Runtime"} {source?.model_status?.runtime_version || "version not recorded"} · provider: {source?.model_status?.execution_provider || "not recorded"}</p>
      <p className="mt-2 text-sm text-slate-600">Request inference time: {source?.inference_ms == null ? "Unavailable" : `${Number(source.inference_ms).toFixed(0)} ms`}</p>
      {source?.model_status?.message && source.model_status.state !== "ready" && !source.images?.length &&
        <p role="status" className="mt-2 text-sm text-amber-800">{source.model_status.message}</p>}
      <p className="mt-2 text-sm text-slate-600">For document pages, the detector examines the center and four overlapping corner views, and displays the highest signal. This improves page coverage but can increase false positives. Scans, text layouts, compression and cropping can produce misleading scores. It does not locate edits or verify the document issuer.</p>
      {source?.model_url && <a className="mt-3 inline-block text-sm text-blue-700 underline" href={source.model_url} target="_blank" rel="noreferrer">Pinned model and limitations</a>}
    </Card>
  </div>;
}

function SummaryCard({ title, value, detail, onClick }) {
  return <button type="button" onClick={onClick}
    className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-blue-300">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
    <p className="mt-2 text-lg font-semibold capitalize">{value}</p>
    <p className="mt-2 text-sm leading-relaxed text-slate-600">{detail}</p>
  </button>;
}

function FieldComparison({ data }) {
  const values = data.fields || {};
  const extracted = data.ocr?.fields || {};
  const validation = data.documentChecks || {};
  const rows = Object.entries(FIELD_NAMES).filter(([key]) => key !== "address" || values[key] || extracted[key]);
  const validationStatus = key => {
    if (key === "document_number") {
      if (validation.number_format_valid === false || validation.checksum_valid === false) return "Needs review";
      if (validation.number_format_valid === true) return "Format passed";
      return "Not validated";
    }
    return "Not validated";
  };
  const sameValue = (left, right) => String(left ?? "").trim().toLowerCase() === String(right ?? "").trim().toLowerCase();
  return <Card title="Field review and OCR differences" className="md:col-span-2">
    <p className="mb-4 text-sm text-slate-600">Field-specific OCR confidence and correction history are not stored. Differences below compare the submitted value with OCR output only.</p>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead><tr className="border-b border-slate-200 text-slate-500"><th className="py-2 pr-4">Field</th><th className="py-2 pr-4">Submitted</th><th className="py-2 pr-4">OCR output</th><th className="py-2 pr-4">Comparison</th><th className="py-2">Validation</th></tr></thead>
        <tbody>{rows.map(([key, label]) => {
          const current = values[key];
          const original = extracted[key];
          const comparable = current != null && current !== "" && original != null && original !== "";
          const comparison = comparable
            ? sameValue(current, original) ? "Matches OCR" : "Differs from OCR; edit attribution unavailable"
            : current || original ? "Insufficient OCR data to compare" : "Missing";
          return <tr key={key} className="border-b border-slate-100 last:border-0">
            <th className="py-3 pr-4 font-medium">{label}</th>
            <td className="max-w-64 break-words py-3 pr-4">{fieldValue(current)}</td>
            <td className="max-w-64 break-words py-3 pr-4">{fieldValue(original)}</td>
            <td className="max-w-64 py-3 pr-4 text-slate-600">{comparison}</td>
            <td className="py-3 text-slate-600">{validationStatus(key)}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <p className="mt-4 text-sm text-slate-600">Missing fields: {rows.filter(([key]) => key !== "address" && !values[key]).map(([, label]) => label).join(", ") || "None"}</p>
    <p className="mt-2 text-sm text-slate-600">OCR line confidence: {data.ocr?.lines?.length
      ? `${(data.ocr.lines.reduce((sum, line) => sum + line.confidence, 0) / data.ocr.lines.length * 100).toFixed(1)}% average across ${data.ocr.lines.length} recognized text lines`
      : "Unavailable"}; this is not field-level confidence.</p>
  </Card>;
}

function ImageChecksSection({ data }) {
  return <div className="space-y-5">
    <Card title="Experimental image heuristics">
      <p className="text-4xl font-semibold">{data.forgery?.forgery_score == null ? "Unavailable" : Number(data.forgery.forgery_score).toFixed(2)}<span className="text-lg text-slate-400"> / 100</span></p>
      <p className="mt-3 text-sm text-slate-600">A composite of image checks on the normalized document page. It is not a probability of forgery, an AI-generation detector, or proof of government issuance.</p>
    </Card>
    <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{IMAGE_CHECKS.map(([key, title, description]) =>
      <Card key={key} title={title}>
        <p className="text-2xl font-semibold">{data.forgery?.details?.[key] == null ? "Unavailable" : `${Number(data.forgery.details[key]).toFixed(1)} / 100`}</p>
        <p className="mt-3 text-sm text-slate-500">{description}</p>
      </Card>)}</div>
  </div>;
}

async function downloadVerificationPdf(data, assessment) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const sections = createVerificationReportSections(data, assessment);
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  let y = 44;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.text("SatarkID Verification Report", 40, y);
  y += 28;
  for (const section of sections) {
    if (y > pageHeight - 60) { pdf.addPage(); y = 44; }
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);
    pdf.text(section.heading, 40, y);
    y += 18;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    for (const line of section.lines) {
      const wrapped = pdf.splitTextToSize(String(line), pageWidth - 80);
      for (const item of wrapped) {
        if (y > pageHeight - 40) { pdf.addPage(); y = 44; }
        pdf.text(item, 40, y);
        y += 12;
      }
    }
    y += 10;
  }
  pdf.save(`satarkid-verification-${data.id || "report"}.pdf`);
}

export default function AnalysisPage() {
  const { id } = useParams();
  return <SubmissionAnalysis key={id} id={id} />;
}

function SubmissionAnalysis({ id }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [reportError, setReportError] = useState("");
  const [reportStatus, setReportStatus] = useState("");
  const [tab, setTab] = useState("overview");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/onboarding/session/${encodeURIComponent(id)}/analysis`, { cache: "no-store", signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not load analysis."); return body.analysis; })
      .then(setData).catch(err => { if (err.name !== "AbortError") setError(err.message); });
    return () => controller.abort();
  }, [id, attempt]);
  const tabs = [["overview", "Overview"], ["document", "Document & OCR"], ["forgery", "Image Checks"],
    ["face", "Face Comparison"], ["ai", "AI Generation"], ["risk", "Risk & Findings"]];
  const assessment = data ? assessVerification(data) : null;
  const allAiImages = ["document", "portrait"].flatMap(key => data?.aiImageAnalysis?.[key]?.images || []);
  const aiAvailable = allAiImages.some(item => item.status === "complete" && item.ai_score != null);
  const aiUnavailable = allAiImages.some(item => item.status === "unavailable");
  const aiStatus = aiAvailable ? "Experimental signal available" : aiUnavailable ? "Unavailable" : "Not analyzed";
  const checks = data?.documentChecks || {};
  const documentNeedsReview = [checks.number_format_valid, checks.checksum_valid, checks.document_type_matches]
    .includes(false) || checks.inconsistent_pages === true;
  const documentStatus = !data?.documentChecks ? "Unavailable"
    : documentNeedsReview ? "Needs review"
      : checks.number_format_valid === true ? "Format checked" : "Not verified";
  const ocrRegions = page => (data?.ocr?.lines || []).filter(line => line.page === page)
    .map((line, index) => ({ box: line.box, page, label: `OCR line ${index + 1} (${(line.confidence * 100).toFixed(0)}% line confidence)` }));
  return <main className="min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-5">
      <Logo /><div className="flex flex-wrap items-center justify-end gap-3">
        <ThemeToggle />
        {data && <button type="button" className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold"
          onClick={async () => {
            setReportError(""); setReportStatus("Generating report…");
            try { await downloadVerificationPdf(data, assessment); setReportStatus("Report downloaded."); }
            catch (reportFailure) { setReportStatus(""); setReportError(reportFailure.message || "PDF report could not be generated."); }
          }}>Download PDF report</button>}
        <Link href="/onboarding" className="rounded-full bg-[var(--brand)] px-5 py-2 text-sm font-semibold text-white">Analyze another document</Link>
      </div>
    </div></header>
    {!data ? <div className="mx-auto max-w-xl px-5 py-24 text-center"><h1 className="text-2xl font-semibold">{error ? "Analysis unavailable" : "Loading your analysis…"}</h1>
      {error && <><p role="alert" className="mt-4 text-slate-600">{error}</p><button className="mt-5 rounded-lg border px-4 py-2" onClick={() => { setError(""); setAttempt(value => value + 1); }}>Retry</button></>}
    </div> : <>
      <section className="mx-auto max-w-7xl px-5 pt-8 pb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-blue-700">Submission analysis</p>
        <h1 className="mt-2 text-3xl font-semibold">{data.name === "Incomplete session" ? "Your document analysis" : data.name}</h1>
        <p className="mt-2 text-sm text-slate-500">{data.documentType} · {data.documentNumber ? `Ending ${data.documentNumber.slice(-4)}` : "Number not available"} · {data.status === "submitted" ? "Analysis complete" : "Analysis in progress"}</p>
        {reportStatus && <p role="status" className="mt-2 text-sm text-slate-600">{reportStatus}</p>}
        {reportError && <p role="alert" className="mt-2 text-sm text-red-700">{reportError}</p>}
      </section>
      <nav aria-label="Analysis sections" className="border-y border-slate-200 bg-white"><div className="mx-auto flex max-w-7xl overflow-x-auto px-5" role="tablist">
        {tabs.map(([key, label]) => <button key={key} id={`tab-${key}`} role="tab" aria-selected={tab === key} aria-controls={`panel-${key}`} onClick={() => setTab(key)} className={`shrink-0 border-b-2 px-5 py-4 text-sm font-medium ${tab === key ? "border-[var(--brand)] text-blue-700" : "border-transparent text-slate-500 hover:text-slate-900"}`}>{label}</button>)}
      </div></nav>
      <div className="mx-auto max-w-7xl px-5 py-7" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "overview" && <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SummaryCard title="Document verification"
              value={documentStatus}
              detail={`Government issuance: ${data.documentChecks?.authority_verified === true ? "verified" : "not verified"}.`}
              onClick={() => setTab("document")} />
            <SummaryCard title="OCR extraction" value={data.ocr?.status || "Unavailable"}
              detail={`${data.ocr?.lines?.length || 0} text-line boxes; review field values and missing data.`}
              onClick={() => setTab("document")} />
            <SummaryCard title="Face comparison"
              value={data.faceSimilarity == null ? "Unavailable" : data.faceIsMatch ? "Meets threshold" : "Below threshold"}
              detail={data.faceSimilarity == null ? "No usable comparison score." : `${percent(data.faceSimilarity)} similarity; not identity probability.`}
              onClick={() => setTab("face")} />
            <SummaryCard title="AI-generation analysis" value={aiStatus}
              detail="Experimental Community Forensics signal, not an authenticity verdict."
              onClick={() => setTab("ai")} />
            <SummaryCard title="Image checks" value={data.forgery?.decision || "Unavailable"}
              detail="Experimental heuristic signals; not calibrated or proof of tampering."
              onClick={() => setTab("forgery")} />
            <SummaryCard title="Overall verification status" value={assessment.label}
              detail={assessment.explanation}
              onClick={() => setTab("risk")} />
          </div>
          <Card title="Verification scope">
            <p className="text-sm leading-relaxed text-slate-600">Results summarize only the checks actually run. No government issuer lookup is performed. Experimental AI-generation and image-heuristic scores are not calibrated probabilities and do not determine the risk tier. Missing or unsupported checks remain unavailable rather than passing.</p>
            {data.documentChecks?.is_test_document && <p className="mt-3 text-sm font-semibold text-amber-800">This document is marked as a synthetic test fixture.</p>}
          </Card>
        </div>}
        {tab === "document" && <div className="grid gap-5 md:grid-cols-2">
          <EvidenceImage title="Document front / page 1 (OCR lines highlighted)" url={data.documentUrl} regions={ocrRegions(0)} />
          {data.documentBackUrl && <EvidenceImage title="Document back / page 2 (OCR lines highlighted)" url={data.documentBackUrl} regions={ocrRegions(1)} page={1} />}
          <Card title="Submitted core fields"><FieldList fields={data.fields} /></Card><Card title="OCR-extracted core fields"><FieldList fields={data.ocr?.fields} /></Card>
          <Card title="OCR confidence and field status">
            <p className="text-sm text-slate-600">Provider: {data.ocr?.provider || "Unavailable"} · state: {data.ocr?.status || "Unavailable"}</p>
            <p className="mt-2 text-sm text-slate-600">Aggregate field confidence: {percent(data.ocr?.confidenceScore)} (not produced by this pipeline).</p>
            <p className="mt-2 text-sm text-slate-600">Recognized text lines: {data.ocr?.lines?.length || 0}; their boxes and line-level confidence are highlighted on the document. OCR text itself is not returned in this analysis response.</p>
            <p className="mt-2 text-sm text-slate-600">Status message: {data.ocr?.message || "Unavailable"}</p>
          </Card>
          <Card title="Validation status">
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4"><dt>Number format</dt><dd>{data.documentChecks?.number_format_valid == null ? "Not checked" : data.documentChecks.number_format_valid ? "Passed" : "Needs review"}</dd></div>
              <div className="flex justify-between gap-4"><dt>Aadhaar checksum</dt><dd>{data.documentType?.toLowerCase() !== "aadhaar" || data.documentChecks?.checksum_valid == null ? "Not applicable / not checked" : data.documentChecks.checksum_valid ? "Passed" : "Needs review"}</dd></div>
              <div className="flex justify-between gap-4"><dt>Detected document type</dt><dd>{data.documentChecks?.document_type_matches == null ? "Not checked" : data.documentChecks.document_type_matches ? "Matches selection" : "Mismatch"}</dd></div>
              <div className="flex justify-between gap-4"><dt>Government issuance</dt><dd>Not verified</dd></div>
            </dl>
          </Card>
          <FieldComparison data={data} />
        </div>}
        {tab === "face" && <div className="grid gap-5 md:grid-cols-2">
          <EvidenceImage title="Extracted document face" url={data.documentFaceUrl} />
          <EvidenceImage title="Live camera portrait (detected face highlighted)" url={data.portraitUrl}
            regions={data.faceEvidence?.portrait?.region ? [{ box: data.faceEvidence.portrait.region, kind: "face", label: "InsightFace portrait detection region" }] : []} />
          <Card title="Similarity analysis" className="md:col-span-2">
            <FaceSummary data={data} />
            <p className="mt-4 text-sm text-slate-500">Face extraction and comparison run independently of OCR.</p>
          </Card>
        </div>}
        {tab === "ai" && <AiSection analysis={data.aiImageAnalysis} />}
        {tab === "forgery" && <ImageChecksSection data={data} />}
        {tab === "risk" && <div className="space-y-5">
          <div className="grid gap-5 md:grid-cols-3">
            {[["Validation failures", assessment.hardFailures], ["Review signals", assessment.reviewSignals], ["Unavailable checks", assessment.missingChecks]].map(([title, items]) =>
              <Card key={title} title={title}>{items.length
                ? <ul className="list-disc space-y-2 pl-5 text-sm text-slate-600">{items.map(item => <li key={item}>{item}</li>)}</ul>
                : <p className="text-sm text-slate-500">None recorded.</p>}</Card>)}
          </div>
          <Card title="Explainability findings">
            <div className="space-y-4">{verificationFindings(data).map((finding, index) =>
              <div key={`${finding.component}-${index}`} className="border-b border-slate-100 pb-3 last:border-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{finding.component}</p><span className="rounded-full bg-slate-100 px-3 py-1 text-xs">{finding.status}</span>
                </div>
                <p className="mt-2 text-sm text-slate-600">{finding.explanation}</p>
              </div>)}</div>
          </Card>
        </div>}
      </div>
    </>}
  </main>;
}
