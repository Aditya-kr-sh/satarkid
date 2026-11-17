import { ArrowRight, ShieldCheck, ScanFace, FileSearch } from "lucide-react";
import Button from "../ui/Button";

export default function Hero() {
  return <section className="relative overflow-hidden pb-20 pt-32 sm:pt-40">
    <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-[var(--canvas)] via-[var(--card)] to-[var(--canvas)]" />
    <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 sm:px-6 lg:grid-cols-2">
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-brand-700">SatarkID · सतर्क · Research prototype</p>
        <h1 className="mt-5 font-display text-4xl font-extrabold leading-tight text-ink-900 sm:text-5xl">Understand the <span className="gradient-text">identity evidence.</span></h1>
        <p className="mt-5 text-lg leading-relaxed text-ink-500">Analyze Aadhaar and PAN documents with local OCR, independent face comparison and explained image findings. A document and face module for digital-arrest fraud prevention.</p>
        <div className="mt-8"><Button href="/onboarding" size="lg">Analyze a document <ArrowRight className="h-4 w-4" /></Button></div>
        <p className="mt-6 text-sm text-ink-500">Aadhaar · Individual PAN · Images and PDFs</p>
      </div>
      <div className="rounded-3xl border border-ink-100 bg-white p-7 shadow-xl">
        <h2 className="text-xl font-bold text-ink-900">Separate findings. Clear limitations.</h2>
        {[ [FileSearch, "Document text", "PaddleOCR runs locally. Unreadable fields can stay blank."],
           [ScanFace, "Face comparison", "Face extraction continues when OCR is unavailable."],
           [ShieldCheck, "Manual review", "Image checks and matching faces do not establish official authority."] ].map(([Icon, title, text]) =>
          <div key={title} className="mt-6 flex gap-4"><Icon className="h-6 w-6 shrink-0 text-brand-600" /><div><h3 className="font-semibold text-ink-900">{title}</h3><p className="mt-1 text-sm text-ink-500">{text}</p></div></div>)}
        <p className="mt-7 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Government issuance and liveness are not verified. Inspect the findings before drawing conclusions.</p>
      </div>
    </div>
  </section>;
}
