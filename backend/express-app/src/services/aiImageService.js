const axios = require("axios");
const FormData = require("form-data");

async function analyzePortrait(buffer) {
  try {
    const form = new FormData();
    form.append("image", buffer, { filename: "portrait", contentType: "application/octet-stream" });
    const { data } = await axios.post(`${process.env.ML_SERVICE_URL || "http://127.0.0.1:8000"}/api/v1/documents/analyze-ai-image`, form,
      { headers: form.getHeaders(), timeout: 45000 });
    return data;
  } catch {
    return { status: "unavailable", images: [{ image_index: 0, status: "unavailable", ai_score: null }] };
  }
}
module.exports = { analyzePortrait };
