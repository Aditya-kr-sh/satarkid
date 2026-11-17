"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export default function PortraitUploadStep({ portrait, onSelect, disabled }) {
  const [error, setError] = useState("");
  const previewUrl = useMemo(() => portrait ? URL.createObjectURL(portrait) : "", [portrait]);
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function handleChange(event) {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    setError("");

    if (file && !ACCEPTED_TYPES.includes(file.type)) {
      onSelect(null);
      setError("Choose a JPEG, PNG, or WebP portrait.");
      return;
    }
    if (file && file.size > MAX_FILE_SIZE) {
      onSelect(null);
      setError("The portrait must be 10 MB or smaller.");
      return;
    }
    onSelect(file);
  }

  return <div className="space-y-6">
    <h1 className="font-display text-3xl">Upload the portrait to analyze</h1>
    <p className="text-sm text-slate-600">
      Choose the photo whose AI-generation score you want to see. This is separate from the live camera portrait
      used in the next step for face comparison and liveness.
    </p>
    <label className="block space-y-2 font-semibold">
      <span>Portrait photo (JPEG, PNG, or WebP · up to 10 MB)</span>
      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled}
        onChange={handleChange} className="block w-full rounded-xl border p-4" />
    </label>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {portrait && previewUrl && <div className="space-y-2">
      <p className="text-sm font-medium text-slate-700">This exact photo will receive the portrait AI-image analysis:</p>
      <Image src={previewUrl} alt="Selected portrait to analyze" width={640} height={480} unoptimized
        className="max-h-80 w-full rounded-xl bg-slate-100 object-contain" />
      <p className="text-xs text-slate-500">{portrait.name}</p>
    </div>}
    <p className="text-xs leading-relaxed text-slate-500">
      The uploaded photo is retained so it can be shown beside its result. The short liveness video is not saved;
      the live camera portrait is retained separately for face comparison.
    </p>
  </div>;
}
