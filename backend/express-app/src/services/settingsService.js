const pool = require("./dbClient");
const DEFAULTS = { face_match_threshold: 0.5 };
async function getSettings() {
  const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='face_match_threshold'");
  const value = Number(rows[0]?.value ?? DEFAULTS.face_match_threshold);
  return { face_match_threshold: Number.isFinite(value) && value > 0 && value <= 1 ? value : DEFAULTS.face_match_threshold };
}
module.exports = { getSettings };
