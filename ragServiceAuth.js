import "dotenv/config";
import { timingSafeEqual } from "node:crypto";

const serviceToken = process.env.RAG_SERVICE_TOKEN;
const production = process.env.NODE_ENV === "production";

if (production && (!serviceToken || serviceToken.length < 32)) {
  throw new Error("RAG_SERVICE_TOKEN must be set to at least 32 characters in production.");
}

export function isAuthorizedRagRequest(authorization, expectedToken = serviceToken) {
  if (!expectedToken) return !production;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function requireRagServiceAuth(req, res, next) {
  if (!isAuthorizedRagRequest(req.get("authorization"))) {
    return res.status(401).json({ success: false, error: "Service authentication required." });
  }
  return next();
}
