import Link from "next/link";
import Logo from "../ui/Logo";

export default function Footer() {
  return <footer className="bg-ink-950 text-white">
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-12 sm:flex-row sm:items-center sm:justify-between">
      <div><Logo dark /><p className="mt-3 text-sm text-white/60">Academic research prototype for local document analysis.</p></div>
      <Link href="/onboarding" className="text-sm text-brand-300 hover:text-white">Analyze a document →</Link>
    </div>
  </footer>;
}
