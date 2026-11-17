const { Pool, types } = require("pg");
const fs = require("node:fs");

// PostgreSQL DATE has no timezone. Keep its calendar value when returning JSON.
types.setTypeParser(1082, (value) => value);

const buildSslConfig = () => {
  if (!process.env.DATABASE_CA_FILE) return { rejectUnauthorized: true };
  try {
    return { rejectUnauthorized: true, ca: fs.readFileSync(process.env.DATABASE_CA_FILE, "utf8") };
  } catch (error) {
    console.warn(`DATABASE_CA_FILE could not be read: ${error.message}. Continuing without custom CA validation.`);
    return { rejectUnauthorized: true };
  }
};

const fallbackPool = {
  async query() {
    throw new Error("Database is not configured. Set DATABASE_URL in the SatarkID .env before persisting submissions.");
  },
  async end() {},
};

const pool = process.env.DATABASE_URL?.trim()
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: buildSslConfig(),
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
  : fallbackPool;

if (pool !== fallbackPool) {
  pool.on("error", (err) => {
    console.error("Unexpected pg pool error:", err.message);
  });
} else {
  console.warn("DATABASE_URL is not configured; SatarkID is running in degraded mode without a persisted database.");
}

module.exports = pool;
