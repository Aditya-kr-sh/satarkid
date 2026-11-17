"use client";

import { useState } from "react";
import { API_BASE_URL } from "../../../lib/api";

export default function StillPhotoVerificationStep({ sessionId, onVerificationComplete }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function compare() {
    if (!file || !sessionId || busy) return;
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("selfie_front", file);
      const response = await fetch(`${API_BASE_URL}/onboarding/session/${sessionId}/selfie`, { method: "PUT", body });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Photo comparison failed.");
      await onVerificationComplete();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl text-ink-900">Sample photo comparison</h1>
      <p className="text-sm text-ink-500">Upload a portrait to compare with the face on your document. Your analysis opens after the comparison. A still photo does not establish liveness.</p>
      <label className="block space-y-2 font-semibold">
        <span>Portrait image</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy}
          onChange={(event) => { setFile(event.target.files?.[0] || null); setError(""); }}
          className="block w-full rounded-xl border border-[#CBD5E1] p-4" />
      </label>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <button type="button" disabled={!file || busy} onClick={compare}
        className="rounded-xl bg-[var(--brand)] px-6 py-3 font-semibold text-white disabled:opacity-50">
        {busy ? "Comparing photo…" : "Compare sample photo"}
      </button>
    </div>
  );
}
