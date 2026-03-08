const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "check-the-tag-dev-secret";

function readBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice("Bearer ".length).trim();
}

function verifyAuthToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function authMiddleware(req, res, next) {
  const token = readBearerToken(req);
  if (!token) return res.status(401).json({ success: false, error: "Unauthorized" });

  try {
    req.user = verifyAuthToken(token);
    next();
  } catch {
    return res.status(401).json({ success: false, error: "Invalid or expired token" });
  }
}

module.exports = { authMiddleware, JWT_SECRET, verifyAuthToken };
