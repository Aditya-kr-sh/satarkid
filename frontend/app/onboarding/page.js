"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SiteNav from "../components/SiteNav";
import Stepper from "../components/Stepper";
import UploadDocumentStep from "../components/steps/UploadDocumentStep";
import IndianInfoStep from "../components/steps/IndianInfoStep";
import PortraitUploadStep from "../components/steps/PortraitUploadStep";
import ActiveLivenessStep from "../components/steps/ActiveLivenessStep";
import { API_BASE_URL, requestJson } from "../../lib/api";

const steps = [
  { id: 1, label: "Upload Document" },
  { id: 2, label: "Review Info" },
  { id: 3, label: "Upload Portrait" },
  { id: 4, label: "Liveness Check" },
];
const emptyForm = { fullName: "", documentNumber: "", dob: "", yearOfBirth: "", gender: "" };

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [documentType, setDocumentType] = useState("Aadhaar");
  const [front, setFront] = useState(null);
  const [back, setBack] = useState(null);
  const [portrait, setPortrait] = useState(null);
  const [session, setSession] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function next() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (step === 1) {
        const body = new FormData();
        body.append("documentType", documentType);
        body.append("frontImage", front);
        if (documentType === "Aadhaar" && back) body.append("backImage", back);
        const data = await requestJson(`${API_BASE_URL}/onboarding/session/document`, { method: "POST", body });
        setSession(data);
        setForm({ ...emptyForm, ...data.prefill });
      } else if (step === 2) {
        await requestJson(`${API_BASE_URL}/onboarding/session/${session.sessionId}/personal-info`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
        });
      }
      setStep(step + 1);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
    <SiteNav fixed={false} />
    <main className="mx-auto max-w-4xl space-y-10 px-4 py-10">
      <Stepper steps={steps} currentStep={step} />
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        {step === 1 && <UploadDocumentStep documentType={documentType} onSelectType={setDocumentType}
          front={front} back={back} onFrontFileChange={setFront} onBackFileChange={setBack} disabled={busy} />}
        {step === 2 && <IndianInfoStep documentType={documentType} formData={form} formErrors={{}}
          onChange={(key) => (event) => setForm({ ...form, [key]: event.target.value })}
          validation={session.ocrData?.validation} ocrStatus={session.ocrData?.status}
          ocrMessage={session.ocrData?.message} documentFaceUrl={session.documentFaceUrl} />}
        {step === 3 && <PortraitUploadStep portrait={portrait} onSelect={setPortrait} disabled={busy} />}
        {step === 4 && <ActiveLivenessStep sessionId={session.sessionId} portraitFile={portrait}
          onBack={() => setStep(3)}
          onVerificationComplete={() => router.push(`/analysis/${session.sessionId}`)} />}
        {error && <p role="alert" className="mt-5 text-red-700">{error}</p>}
        {step < 4 && <div className="mt-8 flex justify-between gap-4">
          <button type="button" disabled={busy || step === 1} onClick={() => { setStep(step - 1); setError(""); }}
            className="rounded-xl border px-6 py-3 disabled:opacity-30">Back</button>
          <button type="button" disabled={busy || (step === 1 && !front) || (step === 3 && !portrait)} onClick={next}
            className="rounded-xl bg-[var(--brand)] px-6 py-3 font-semibold text-white disabled:opacity-50">
            {busy ? "Analyzing…" : step === 3 ? "Continue to live check" : "Continue"}</button>
        </div>}
      </section>
    </main>
  </div>;
}
