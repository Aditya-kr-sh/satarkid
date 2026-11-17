const router = require("express").Router();
const multer = require("multer");
const controller = require("../controllers/onboardingController");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const types = ["image/jpeg", "image/png", "image/webp"];
    if (["frontImage", "backImage"].includes(file.fieldname)) types.push("application/pdf", "image/avif");
    if (!types.includes(file.mimetype)) return cb(Object.assign(new Error("Unsupported file type."), { statusCode: 400 }));
    cb(null, true);
  },
});
router.post("/session/document", upload.fields([{ name: "frontImage", maxCount: 1 }, { name: "backImage", maxCount: 1 }]), controller.startWithDocument);
router.put("/session/:sessionId/personal-info", controller.submitPersonalInfo);
router.put("/session/:sessionId/selfie", upload.single("selfie_front"), controller.processSelfie);
router.get("/session/:sessionId/analysis", controller.getAnalysis);
module.exports = router;
