"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { API_BASE_URL } from "@/lib/api";
import Logo from "../../components/ui/Logo";
import ThemeToggle from "../../components/ThemeToggle";

const FIELD_NAMES = { full_name: "Full name", document_number: "Document number", date_of_birth: "Date of birth",
  year_of_birth: "Year of birth", gender: "Gender" };
const IMAGE_CHECKS = [
  ["ela_score", "Compression differences", "Uneven JPEG compression can come from edits, scans or repeated saving."],
  ["edge_inconsistency_score", "Edge variation", "Text, portraits and borders naturally have different edges."],
  ["noise_score", "Noise pattern", "Noise changes can reflect capture quality or image processing."],
  ["exif_anomaly_score", "Image metadata", "Normalization and PDF rendering can strip metadata."],
  ["copy_move_score", "Repeated image regions", "Repeated patterns may be ordinary document design."],
  ["font_consistency_score", "Text-size variation", "Different languages and headings can trigger this signal."],
];
const percent = value => Number.isFinite(Number(value)) && value != null ? `${(Number(value) * 100).toFixed(1)}%` : "Unavailable";

function Card({ title, children, className = "" }) {
  return <section className={`rounded-2xl border border-slate-200 bg-white p-6 shadow-sm ${className}`}>
    <h2 className="mb-4 text-base font-semibold text-slate-900">{title}</h2>{children}
  </section>;
}
function FieldList({ fields = {} }) {
  return <dl className="space-y-3">{Object.entries(FIELD_NAMES).map(([key, label]) =>
    <div key={key} className="flex justify-between gap-6 border-b border-slate-100 pb-3 text-sm last:border-0">
      <dt className="text-slate-500">{label}</dt><dd className="text-right font-medium break-words">{fields[key] || "Not provided"}</dd>
    </div>)}</dl>;
}
function EvidenceImage({ title, url }) {
  return <Card title={title}>{url ? <a href={url} target="_blank" rel="noreferrer">
    <img src={url} alt={title} className="max-h-96 w-full rounded-lg bg-slate-50 object-contain" />
    <span className="mt-3 block text-xs text-blue-700">Open image</span>
  </a> : <p className="text-sm text-slate-500">No image available.</p>}</Card>;
}
function FaceSummary({ data }) {
  const available = data.faceSimilarity != null;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-4xl font-semibold">{percent(data.faceSimilarity)}</p>
      <span className={`rounded-full px-3 py-1 text-sm ${!available ? "bg-slate-100" : data.faceIsMatch ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-900"}`}>
        {!available ? "Comparison unavailable" : data.faceIsMatch ? "Meets match threshold" : "Below match threshold"}
      </span>
    </div>
    <div className="relative h-3 rounded-full bg-slate-100">
      {available && <div className={`h-3 rounded-full ${data.faceIsMatch ? "bg-blue-500" : "bg-amber-400"}`} style={{ width: `${Math.min(100, Math.max(0, data.faceSimilarity * 100))}%` }} />}
      <div className="absolute inset-y-0 border-l-2 border-dashed border-slate-600" style={{ left: `${data.faceMatchThreshold * 100}%` }} />
    </div>
    <p className="text-sm text-slate-600">Match threshold: <strong>{percent(data.faceMatchThreshold)}</strong></p>
    <p className="text-xs leading-relaxed text-slate-500">InsightFace cosine similarity is a comparison score, not the probability of identity. The 50% threshold is an experimental setting, not a calibrated accuracy claim.</p>
  </div>;
}
function AiSection({ analysis }) {
  const groups = [["Document", analysis?.document], ["Portrait", analysis?.portrait]];
  const source = groups.find(([, result]) => result?.model_url)?.[1];
  return <div className="space-y-5">
    <div className="rounded-xl border border-violet-200 bg-violet-50 p-5 text-sm leading-relaxed text-violet-950">
      <strong>Experimental AI-generation signal.</strong>{" "}Scores describe the model&apos;s response, not a calibrated probability that an image was AI-generated. Aadhaar/PAN scans are outside its validated use. A low score does not prove authenticity. These results add no fraud-risk points.
    </div>
    <div className="grid gap-5 md:grid-cols-2">{groups.map(([label, result]) =>
      <Card key={label} title={`${label} AI-image analysis`}>
        {!result?.images?.length ? <p className="text-sm text-slate-500">Not analyzed for this submission. Submit a new case to run this check.</p> :
          result.images.map((item, index) => <div key={index} className="mb-5 last:mb-0">
            <p className="text-sm text-slate-500">{label === "Document" ? `Document page ${index + 1}` : "Uploaded portrait"}</p>
            {item.status === "complete" && item.ai_score != null ? <>
              <p className="mt-2 text-4xl font-semibold text-violet-700">{item.ai_score < 0.01 ? "<0.01" : item.ai_score > 99.99 ? ">99.99" : Number(item.ai_score).toFixed(2)}<span className="text-lg text-slate-400"> / 100</span></p>
              <p className="mt-1 text-xs text-slate-600">{item.view_scores?.length ? "Highest AI-generation signal across up to five document views" : "AI-generation model score"}</p>
              {item.view_scores?.length > 0 && <p className="mt-1 text-xs leading-relaxed text-slate-500">
                View scores: {item.view_scores.map(view => `${view.view.replaceAll("_", " ")} ${Number(view.ai_score).toFixed(2)}`).join(" · ")}
              </p>}
              <div className="mt-3 h-2 rounded-full bg-violet-100"><div className="h-2 rounded-full bg-violet-500" style={{ width: `${Math.max(0, Math.min(100, item.ai_score))}%` }} /></div>
            </> : <p className="mt-2 text-sm text-amber-800">Detector unavailable. No score was assigned; other analysis continues.</p>}
          </div>)}
      </Card>)}</div>
    <Card title="Model and interpretation">
      <p className="text-sm text-slate-600">Community Forensics · local ONNX FP32. Each document page and the separately uploaded portrait are scored independently.</p>
      <p className="mt-2 text-sm text-slate-600">For document pages, the detector examines the center and four overlapping corner views, and displays the highest signal. This improves page coverage but can increase false positives. Scans, text layouts, compression and cropping can produce misleading scores. It does not locate edits or verify the document issuer.</p>
      {source && <a className="mt-3 inline-block text-sm text-blue-700 underline" href={source.model_url} target="_blank" rel="noreferrer">Pinned model and limitations</a>}
    </Card>
  </div>;
}

export default function AnalysisPage() {
  const { id } = useParams();
  return <SubmissionAnalysis key={id} id={id} />;
}

function SubmissionAnalysis({ id }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/onboarding/session/${encodeURIComponent(id)}/analysis`, { cache: "no-store", signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not load analysis."); return body.analysis; })
      .then(setData).catch(err => { if (err.name !== "AbortError") setError(err.message); });
    return () => controller.abort();
  }, [id, attempt]);
  const tabs = [["overview", "Overview"], ["document", "Document & OCR"], ["forgery", "Image Checks"], ["face", "Face Comparison"], ["ai", "AI Generation"]];
  return <main className="min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-5">
      <Logo /><div className="flex items-center gap-3"><ThemeToggle /><Link href="/onboarding" className="rounded-full bg-[var(--brand)] px-5 py-2 text-sm font-semibold text-white">Analyze another document</Link></div>
    </div></header>
    {!data ? <div className="mx-auto max-w-xl px-5 py-24 text-center"><h1 className="text-2xl font-semibold">{error ? "Analysis unavailable" : "Loading your analysis…"}</h1>
      {error && <><p role="alert" className="mt-4 text-slate-600">{error}</p><button className="mt-5 rounded-lg border px-4 py-2" onClick={() => { setError(""); setAttempt(value => value + 1); }}>Retry</button></>}
    </div> : <>
      <section className="mx-auto max-w-7xl px-5 pt-8 pb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-blue-700">Submission analysis</p>
        <h1 className="mt-2 text-3xl font-semibold">{data.name === "Incomplete session" ? "Your document analysis" : data.name}</h1>
        <p className="mt-2 text-sm text-slate-500">{data.documentType} · {data.documentNumber ? `Ending ${data.documentNumber.slice(-4)}` : "Number not available"} · {data.status === "submitted" ? "Analysis complete" : "Analysis in progress"}</p>
      </section>
      <nav aria-label="Analysis sections" className="border-y border-slate-200 bg-white"><div className="mx-auto flex max-w-7xl overflow-x-auto px-5" role="tablist">
        {tabs.map(([key, label]) => <button key={key} id={`tab-${key}`} role="tab" aria-selected={tab === key} aria-controls={`panel-${key}`} onClick={() => setTab(key)} className={`shrink-0 border-b-2 px-5 py-4 text-sm font-medium ${tab === key ? "border-[var(--brand)] text-blue-700" : "border-transparent text-slate-500 hover:text-slate-900"}`}>{label}</button>)}
      </div></nav>
      <div className="mx-auto max-w-7xl px-5 py-7" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "overview" && <div className="grid gap-5 md:grid-cols-2">
          <Card title="Face comparison"><FaceSummary data={data} /></Card>
          <Card title="Active liveness">
            <p className="text-lg font-semibold capitalize">{data.livenessStatus?.replaceAll("_", " ") || "Not recorded"}</p>
            <p className="mt-2 text-sm text-slate-600">A random head-turn challenge checks for live movement. This prototype signal is not certified anti-spoof protection or proof of identity.</p>
          </Card>
          <Card title="Document text"><p className="text-2xl font-semibold capitalize">{data.ocr?.status || "Unavailable"}</p><p className="mt-2 text-sm text-slate-500">Local PaddleOCR · core identity fields</p><p className="mt-4 text-sm text-slate-600">{data.ocr?.message}</p><button onClick={() => setTab("document")} className="mt-5 text-sm font-semibold text-blue-700">Review document and text →</button></Card>
          <Card title="AI-generation analysis"><p className="text-sm text-slate-600">Separate experimental scores for document pages and your portrait. No authenticity decision is made from these scores.</p><button onClick={() => setTab("ai")} className="mt-5 text-sm font-semibold text-blue-700">View AI-image scores →</button></Card>
          <Card title="What these results mean"><p className="text-sm leading-relaxed text-slate-600">These are analysis findings, not identity approval. Government issuance is not checked; the active liveness result is only a prototype movement signal. Review the document, face comparison, liveness, image checks and AI-generation signals together.</p>{data.documentChecks?.is_test_document && <p className="mt-4 text-sm font-semibold text-amber-800">This document is marked as a synthetic test fixture.</p>}</Card>
        </div>}
        {tab === "document" && <div className="grid gap-5 md:grid-cols-2">
          <EvidenceImage title="Document front / page 1" url={data.documentUrl} />{data.documentBackUrl && <EvidenceImage title="Document back / page 2" url={data.documentBackUrl} />}
          <Card title="Submitted core fields"><FieldList fields={data.fields} /></Card><Card title="Original OCR fields"><FieldList fields={data.ocr?.fields} /></Card>
          <Card title="Document checks" className="md:col-span-2"><div className="flex flex-wrap gap-4 text-sm">
            <span>Number format: {data.documentChecks?.number_format_valid == null ? "Unknown" : data.documentChecks.number_format_valid ? "Passed" : "Needs review"}</span>
            {data.documentType?.toLowerCase() === "aadhaar" && <span>Checksum: {data.documentChecks?.checksum_valid == null ? "Not checked" : data.documentChecks.checksum_valid ? "Passed" : "Needs review"}</span>}
            <span>Government issuance: Not verified</span></div></Card>
        </div>}
        {tab === "face" && <div className="grid gap-5 md:grid-cols-2"><EvidenceImage title="Extracted document face" url={data.documentFaceUrl} /><EvidenceImage title="Uploaded portrait" url={data.portraitUrl} />        <Card title="Similarity analysis" className="md:col-span-2"><FaceSummary data={data} /><p className="mt-4 text-sm text-slate-500">Face extraction and comparison run independently of OCR. Liveness status: {data.livenessStatus?.replaceAll("_", " ") || "not recorded"}.</p></Card></div>}
        {tab === "ai" && <AiSection analysis={data.aiImageAnalysis} />}
        {tab === "forgery" && <div className="space-y-5"><Card title="Experimental image heuristics"><p className="text-4xl font-semibold">{data.forgery?.forgery_score == null ? "Unavailable" : Number(data.forgery.forgery_score).toFixed(2)}<span className="text-lg text-slate-400"> / 100</span></p><p className="mt-3 text-sm text-slate-600">A composite of image checks on the normalized document page. It is not a probability of forgery, an AI-generation detector, or proof of government issuance.</p></Card>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{IMAGE_CHECKS.map(([key, title, description]) => <Card key={key} title={title}>
            <p className="text-2xl font-semibold">{data.forgery?.details?.[key] == null ? "Unavailable" : `${Number(data.forgery.details[key]).toFixed(1)} / 100`}</p>
            <p className="mt-3 text-sm text-slate-500">{description}</p>
          </Card>)}</div></div>}
      </div>
    </>}
  </main>;
}
