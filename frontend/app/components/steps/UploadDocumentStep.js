export default function UploadDocumentStep({ documentType, onSelectType, front, back, onFrontFileChange, onBackFileChange, disabled }) {
  return <div className="space-y-6">
    <h1 className="font-display text-3xl">Upload your document</h1>
    <p className="text-sm text-slate-600">Choose Aadhaar or PAN. Upload a JPEG, PNG, WebP, AVIF or a PDF with up to two pages (10 MB per file).</p>
    <div className="flex gap-3">{["Aadhaar", "PAN"].map(type => <button key={type} type="button"
      aria-pressed={documentType === type} disabled={disabled} onClick={() => onSelectType(type)}
      className={`rounded-xl border px-6 py-3 font-semibold ${documentType === type ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-300"}`}>{type}</button>)}</div>
    <label className="block space-y-2 font-semibold"><span>{documentType} front / PDF</span>
      <input type="file" accept="image/jpeg,image/png,image/webp,image/avif,application/pdf" disabled={disabled}
        onChange={event => onFrontFileChange(event.target.files?.[0] || null)} className="block w-full rounded-xl border p-4" />
      {front && <span className="text-sm font-normal text-slate-600">Selected: {front.name}</span>}
    </label>
    {documentType === "Aadhaar" && <label className="block space-y-2 font-semibold"><span>Aadhaar back (optional)</span>
      <input type="file" accept="image/jpeg,image/png,image/webp,image/avif,application/pdf" disabled={disabled}
        onChange={event => onBackFileChange(event.target.files?.[0] || null)} className="block w-full rounded-xl border p-4" />
      {back && <span className="text-sm font-normal text-slate-600">Selected: {back.name}</span>}
    </label>}
  </div>;
}
