const router = require("express").Router();
const multer = require("multer");
const controller = require("../controllers/onboardingController");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const types = ["image/jpeg", "image/png", "image/webp"];
    if (["frontImage", "backImage"].includes(file.fieldname)) types.push("application/pdf", "image/avif");
    if (file.fieldname === "liveness_video") types.push("video/webm", "video/mp4", "video/quicktime");
    if (!types.includes(file.mimetype)) return cb(Object.assign(new Error("Unsupported file type."), { statusCode: 400 }));
    cb(null, true);
  },
});
router.post("/session/document", upload.fields([{ name: "frontImage", maxCount: 1 }, { name: "backImage", maxCount: 1 }]), controller.startWithDocument);
router.put("/session/:sessionId/personal-info", controller.submitPersonalInfo);
router.post("/session/:sessionId/liveness-challenge", controller.issueLivenessChallenge);
router.put("/session/:sessionId/selfie", upload.fields([
  { name: "selfie_front", maxCount: 1 }, { name: "portrait_image", maxCount: 1 },
  { name: "liveness_video", maxCount: 1 },
]), controller.processSelfie);
router.get("/session/:sessionId/analysis", controller.getAnalysis);
module.exports = router;
