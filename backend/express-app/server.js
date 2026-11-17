// server.js
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const dotenv = require("dotenv");
const path = require("path");

// Load environment variables from root
dotenv.config({ path: path.join(__dirname, "../../.env") });

const app = express();
const PORT = process.env.BACKEND_PORT || 5000;

// Middleware
app.use(helmet()); // Security headers
app.use(cors()); // Enable CORS
app.use(morgan("dev")); // Logging
app.use(express.json()); // Parse JSON
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded

// Static files for uploads
app.use("/uploads", express.static(process.env.LOCAL_UPLOAD_DIR || path.join(__dirname, "uploads"), {
  dotfiles: "deny",
  setHeaders: (res) => res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"),
}));

// Import routes
const onboardingRoutes = require("./src/routes/onboardingRoutes");

// Routes
app.use("/api/v1/onboarding", onboardingRoutes);

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "satarkid-api",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "SatarkID API",
    version: "1.0.0",
    endpoints: {
      health: "GET /health",
      onboarding: "POST /api/v1/onboarding/session/document",
    },
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Error handling middleware
app.use((err, req, res, next) => {
  const status = err.code === "LIMIT_FILE_SIZE" ? 413 : err.name === "MulterError" ? 400 : err.statusCode || 500;
  if (status >= 500) console.error("Request failed:", err.name);
  res.status(status).json({ error: status === 413 ? "Upload files of at most 10 MB." : status < 500 ? err.message : "Analysis is unavailable. Please retry." });
});

// Start server (long timeout for document local analysis pipeline)
const server = app.listen(PORT, process.env.BACKEND_HOST || "127.0.0.1", () => {
  console.log(` Express backend running on http://localhost:${PORT}`);
  console.log(` Health check: http://localhost:${PORT}/health`);
  console.log(` Environment: ${process.env.NODE_ENV || "development"}`);
});
server.timeout = 180_000;
server.keepAliveTimeout = 180_000;
server.headersTimeout = 185_000;
