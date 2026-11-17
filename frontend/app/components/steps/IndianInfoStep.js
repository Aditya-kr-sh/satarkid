const fields = [["fullName", "Full name", "text"], ["documentNumber", "Document number", "text"],
  ["dob", "Date of birth (leave blank if only year known)", "date"], ["yearOfBirth", "Year of birth", "text"],
  ["gender", "Gender (if printed)", "text"]];
export default function IndianInfoStep({ documentType, formData, formErrors, onChange, validation, ocrStatus, ocrMessage, documentFaceUrl }) {
  return <div className="space-y-6">
    <h1 className="font-display text-3xl">Review {documentType} details</h1>
    <div role="status" className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
      <p className="font-semibold">Local OCR: {ocrStatus || "unavailable"}</p>
      <p>{ocrMessage || "Enter readable fields manually or leave them blank."}</p>
      <p className="mt-2">Document face: {documentFaceUrl ? "extracted independently of OCR" : "not available for comparison"}.</p>
      {documentFaceUrl && <img src={documentFaceUrl} alt="Extracted document face" className="mt-3 h-24 rounded-lg object-contain" />}
    </div>
    <p className="text-sm text-slate-600">Correct the extracted text using your document. Leave unprinted or unreadable fields blank; you can continue to face comparison. Manually entered details are not verified against the document. A birth year does not require a full date.{documentType === "Aadhaar" && " Aadhaar does not establish nationality."}</p>
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      Format checks do not verify issuance by UIDAI or the Income Tax Department. Manual review is required.
      {validation?.checksum_valid === false && <p>The extracted Aadhaar checksum did not pass. Review the number.</p>}
      {validation?.number_format_valid === false && <p>The extracted number format needs correction.</p>}
      {validation?.masked && <p>Masked Aadhaar: hidden digits remain unknown.</p>}
      {validation?.is_test_document && <p>Synthetic test document detected.</p>}
      {validation?.document_type_matches === false && <p>The detected document type differs from your selection. Review the upload.</p>}
      {validation?.inconsistent_pages && <p>Multiple document numbers were detected. Review the pages.</p>}
    </div>
    <div className="grid gap-5 sm:grid-cols-2">{fields.map(([key, label, type]) =>
      <label key={key} className="block space-y-2 text-sm font-medium text-slate-700"><span>{label}</span>
        <input type={type} value={formData[key] || ""} onChange={onChange(key)} maxLength={150}
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3" />
        {formErrors[key] && <span className="text-red-700">{formErrors[key]}</span>}</label>)}</div>
  </div>;
}
