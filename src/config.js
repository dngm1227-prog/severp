const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");

function csv(value, fallback = []) {
  if (!value) return fallback;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const config = {
  port: Number(process.env.PORT || 3000),
  databaseFile: process.env.DATABASE_FILE || path.join(rootDir, "data", "database.json"),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "http://localhost:3000",
  clientApiKeys: csv(process.env.CLIENT_API_KEYS, ["dev-client-key"]),
  adminApiKeys: csv(process.env.ADMIN_API_KEYS, ["dev-admin-key"]),
  customsApiUrl: process.env.CUSTOMS_API_URL || "",
  internalApiUrl: process.env.INTERNAL_API_URL || "",
  messageApiUrl: process.env.MESSAGE_API_URL || "",
  verificationTtlMinutes: Number(process.env.VERIFICATION_TTL_MINUTES || 1440),
  externalTimeoutMs: Number(process.env.EXTERNAL_TIMEOUT_MS || 5000)
};

module.exports = { config };
