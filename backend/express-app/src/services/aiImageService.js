const axios = require("axios");
const FormData = require("form-data");

async function analyzePortrait(buffer) {
  try {
    const form = new FormData();
    form.append("image", buffer, { filename: "portrait", contentType: "application/octet-stream" });
    const { data } = await axios.post(`${process.env.ML_SERVICE_URL || "http://127.0.0.1:8000"}/api/v1/documents/analyze-ai-image`, form,
      { headers: form.getHeaders(), timeout: 45000 });
    return data;
  } catch (error) {
    const errorInfo = error && typeof error === "object" ? error : {};
    console.error("AI-image analysis request failed", {
      code: errorInfo.code || "unknown",
      status: errorInfo.response?.status || null,
    });
    const message = "The AI-image analysis service could not be reached. Other analysis remains available.";
    return {
      status: "unavailable",
      model_status: { state: "unavailable", error_code: "ml_service_unavailable", message },
      images: [{
        image_index: 0,
        status: "unavailable",
        ai_score: null,
        error_code: "ml_service_unavailable",
        error_message: message,
      }],
    };
  }
}
module.exports = { analyzePortrait };
