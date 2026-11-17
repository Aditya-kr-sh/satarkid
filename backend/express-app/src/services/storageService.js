const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const sharp = require("sharp");

async function uploadBuffer(buffer) {
  if (!process.env.LOCAL_UPLOAD_DIR || !process.env.PUBLIC_UPLOAD_URL) throw new Error("Local image storage is not configured.");
  await fs.mkdir(process.env.LOCAL_UPLOAD_DIR, { recursive: true, mode: 0o700 });
  const filename = `${randomUUID()}.jpg`;
  const encoded = await sharp(buffer, { limitInputPixels: 40000000 }).rotate().jpeg({ quality: 95 }).toBuffer();
  await fs.writeFile(path.join(process.env.LOCAL_UPLOAD_DIR, filename), encoded, { flag: "wx", mode: 0o600 });
  return `${process.env.PUBLIC_UPLOAD_URL.replace(/\/$/, "")}/${filename}`;
}
module.exports = { uploadBuffer };
